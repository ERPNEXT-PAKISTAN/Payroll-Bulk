from __future__ import annotations

import frappe


def recalculate_days(doc) -> bool:
	mode = doc.get("calculation_mode") or "Manual"
	start_date = doc.get("start_date")
	end_date = doc.get("end_date")
	if not start_date or not end_date:
		return False

	employees = [row.employee for row in (doc.get("employees") or []) if row.get("employee")]
	if not employees:
		return False

	from payroll_bulk.api import get_bulk_attendance_values

	source = None
	if mode == "Checkin Based":
		source = "Employee Checkin"
	elif mode == "Attendance Based":
		source = "Attendance"
	elif mode == "Manual" and doc.get("manual_salary_basis") in ("By Payment Days", "Deduct Absent Days"):
		source = "Attendance"
	else:
		return False

	attendance = get_bulk_attendance_values(employees, source, str(start_date), str(end_date)) or {}
	changed = False
	for row in doc.get("employees") or []:
		employee = row.get("employee")
		if not employee:
			continue
		item = attendance.get(employee) or {}
		for field, key in (
			("payment_days", "payment_days"),
			("attendance_days", "attendance_days"),
			("absent_days", "absent_days"),
			("attendance_hours", "attendance_hours"),
		):
			value = float(item.get(key) or 0)
			if float(row.get(field) or 0) != value:
				row.set(field, value)
				changed = True
	return changed


def recalculate_overtime(doc) -> bool:
	start_date = doc.get("start_date")
	end_date = doc.get("end_date")
	overtime_source = doc.get("overtime_source") or "Manual"
	if not start_date or not end_date or overtime_source == "Manual":
		return False

	employees = [row.employee for row in (doc.get("employees") or []) if row.get("employee")]
	if not employees:
		return False

	from payroll_bulk.api import get_bulk_checkin_overtime_values, get_bulk_source_values

	changed = False
	if overtime_source == "Employee Checkin Difference":
		overtime = get_bulk_checkin_overtime_values(employees, str(start_date), str(end_date), "out_in") or {}
		for row in doc.get("employees") or []:
			employee = row.get("employee")
			if not employee:
				continue
			item = overtime.get(employee) or {}
			ot_hours = float(item.get("overtime_hours") or 0)
			worked = float(item.get("worked_hours") or 0)
			shift = float(item.get("shift_hours") or 0)
			for field, value in (
				("overtime_hours", ot_hours),
				("worked_hours", worked),
				("shift_hours", shift),
				("ot_input", ot_hours),
			):
				if float(row.get(field) or 0) != value:
					row.set(field, value)
					changed = True
	elif overtime_source == "Custom DocType" and doc.get("overtime_doctype"):
		imported = get_bulk_source_values(
			employees,
			doc.overtime_doctype,
			doc.overtime_employee_field,
			doc.overtime_date_field,
			doc.overtime_hours_field or "",
			"",
			"",
			str(start_date),
			str(end_date),
			doc.get("name") or "",
		) or {}
		for row in doc.get("employees") or []:
			employee = row.get("employee")
			if not employee:
				continue
			item = imported.get(employee) or {}
			ot_hours = float(item.get("hours") or 0)
			if float(row.get("ot_input") or 0) != ot_hours:
				row.ot_input = ot_hours
				row.overtime_hours = ot_hours
				changed = True
	return changed


def recalculate_piece_salary(doc) -> bool:
	if doc.get("calculation_mode") != "Per Piece or Per Hour":
		return False
	if not doc.get("overtime_doctype"):
		return False

	start_date = doc.get("start_date")
	end_date = doc.get("end_date")
	if not start_date or not end_date:
		return False

	employees = [row.employee for row in (doc.get("employees") or []) if row.get("employee")]
	if not employees:
		return False

	from payroll_bulk.api import _piece_basis_use_flags, get_bulk_source_values

	piece_basis = doc.get("per_piece_basis") or "Total Hours"
	use_hours, use_qty = _piece_basis_use_flags(piece_basis)
	imported = get_bulk_source_values(
		employees,
		doc.overtime_doctype,
		doc.overtime_employee_field,
		doc.overtime_date_field,
		doc.overtime_hours_field or "" if use_hours else "",
		doc.overtime_qty_field or "" if use_qty else "",
		doc.overtime_rate_field or "" if use_qty else "",
		str(start_date),
		str(end_date),
		doc.get("name") or "",
	) or {}

	changed = False
	for row in doc.get("employees") or []:
		employee = row.get("employee")
		if not employee:
			continue
		item = imported.get(employee) or {}
		if use_qty:
			qty = float(item.get("qty") or 0)
			rate = float(item.get("rate") or 0)
			if float(row.get("source_qty") or 0) != qty:
				row.source_qty = qty
				changed = True
			if float(row.get("piece_rate") or 0) != rate:
				row.piece_rate = rate
				changed = True
		if use_hours:
			hours = float(item.get("hours") or 0)
			if float(row.get("source_hours") or 0) != hours:
				row.source_hours = hours
				changed = True
		if not use_qty:
			if float(row.get("source_qty") or 0):
				row.source_qty = 0
				changed = True
			if float(row.get("piece_rate") or 0):
				row.piece_rate = 0
				changed = True
		if not use_hours and float(row.get("source_hours") or 0):
			row.source_hours = 0
			changed = True
	return changed


def recalculate_bulk_salary_source(doc) -> bool:
	changed = recalculate_days(doc)
	changed = recalculate_piece_salary(doc) or changed
	changed = recalculate_overtime(doc) or changed
	return changed


@frappe.whitelist()
def preview_batch_source_values(
	employees,
	start_date: str,
	end_date: str,
	calculation_mode: str = "Checkin Based",
	overtime_source: str = "Employee Checkin Difference",
):
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employees = [employee for employee in (employees or []) if employee]
	if not employees or not start_date or not end_date:
		return {}

	doc = frappe._dict(
		{
			"calculation_mode": calculation_mode,
			"overtime_source": overtime_source,
			"start_date": start_date,
			"end_date": end_date,
			"employees": [frappe._dict({"employee": employee}) for employee in employees],
		}
	)
	recalculate_bulk_salary_source(doc)

	result = {}
	for row in doc.employees:
		result[row.employee] = {
			"payment_days": float(row.get("payment_days") or 0),
			"attendance_days": float(row.get("attendance_days") or 0),
			"absent_days": float(row.get("absent_days") or 0),
			"attendance_hours": float(row.get("attendance_hours") or 0),
			"source_hours": float(row.get("source_hours") or 0),
			"source_qty": float(row.get("source_qty") or 0),
			"piece_rate": float(row.get("piece_rate") or 0),
			"worked_hours": float(row.get("worked_hours") or 0),
			"shift_hours": float(row.get("shift_hours") or 0),
			"overtime_hours": float(row.get("overtime_hours") or 0),
			"ot_input": float(row.get("ot_input") or 0),
		}
	return result
