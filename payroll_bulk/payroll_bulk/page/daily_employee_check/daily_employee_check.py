from __future__ import annotations

import calendar
from datetime import date, datetime

import frappe
from frappe.utils import add_days, getdate

from payroll_bulk.checkin_utils import (
	build_checkin_day_buckets,
	bucket_worked_hours,
	get_employee_holiday_day_map,
	is_countable_checkin_day,
)


def _hours_to_hhmm(hours: float) -> str:
	if not hours or hours <= 0:
		return ""
	total_minutes = int(round(hours * 60))
	hh, mm = divmod(total_minutes, 60)
	return f"{hh}:{mm:02d}"


def _month_bounds(month: int, year: int) -> tuple[date, date, int]:
	last_day = calendar.monthrange(year, month)[1]
	return date(year, month, 1), date(year, month, last_day), last_day


def _time_to_minutes(value) -> int | None:
	if not value:
		return None
	from frappe.utils import get_datetime
	dt = get_datetime(value)
	return dt.hour * 60 + dt.minute


def _cell_flags(bucket: dict) -> tuple[bool, bool]:
	in_late = False
	out_early = False
	in_minutes = _time_to_minutes(bucket.get("_in_dt"))
	out_minutes = _time_to_minutes(bucket.get("_out_dt"))
	shift_start = _time_to_minutes(bucket.get("shift_start"))
	shift_end = _time_to_minutes(bucket.get("shift_end"))
	if in_minutes is not None and shift_start is not None and in_minutes > shift_start + 5:
		in_late = True
	if out_minutes is not None and shift_end is not None and out_minutes < shift_end - 5:
		out_early = True
	return in_late, out_early


@frappe.whitelist()
def get_report_data(
	month: int | str | None = None,
	year: int | str | None = None,
	company: str | None = None,
	department: str | None = None,
	shift: str | None = None,
	employee: str | None = None,
):
	month = int(month or datetime.today().month)
	year = int(year or datetime.today().year)
	start_date, end_date, days_in_month = _month_bounds(month, year)

	employee_filters = {"status": "Active"}
	if company:
		employee_filters["company"] = company
	if department:
		employee_filters["department"] = department

	employees = frappe.get_all(
		"Employee",
		filters=employee_filters,
		fields=["name", "employee_name", "department", "company"],
		order_by="employee_name asc",
		limit_page_length=500,
	)
	if employee:
		search = employee.strip().lower()
		employees = [
			row
			for row in employees
			if search in (row.employee_name or "").lower() or search in (row.name or "").lower()
		]

	if not employees:
		return {
			"employees": [],
			"days_in_month": days_in_month,
			"month_label": start_date.strftime("%b %Y"),
			"start_date": str(start_date),
			"end_date": str(end_date),
		}

	employee_names = [row.name for row in employees]
	checkin_filters = [
		["employee", "in", employee_names],
		["time", ">=", f"{start_date} 00:00:00"],
		["time", "<=", f"{end_date} 23:59:59"],
	]
	if shift:
		checkin_filters.append(["shift", "=", shift])

	checkins = frappe.get_all(
		"Employee Checkin",
		filters=checkin_filters,
		fields=["employee", "employee_name", "time", "log_type", "shift", "shift_start", "shift_end"],
		order_by="employee asc, time asc",
		limit_page_length=20000,
	)
	buckets = build_checkin_day_buckets(checkins)
	holiday_map = get_employee_holiday_day_map(employees, start_date, end_date)

	report_rows = []
	for emp in employees:
		emp_holidays = holiday_map.get(emp.name, {})
		day_cells = {}
		total_present = 0
		for day_num in range(1, days_in_month + 1):
			display_key = str(day_num)
			current = add_days(start_date, day_num - 1)
			day_key = str(current)
			if day_key in emp_holidays:
				day_cells[display_key] = {"mark": emp_holidays[day_key]}
				continue
			bucket = buckets.get((emp.name, day_key), {})
			if not is_countable_checkin_day(bucket):
				continue
			in_time = bucket.get("in_time") or ""
			out_time = bucket.get("out_time") or ""
			ot = _hours_to_hhmm(bucket_worked_hours(bucket))
			in_late, out_early = _cell_flags(bucket)
			total_present += 1
			day_cells[display_key] = {
				"in": in_time,
				"out": out_time,
				"ot": ot,
				"in_late": in_late,
				"out_early": out_early,
			}

		report_rows.append(
			{
				"employee": emp.name,
				"employee_name": emp.employee_name or emp.name,
				"department": emp.department or "",
				"total": total_present,
				"days": day_cells,
			}
		)

	return {
		"employees": report_rows,
		"days_in_month": days_in_month,
		"month_label": start_date.strftime("%b %Y"),
		"start_date": str(start_date),
		"end_date": str(end_date),
	}
