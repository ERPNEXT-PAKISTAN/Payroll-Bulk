"""Payroll Bulk server API.

Whitelisted RPC methods power the desk UI and background jobs. Internal helpers
cover holiday lists, component rules, accrual/payment journal entries, and batch
salary slip processing.
"""

from __future__ import annotations

import json

import erpnext
import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, getdate

from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
	get_accounting_dimensions,
)
from hrms.payroll.doctype.payroll_entry.payroll_entry import PayrollEntry
from hrms.utils.holiday_list import get_holiday_list_for_employee


# ---------------------------------------------------------------------------
# Holiday list helpers
# ---------------------------------------------------------------------------


def _resolve_default_holiday_list(company: str) -> str | None:
	holiday_list = frappe.db.get_value("Company", company, "default_holiday_list")
	if holiday_list:
		return holiday_list

	for employee in frappe.get_all(
		"Employee", filters={"company": company, "status": "Active"}, pluck="name", limit_page_length=200
	):
		existing = get_holiday_list_for_employee(employee, raise_exception=False)
		if existing:
			return existing if isinstance(existing, str) else existing.get("holiday_list")

	if frappe.db.exists("Holiday List", "Company Holidays"):
		return "Company Holidays"

	return frappe.db.get_value("Holiday List", {}, "name", order_by="creation desc")


def _ensure_holiday_list_for_employee(
	employee: str, as_on: str | None = None, assign_from: str | None = None
) -> str | None:
	"""Assign a company holiday list when the employee has none (avoids slip creation failures)."""
	check_dates = [getdate(as_on or frappe.utils.today())]
	if assign_from:
		check_dates.insert(0, getdate(assign_from))

	for check_date in check_dates:
		existing = get_holiday_list_for_employee(employee, as_on=check_date, raise_exception=False)
		if existing:
			return existing if isinstance(existing, str) else existing.get("holiday_list")

	company = frappe.db.get_value("Employee", employee, "company")
	holiday_list = _resolve_default_holiday_list(company)
	if not holiday_list:
		return None

	doc = frappe.get_doc(
		{
			"doctype": "Holiday List Assignment",
			"naming_series": "HR-HLA-.YYYY.-",
			"applicable_for": "Employee",
			"assigned_to": employee,
			"holiday_list": holiday_list,
			"from_date": min(check_dates),
		}
	)
	doc.insert(ignore_permissions=True)
	doc.submit()
	return holiday_list


def _validate_employee_holiday_list(employee: str, start_date: str, end_date: str | None = None):
	end_date = end_date or start_date
	if not _ensure_holiday_list_for_employee(employee, as_on=end_date, assign_from=start_date):
		frappe.throw(
			_(
				"No Holiday List is assigned for {0} for payroll period {1} to {2}. Assign one via Holiday List Assignment or set Default Holiday List on the company."
			).format(employee, frappe.utils.formatdate(start_date), frappe.utils.formatdate(end_date))
		)


def _apply_date_filters(filters: dict, fieldname: str, start_date: str | None, end_date: str | None):
	if not fieldname:
		return
	if start_date and end_date:
		filters[fieldname] = ["between", [start_date, end_date]]
	elif start_date:
		filters[fieldname] = [">=", start_date]
	elif end_date:
		filters[fieldname] = ["<=", end_date]


def _get_parent_doctypes_for_child(child_doctype: str) -> list[str]:
	return frappe.get_all(
		"DocField",
		filters={"fieldtype": "Table", "options": child_doctype, "parent": ["!=", "DocType"]},
		pluck="parent",
		distinct=True,
	)


def _validate_field(meta, fieldname: str) -> str:
	if not fieldname:
		return ""
	if fieldname.startswith("@parent."):
		parent_field = fieldname.split(".", 1)[1]
		for parent in _get_parent_doctypes_for_child(meta.name):
			if frappe.get_meta(parent).get_field(parent_field):
				return fieldname
		frappe.throw(f"Field {fieldname} does not exist for {meta.name}.")
	if "." in fieldname:
		table_field, child_field = fieldname.split(".", 1)
		table_df = meta.get_field(table_field)
		if not table_df or table_df.fieldtype != "Table":
			frappe.throw(f"Field {fieldname} does not exist in {meta.name}.")
		child_meta = frappe.get_meta(table_df.options)
		if not child_meta.get_field(child_field):
			frappe.throw(f"Field {fieldname} does not exist in {meta.name}.")
		return fieldname
	if meta.get_field(fieldname):
		return fieldname
	if meta.istable:
		for parent in _get_parent_doctypes_for_child(meta.name):
			if frappe.get_meta(parent).get_field(fieldname):
				return fieldname
	frappe.throw(f"Field {fieldname} does not exist in {meta.name}.")
	return fieldname


def _resolve_source_field(meta, fieldname: str):
	if not fieldname:
		return meta, "", None, None
	if "." not in fieldname:
		return meta, fieldname, None, None
	table_field, child_field = fieldname.split(".", 1)
	table_df = meta.get_field(table_field)
	if not table_df or table_df.fieldtype != "Table":
		frappe.throw(f"Field {fieldname} does not exist in {meta.name}.")
	child_meta = frappe.get_meta(table_df.options)
	if not child_meta.get_field(child_field):
		frappe.throw(f"Field {fieldname} does not exist in {meta.name}.")
	return child_meta, child_field, table_field, table_df.options


def _is_numeric_source_field(fieldtype: str, fieldname: str) -> bool:
	if fieldtype in {"Float", "Currency", "Int", "Percent", "Duration"}:
		return True
	name = (fieldname or "").lower()
	return fieldtype == "Data" and any(token in name for token in ("rate", "piece", "amount", "price", "target", "qty", "hour"))


def _source_field_options(meta, layout_fields):
	options = []
	for df in meta.fields:
		if not df.fieldname:
			continue
		if df.fieldtype == "Table" and df.options:
			child_meta = frappe.get_meta(df.options)
			table_label = df.label or df.fieldname
			for cf in child_meta.fields:
				if not cf.fieldname or cf.fieldtype in layout_fields:
					continue
				options.append(
					{
						"fieldname": f"{df.fieldname}.{cf.fieldname}",
						"label": f"{table_label} › {cf.label or cf.fieldname}",
						"fieldtype": cf.fieldtype,
						"options": cf.options,
						"child_table": df.fieldname,
						"child_doctype": df.options,
					}
				)
			continue
		if df.fieldtype in layout_fields:
			continue
		options.append(
			{
				"fieldname": df.fieldname,
				"label": df.label or df.fieldname,
				"fieldtype": df.fieldtype,
				"options": df.options,
			}
		)
	return options


def _istable_date_target(meta, parenttype: str, date_field: str):
	if date_field.startswith("@parent."):
		parent_field = date_field.split(".", 1)[1]
		if frappe.get_meta(parenttype).get_field(parent_field):
			return "parent", parent_field, None
		frappe.throw(f"Field {date_field} does not exist on parent {parenttype}.")
	if meta.get_field(date_field):
		return "child", None, date_field
	if frappe.get_meta(parenttype).get_field(date_field):
		return "parent", date_field, None
	frappe.throw(f"Field {date_field} does not exist on {meta.name} or parent {parenttype}.")


def _get_istable_source_values(
	meta,
	source_doctype: str,
	employees: list[str],
	employee_field: str,
	date_field: str,
	hours_field: str,
	qty_field: str,
	rate_field: str,
	start_date: str | None,
	end_date: str | None,
):
	parenttypes = _get_parent_doctypes_for_child(source_doctype)
	if not parenttypes:
		frappe.throw(_("No parent DocType found for child table {0}.").format(source_doctype))
	parenttype = parenttypes[0]
	parent_meta = frappe.get_meta(parenttype)
	date_on, parent_date_field, child_date_field = _istable_date_target(meta, parenttype, date_field)

	parent_filters = {}
	if date_on == "parent":
		_apply_date_filters(parent_filters, parent_date_field, start_date, end_date)
	if parent_meta.is_submittable:
		parent_filters["docstatus"] = 1

	parent_names = None
	if date_on == "parent" or parent_filters:
		parent_names = frappe.get_all(
			parenttype,
			filters=parent_filters or None,
			pluck="name",
			limit_page_length=5000,
		)

	child_filters = {
		"parenttype": parenttype,
		employee_field: ["in", employees],
	}
	if parent_names is not None:
		child_filters["parent"] = ["in", parent_names or [""]]
	if date_on == "child":
		_apply_date_filters(child_filters, child_date_field, start_date, end_date)

	child_fields = ["name", "parent", employee_field]
	for fieldname in [hours_field, qty_field, rate_field]:
		if fieldname and fieldname not in child_fields:
			child_fields.append(fieldname)

	rows = frappe.get_all(
		source_doctype,
		filters=child_filters,
		fields=list(dict.fromkeys(child_fields)),
		limit_page_length=5000,
	)
	result = {employee: {"hours": 0.0, "qty": 0.0, "rate": 0.0, "row_names": []} for employee in employees}
	for row in rows:
		employee = row.get(employee_field)
		if employee not in result:
			continue
		hours = float(row.get(hours_field) or 0) if hours_field else 0.0
		qty = float(row.get(qty_field) or 0) if qty_field else 0.0
		rate = float(row.get(rate_field) or 0) if rate_field else 0.0
		item = result[employee]
		item["hours"] += hours
		item["qty"] += qty
		if qty and rate:
			total_amount = item.get("_amount", 0.0) + (qty * rate)
			item["_amount"] = total_amount
			item["rate"] = total_amount / item["qty"] if item["qty"] else 0.0
		elif rate:
			item["rate"] = rate
		item["row_names"].append(row.get("name"))

	for item in result.values():
		item.pop("_amount", None)
	return result


# ---------------------------------------------------------------------------
# Component rules & custom source data
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_doctype_field_options(doctype_name: str):
	if not doctype_name:
		return []

	meta = frappe.get_meta(doctype_name)
	layout_fields = {
		"Section Break",
		"Column Break",
		"Tab Break",
		"HTML",
		"Button",
		"Fold",
		"Heading",
		"Image",
		"Table",
		"Table MultiSelect",
	}

	options = _source_field_options(meta, layout_fields)
	if meta.istable:
		for parent in _get_parent_doctypes_for_child(doctype_name):
			parent_meta = frappe.get_meta(parent)
			for df in parent_meta.fields:
				if not df.fieldname or df.fieldtype in layout_fields:
					continue
				options.append(
					{
						"fieldname": f"@parent.{df.fieldname}",
						"label": f"{parent} › {df.label or df.fieldname}",
						"fieldtype": df.fieldtype,
						"options": df.options,
						"parent_doctype": parent,
					}
				)
	return options


def _is_excluded_structure_component(component_name: str | None, component_type: str | None) -> bool:
	value = (component_name or "").strip().lower()
	component_type = (component_type or "").strip()
	if not value:
		return True
	if component_type == "Earning" and any(
		token in value for token in ("basic", "base salary", "bs salary", "ctc", "gross")
	):
		return True
	if component_type == "Earning" and ("overtime" in value or value == "ot"):
		return True
	if component_type == "Deduction" and "advance" in value:
		return True
	return False


def _get_structure_names_for_company(company: str | None = None) -> list[str]:
	structure_names = frappe.get_all(
		"Salary Structure Assignment",
		filters={"docstatus": 1, **({"company": company} if company else {})},
		pluck="salary_structure",
		distinct=True,
		limit_page_length=1000,
	)
	structure_names = [name for name in structure_names if name]
	if structure_names:
		return structure_names

	meta = frappe.get_meta("Salary Structure")
	if company and meta.get_field("company"):
		structure_names = frappe.get_all(
			"Salary Structure",
			filters={"company": company, "docstatus": ["!=", 2]},
			pluck="name",
			limit_page_length=1000,
		)
		structure_names = [name for name in structure_names if name]
		if structure_names:
			return structure_names

	return frappe.get_all(
		"Salary Structure",
		filters={"docstatus": ["!=", 2]},
		pluck="name",
		limit_page_length=1000,
	)


def _get_component_rules_from_structures(company: str | None = None) -> list[dict]:
	component_map: dict[tuple[str, str], dict] = {}
	for structure_name in _get_structure_names_for_company(company):
		structure = frappe.get_cached_doc("Salary Structure", structure_name)
		for fieldname, component_type in (("earnings", "Earning"), ("deductions", "Deduction")):
			for row in structure.get(fieldname) or []:
				component = row.salary_component
				if _is_excluded_structure_component(component, component_type):
					continue
				key = (component_type, component)
				component_map.setdefault(
					key,
					{
						"salary_component": component,
						"component_type": component_type,
						"enabled": 1,
					},
				)

	return [
		component_map[key]
		for key in sorted(component_map, key=lambda item: (item[0], item[1]))
	]


def _merge_component_rules(existing_rules: list[dict] | None, inferred_rules: list[dict] | None) -> list[dict]:
	existing_rules = existing_rules or []
	inferred_rules = inferred_rules or []
	merged: list[dict] = []
	seen: set[tuple[str, str]] = set()

	def append_rule(rule: dict | None):
		if not rule:
			return
		component = (rule.get("salary_component") or "").strip()
		component_type = (rule.get("component_type") or "").strip()
		if not component:
			return
		if not component_type:
			component_type = frappe.db.get_value("Salary Component", component, "type") or "Earning"
		key = (component_type, component)
		if key in seen:
			return
		seen.add(key)
		merged.append(
			{
				"salary_component": component,
				"component_type": component_type,
				"enabled": cint(rule.get("enabled", 1)),
			}
		)

	for rule in existing_rules:
		append_rule(rule)
	for rule in inferred_rules:
		append_rule(rule)

	return merged


@frappe.whitelist()
def sync_payroll_bulk_component_rules(company: str | None = None):
	settings = frappe.get_single("Payroll Bulk Settings")
	company = company or settings.company or frappe.defaults.get_user_default("Company")
	rules = _merge_component_rules(settings.get("component_rules"), _get_component_rules_from_structures(company))
	settings.set("component_rules", [])
	for rule in rules:
		settings.append("component_rules", rule)
	settings.save(ignore_permissions=True)
	return {"count": len(rules), "company": company, "rules": rules}


@frappe.whitelist()
def get_bulk_source_values(
	employees: list[str] | str,
	source_doctype: str,
	employee_field: str,
	date_field: str,
	hours_field: str | None = None,
	qty_field: str | None = None,
	rate_field: str | None = None,
	start_date: str | None = None,
	end_date: str | None = None,
	batch_name: str | None = None,
):
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employees = [employee for employee in (employees or []) if employee]
	if not employees:
		return {}

	meta = frappe.get_meta(source_doctype)
	employee_field = _validate_field(meta, employee_field)
	date_field = _validate_field(meta, date_field)
	hours_field = _validate_field(meta, hours_field or "")
	qty_field = _validate_field(meta, qty_field or "")
	rate_field = _validate_field(meta, rate_field or "")

	if meta.istable:
		return _get_istable_source_values(
			meta,
			source_doctype,
			employees,
			employee_field,
			date_field,
			hours_field,
			qty_field,
			rate_field,
			start_date,
			end_date,
		)

	_, employee_child_field, employee_table_field, employee_child_doctype = _resolve_source_field(meta, employee_field)
	_, hours_child_field, hours_table_field, _ = _resolve_source_field(meta, hours_field)
	_, qty_child_field, qty_table_field, _ = _resolve_source_field(meta, qty_field)
	_, rate_child_field, rate_table_field, _ = _resolve_source_field(meta, rate_field)

	child_table_field = next(
		(table for table in [employee_table_field, hours_table_field, qty_table_field, rate_table_field] if table),
		None,
	)
	child_doctype = employee_child_doctype if child_table_field else None
	if child_table_field:
		for table in [hours_table_field, qty_table_field, rate_table_field]:
			if table and table != child_table_field:
				frappe.throw(_("Mapped fields must use the same child table ({0}).").format(child_table_field))

	result = {employee: {"hours": 0.0, "qty": 0.0, "rate": 0.0, "row_names": []} for employee in employees}
	has_bulk_payroll_field = bool(meta.get_field("bulk_payroll"))
	has_salary_slip_field = bool(meta.get_field("salary_slip"))

	if child_table_field:
		parent_fields = ["name"]
		if has_bulk_payroll_field:
			parent_fields.append("bulk_payroll")
		if has_salary_slip_field:
			parent_fields.append("salary_slip")
		_, date_child_field, date_table_field, _ = _resolve_source_field(meta, date_field)
		if date_table_field and date_table_field != child_table_field:
			frappe.throw(_("Date field must be on the same child table or parent document."))
		if date_table_field:
			date_filter_field = date_child_field
			date_filter_on = "child"
		else:
			parent_fields.append(date_field)
			date_filter_field = date_field
			date_filter_on = "parent"

		parent_filters = {}
		if date_filter_on == "parent":
			_apply_date_filters(parent_filters, date_filter_field, start_date, end_date)
		if meta.is_submittable:
			parent_filters["docstatus"] = 1

		parent_rows = frappe.get_all(
			source_doctype,
			filters=parent_filters,
			fields=list(dict.fromkeys(parent_fields)),
			limit_page_length=5000,
		)

		child_fields = ["name", "parent", employee_child_field]
		for child_field in [hours_child_field, qty_child_field, rate_child_field, date_child_field if date_filter_on == "child" else ""]:
			if child_field and child_field not in child_fields:
				child_fields.append(child_field)

		for parent in parent_rows:
			if has_salary_slip_field and parent.get("salary_slip"):
				continue
			if has_bulk_payroll_field and parent.get("bulk_payroll") and parent.get("bulk_payroll") != batch_name:
				continue

			child_filters = {
				"parent": parent.name,
				"parenttype": source_doctype,
				"parentfield": child_table_field,
				employee_child_field: ["in", employees],
			}
			if date_filter_on == "child":
				_apply_date_filters(child_filters, date_filter_field, start_date, end_date)

			child_rows = frappe.get_all(
				child_doctype,
				filters=child_filters,
				fields=child_fields,
				limit_page_length=5000,
			)
			for row in child_rows:
				employee = row.get(employee_child_field)
				if employee not in result:
					continue
				hours = float(row.get(hours_child_field) or 0) if hours_child_field else 0.0
				qty = float(row.get(qty_child_field) or 0) if qty_child_field else 0.0
				rate = float(row.get(rate_child_field) or 0) if rate_child_field else 0.0
				item = result[employee]
				item["hours"] += hours
				item["qty"] += qty
				if qty and rate:
					total_amount = item.get("_amount", 0.0) + (qty * rate)
					item["_amount"] = total_amount
					item["rate"] = total_amount / item["qty"] if item["qty"] else 0.0
				elif rate:
					item["rate"] = rate
				item["row_names"].append(parent.name)
	else:
		fields = ["name", employee_field]
		if hours_field:
			fields.append(hours_field)
		if qty_field:
			fields.append(qty_field)
		if rate_field:
			fields.append(rate_field)
		if has_bulk_payroll_field:
			fields.append("bulk_payroll")
		if has_salary_slip_field:
			fields.append("salary_slip")

		filters = [[employee_field, "in", employees]]
		if start_date:
			filters.append([date_field, ">=", start_date])
		if end_date:
			filters.append([date_field, "<=", end_date])
		if meta.is_submittable:
			filters.append(["docstatus", "=", 1])

		rows = frappe.get_all(source_doctype, filters=filters, fields=fields, limit_page_length=5000)

		for row in rows:
			if has_salary_slip_field and row.get("salary_slip"):
				continue
			if has_bulk_payroll_field and row.get("bulk_payroll") and row.get("bulk_payroll") != batch_name:
				continue
			employee = row.get(employee_field)
			if employee not in result:
				continue
			hours = float(row.get(hours_field) or 0) if hours_field else 0.0
			qty = float(row.get(qty_field) or 0) if qty_field else 0.0
			rate = float(row.get(rate_field) or 0) if rate_field else 0.0
			item = result[employee]
			item["hours"] += hours
			item["qty"] += qty
			if qty and rate:
				total_amount = item.get("_amount", 0.0) + (qty * rate)
				item["_amount"] = total_amount
				item["rate"] = total_amount / item["qty"] if item["qty"] else 0.0
			elif rate:
				item["rate"] = rate
			item["row_names"].append(row.get("name"))

	for item in result.values():
		item.pop("_amount", None)

	return result


@frappe.whitelist()
def mark_bulk_source_rows(
	source_doctype: str,
	row_names: list[str] | str,
	batch_name: str | None = None,
	salary_slip: str | None = None,
):
	if isinstance(row_names, str):
		row_names = frappe.parse_json(row_names)
	row_names = [name for name in (row_names or []) if name]
	if not source_doctype or not row_names:
		return {"updated": 0}

	meta = frappe.get_meta(source_doctype)
	values = {}
	if batch_name and meta.get_field("bulk_payroll"):
		values["bulk_payroll"] = batch_name
	if salary_slip and meta.get_field("salary_slip"):
		values["salary_slip"] = salary_slip
	if not values:
		return {"updated": 0}

	updated = 0
	for row_name in row_names:
		if frappe.db.exists(source_doctype, row_name):
			frappe.db.set_value(source_doctype, row_name, values, update_modified=False)
			updated += 1
	return {"updated": updated}


@frappe.whitelist()
def get_bulk_attendance_values(
	employees: list[str] | str,
	source: str,
	start_date: str,
	end_date: str,
):
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employees = [employee for employee in (employees or []) if employee]
	if not employees:
		return {}

	result = {
		employee: {"attendance_days": 0.0, "absent_days": 0.0, "attendance_hours": 0.0, "payment_days": 0.0}
		for employee in employees
	}

	if source == "Attendance":
		rows = frappe.get_all(
			"Attendance",
			filters=[
				["employee", "in", employees],
				["attendance_date", ">=", start_date],
				["attendance_date", "<=", end_date],
				["docstatus", "!=", 2],
			],
			fields=["employee", "status", "working_hours"],
			limit_page_length=5000,
		)
		for row in rows:
			item = result.get(row.employee)
			if not item:
				continue
			status = row.status or ""
			if status in {"Present", "Work From Home", "On Leave"}:
				item["attendance_days"] += 1
				item["payment_days"] += 1
			elif status == "Half Day":
				item["attendance_days"] += 0.5
				item["payment_days"] += 0.5
				item["absent_days"] += 0.5
			elif status == "Absent":
				item["absent_days"] += 1
			item["attendance_hours"] += float(row.working_hours or 0)
		return result

	if source == "Employee Checkin":
		from payroll_bulk.checkin_utils import aggregate_checkin_attendance

		return aggregate_checkin_attendance(employees, start_date, end_date)

	return result


@frappe.whitelist()
def get_bulk_checkin_overtime_values(
	employees: list[str] | str,
	start_date: str,
	end_date: str,
	ot_method: str = "out_in",
):
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employees = [employee for employee in (employees or []) if employee]
	if not employees:
		return {}

	rows = frappe.get_all(
		"Employee Checkin",
		filters=[
			["employee", "in", employees],
			["time", ">=", f"{start_date} 00:00:00"],
			["time", "<=", f"{end_date} 23:59:59"],
		],
		fields=["employee", "time", "log_type", "shift_start", "shift_end", "shift_actual_start", "shift_actual_end"],
		order_by="employee asc, time asc",
		limit_page_length=10000,
	)

	from payroll_bulk.checkin_utils import (
		build_checkin_day_buckets,
		bucket_worked_hours,
		get_employee_holiday_day_map,
		is_countable_checkin_day,
	)

	start = getdate(start_date)
	end = getdate(end_date)
	buckets = build_checkin_day_buckets(rows)
	employee_rows = frappe.get_all("Employee", filters={"name": ["in", employees]}, fields=["name", "company"])
	holiday_map = get_employee_holiday_day_map(employee_rows, start, end)

	per_day = {}
	for row in rows:
		employee = row.employee
		day = getdate(row.time)
		key = (employee, day)
		bucket = per_day.setdefault(
			key,
			{
				"min_time": None,
				"max_time": None,
				"shift_start": None,
				"shift_end": None,
				"actual_start": None,
				"actual_end": None,
			},
		)
		time_value = get_datetime(row.time)
		bucket["min_time"] = time_value if not bucket["min_time"] or time_value < bucket["min_time"] else bucket["min_time"]
		bucket["max_time"] = time_value if not bucket["max_time"] or time_value > bucket["max_time"] else bucket["max_time"]

		if row.shift_start:
			shift_start = get_datetime(row.shift_start)
			bucket["shift_start"] = shift_start if not bucket["shift_start"] or shift_start < bucket["shift_start"] else bucket["shift_start"]
		if row.shift_end:
			shift_end = get_datetime(row.shift_end)
			bucket["shift_end"] = shift_end if not bucket["shift_end"] or shift_end > bucket["shift_end"] else bucket["shift_end"]
		if row.shift_actual_start:
			actual_start = get_datetime(row.shift_actual_start)
			bucket["actual_start"] = actual_start if not bucket["actual_start"] or actual_start < bucket["actual_start"] else bucket["actual_start"]
		if row.shift_actual_end:
			actual_end = get_datetime(row.shift_actual_end)
			bucket["actual_end"] = actual_end if not bucket["actual_end"] or actual_end > bucket["actual_end"] else bucket["actual_end"]

	result = {employee: {"days": 0.0, "worked_hours": 0.0, "shift_hours": 0.0, "overtime_hours": 0.0} for employee in employees}
	for (employee, day), bucket in per_day.items():
		item = result.get(employee)
		if not item:
			continue

		day_key = str(day)
		if day_key in (holiday_map.get(employee) or {}):
			continue

		checkin_bucket = buckets.get((employee, day_key))
		if not is_countable_checkin_day(checkin_bucket):
			continue

		item["days"] += 1

		actual_start = bucket["actual_start"] or bucket["min_time"]
		actual_end = bucket["actual_end"] or bucket["max_time"]
		shift_start = bucket["shift_start"]
		shift_end = bucket["shift_end"]

		worked_hours = bucket_worked_hours(checkin_bucket)
		if not worked_hours and actual_start and actual_end and actual_end > actual_start:
			worked_hours = (actual_end - actual_start).total_seconds() / 3600

		shift_hours = 0.0
		if shift_start and shift_end and shift_end > shift_start:
			shift_hours = (shift_end - shift_start).total_seconds() / 3600

		overtime_hours = worked_hours if ot_method == "out_in" else max(worked_hours - shift_hours, 0.0)
		item["worked_hours"] += worked_hours
		item["shift_hours"] += shift_hours
		item["overtime_hours"] += overtime_hours

	return result


@frappe.whitelist()
def get_bulk_employee_advance_balances(employees=None, company: str | None = None):
	if isinstance(employees, str):
		try:
			employees = json.loads(employees)
		except json.JSONDecodeError:
			employees = [employees]
	employees = [employee for employee in (employees or []) if employee]
	result = {}
	for employee in employees:
		result[employee] = get_employee_advance_balance(employee, company=company)
	return result


@frappe.whitelist()
def get_employee_advance_balance(employee: str, company: str | None = None):
	if not employee:
		return {"employee": "", "balance": 0.0, "count": 0, "advances": []}

	Advance = frappe.qb.DocType("Employee Advance")
	query = (
		frappe.qb.from_(Advance)
		.select(
			Advance.name,
			Advance.purpose,
			Advance.status,
			Advance.paid_amount,
			Advance.claimed_amount,
			Advance.return_amount,
			Advance.posting_date,
		)
		.where(
			(Advance.docstatus == 1)
			& (Advance.employee == employee)
			& (Advance.status.isin(["Paid", "Unpaid"]))
			& (Advance.paid_amount > 0)
		)
	)
	if company:
		query = query.where(Advance.company == company)

	rows = query.run(as_dict=True)
	advances = []
	total_balance = 0.0
	for row in rows:
		balance = flt(row.paid_amount) - flt(row.claimed_amount) - flt(row.return_amount)
		if balance <= 0:
			continue
		total_balance += balance
		advances.append(
			{
				"name": row.name,
				"purpose": row.purpose or row.name,
				"status": row.status,
				"balance": balance,
				"posting_date": row.posting_date,
			}
		)

	return {
		"employee": employee,
		"balance": total_balance,
		"count": len(advances),
		"advances": advances,
	}


# ---------------------------------------------------------------------------
# Accrual accounting (batch-level Journal Entry)
# ---------------------------------------------------------------------------


class _BulkAccrualAdapter:
	"""Minimal Payroll Entry adapter for bulk accrual journal entries."""
	def __init__(self, batch, submitted_salary_slips, payroll_payable_account: str):
		self.batch = batch
		self.doctype = "Bulk Salary Creation"
		self.name = batch.name
		self.company = batch.company
		self.start_date = batch.start_date
		self.end_date = batch.end_date
		self.posting_date = batch.posting_date
		self.payroll_payable_account = payroll_payable_account
		self.cost_center = frappe.get_cached_value("Company", batch.company, "cost_center")
		self.project = None
		self.exchange_rate = 1
		self.employee_based_payroll_payable_entries = {}
		self._advance_deduction_entries = []
		self._submitted_salary_slips = submitted_salary_slips

	def check_permission(self, *_args, **_kwargs):
		return

	def log_error(self, message):
		frappe.log_error(title="Payroll Bulk Accrual", message=message)

	def get(self, key, default=None):
		return getattr(self, key, default)

	def get_sal_slip_list(self, ss_status=1, as_dict=False):
		slips = [slip for slip in self._submitted_salary_slips if slip.docstatus == ss_status]
		if as_dict:
			return [{"name": slip.name, "salary_structure": slip.salary_structure} for slip in slips]
		return slips

	def get_salary_components(self, component_type):
		salary_slips = self.get_sal_slip_list(ss_status=1, as_dict=True)
		if not salary_slips:
			return []

		ss = frappe.qb.DocType("Salary Slip")
		ssd = frappe.qb.DocType("Salary Detail")
		return (
			frappe.qb.from_(ss)
			.join(ssd)
			.on(ss.name == ssd.parent)
			.select(
				ssd.salary_component,
				ssd.amount,
				ssd.parentfield,
				ssd.additional_salary,
				ss.salary_structure,
				ss.employee,
			)
			.where(
				(ssd.parentfield == component_type)
				& (ss.name.isin([d["name"] for d in salary_slips]))
				& (
					(ssd.do_not_include_in_total == 0)
					| ((ssd.do_not_include_in_total == 1) & (ssd.do_not_include_in_accounts == 0))
				)
			)
		).run(as_dict=True)

	def get_salary_component_total(self, component_type=None, employee_wise_accounting_enabled=False):
		salary_components = self.get_salary_components(component_type)
		if not salary_components:
			return {}

		component_dict = {}
		for item in salary_components:
			employee_cost_centers = self.get_payroll_cost_centers_for_employee(
				item.employee, item.salary_structure
			)
			employee_advance = self.get_advance_deduction(component_type, item)

			for cost_center, percentage in employee_cost_centers.items():
				amount_against_cost_center = flt(item.amount) * percentage / 100

				if employee_advance:
					self.add_advance_deduction_entry(
						item, amount_against_cost_center, cost_center, employee_advance
					)
				else:
					key = (item.salary_component, cost_center)
					component_dict[key] = component_dict.get(key, 0) + amount_against_cost_center

				if employee_wise_accounting_enabled:
					self.set_employee_based_payroll_payable_entries(
						component_type, item.employee, amount_against_cost_center
					)

		return self.get_account(component_dict=component_dict)

	def set_journal_entry_in_salary_slips(self, submitted_salary_slips, jv_name=None):
		salary_slip_names = [salary_slip.name for salary_slip in submitted_salary_slips]
		if not salary_slip_names:
			return
		salary_slip = frappe.qb.DocType("Salary Slip")
		(
			frappe.qb.update(salary_slip)
			.set(salary_slip.journal_entry, jv_name)
			.where(salary_slip.name.isin(salary_slip_names))
		).run()

	def make_journal_entry(
		self,
		accounts,
		currencies,
		payroll_payable_account=None,
		voucher_type="Journal Entry",
		user_remark="",
		submitted_salary_slips=None,
		submit_journal_entry=False,
		employee_wise_accounting_enabled=False,
	):
		for row in accounts:
			if row.get("reference_type") == self.doctype:
				row["reference_type"] = None
				row["reference_name"] = None

		if user_remark:
			for row in accounts:
				row["user_remark"] = user_remark

		multi_currency = 1 if len(currencies) > 1 else 0
		journal_entry = frappe.new_doc("Journal Entry")
		journal_entry.voucher_type = voucher_type
		journal_entry.company = self.company
		journal_entry.posting_date = self.posting_date
		journal_entry.party_not_required = False if employee_wise_accounting_enabled else True
		journal_entry.set("accounts", accounts)
		journal_entry.multi_currency = multi_currency
		_apply_bulk_jv_remarks(journal_entry, user_remark)
		if voucher_type == "Journal Entry":
			journal_entry.title = payroll_payable_account
		journal_entry.save(ignore_permissions=True)
		if submit_journal_entry:
			journal_entry.submit()
		if submitted_salary_slips:
			self.set_journal_entry_in_salary_slips(submitted_salary_slips, jv_name=journal_entry.name)
		return journal_entry


for _method_name in (
	"get_salary_component_account",
	"get_account",
	"get_advance_deduction",
	"add_advance_deduction_entry",
	"set_accounting_entries_for_advance_deductions",
	"set_employee_based_payroll_payable_entries",
	"get_payroll_cost_centers_for_employee",
	"get_payable_amount_for_earnings_and_deductions",
	"set_payable_amount_against_payroll_payable_account",
	"get_accounting_entries_and_payable_amount",
	"update_accounting_dimensions",
	"get_amount_and_exchange_rate_for_journal_entry",
):
	setattr(_BulkAccrualAdapter, _method_name, getattr(PayrollEntry, _method_name))


def _get_batch_submitted_salary_slips(batch_name: str):
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	salary_slip_names = [
		row.salary_slip
		for row in batch.employees
		if row.salary_slip and row.salary_slip_status == "Submitted"
	]
	if not salary_slip_names:
		frappe.throw(_("No submitted Salary Slips found for batch {0}.").format(batch_name))
	salary_slips = [frappe.get_doc("Salary Slip", name) for name in salary_slip_names]
	return batch, salary_slips


def _get_common_payroll_payable_account(salary_slips):
	payable_accounts = set()
	for slip in salary_slips:
		account = frappe.db.get_value(
			"Salary Structure Assignment",
			{
				"employee": slip.employee,
				"salary_structure": slip.salary_structure,
				"from_date": ("<=", slip.start_date),
				"docstatus": 1,
			},
			"payroll_payable_account",
			order_by="from_date desc",
		)
		if not account:
			frappe.throw(
				_("Payroll Payable Account is missing on Salary Structure Assignment for {0}.").format(
					slip.employee
				)
			)
		payable_accounts.add(account)

	if len(payable_accounts) != 1:
		frappe.throw(
			_("Submitted slips in this batch use multiple Payroll Payable Accounts: {0}.").format(
				", ".join(sorted(payable_accounts))
			)
		)

	payable_account = next(iter(payable_accounts))
	account_type = frappe.db.get_value("Account", payable_account, "account_type")
	if account_type != "Payable":
		frappe.throw(
			_("Payroll Payable Account {0} must be a Payable account.").format(payable_account)
		)
	return payable_account


def _format_bulk_jv_remark(batch) -> str:
	"""Standard JV remark, e.g. 'Salary F/O Mar-2026, BSC-2026-00022 dated 31-03-2026'."""
	posting_date = getdate(batch.posting_date or batch.end_date or batch.start_date)
	period_start = getdate(batch.start_date or posting_date)
	month_label = period_start.strftime("%b-%Y")
	dated = posting_date.strftime("%d-%m-%Y")
	return f"Salary F/O {month_label}, {batch.name} dated {dated}"


def _apply_bulk_jv_remarks(target, remark: str):
	"""Set Journal Entry remark/user_remark and child account user_remark."""
	if not remark:
		return target
	if isinstance(target, dict):
		target["custom_remark"] = 1
		target["remark"] = remark
		target["user_remark"] = remark
		for row in target.get("accounts") or []:
			row["user_remark"] = remark
		return target

	target.custom_remark = 1
	target.remark = remark
	target.user_remark = remark
	for row in target.get("accounts") or []:
		row.user_remark = remark
	return target


# ---------------------------------------------------------------------------
# Payment accounting (Bank/Cash Journal Entry)
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_salary_payable_account(slip_name: str, batch_name: str | None = None):
	"""Resolve Payroll Payable account from batch row, SSA, or accrual JE."""
	if not slip_name or not frappe.db.exists("Salary Slip", slip_name):
		frappe.throw(_("Salary Slip {0} not found.").format(slip_name))

	filters = {"salary_slip": slip_name}
	if batch_name:
		filters["parent"] = batch_name
	row_account = frappe.db.get_value("Bulk Salary Creation Employee", filters, "payroll_payable_account")
	if row_account:
		return row_account

	slip = frappe.get_cached_doc("Salary Slip", slip_name)
	account = frappe.db.get_value(
		"Salary Structure Assignment",
		{
			"employee": slip.employee,
			"salary_structure": slip.salary_structure,
			"docstatus": 1,
			"from_date": ("<=", slip.start_date),
		},
		"payroll_payable_account",
		order_by="from_date desc",
	)
	if account:
		return account

	if slip.journal_entry:
		account = frappe.db.get_value(
			"Journal Entry Account",
			{"parent": slip.journal_entry, "credit_in_account_currency": (">", 0)},
			"account",
			order_by="credit_in_account_currency desc",
		)
		if account and frappe.db.get_value("Account", account, "account_type") == "Payable":
			return account

	frappe.throw(_("Could not detect payable account for Salary Slip {0}.").format(slip_name))


@frappe.whitelist()
def get_batch_completed_summary(batch_name: str):
	"""Totals, salary component columns, and JV references for the completed view."""
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	component_meta = {}
	employees = []

	for row in batch.employees:
		days = flt(row.payment_days) or 30
		base_pay = _pb_money(flt(row.ctc) / 30 * days)
		item = {
			"employee": row.employee,
			"employee_name": row.employee_name,
			"department": row.department,
			"ctc": _pb_money(row.ctc),
			"payment_days": days,
			"base_pay": base_pay,
			"ot_amount": _pb_money(row.ot_amount),
			"gross_pay": _pb_money(row.gross_pay),
			"adv_deduct": _pb_money(row.adv_deduct),
			"net_pay": _pb_money(row.net_pay),
			"salary_slip": row.salary_slip,
			"salary_slip_status": row.salary_slip_status,
			"payment_entry": row.payment_entry,
			"payment_status": row.payment_status,
			"status": row.status,
			"components": {},
		}
		if row.salary_slip and frappe.db.exists("Salary Slip", row.salary_slip):
			for detail in frappe.get_all(
				"Salary Detail",
				filters={"parent": row.salary_slip, "parenttype": "Salary Slip"},
				fields=["salary_component", "amount", "parentfield"],
			):
				amount = flt(detail.amount)
				if not amount:
					continue
				key = detail.salary_component
				if key and str(key).lower() in ("basic", "basic salary", "overtime", "ot"):
					continue
				component_type = "deduction" if detail.parentfield == "deductions" else "earning"
				component_meta[key] = {"label": key, "type": component_type}
				item["components"][key] = flt(item["components"].get(key, 0)) + amount
		employees.append(item)

	columns = sorted(
		component_meta.keys(),
		key=lambda name: (0 if component_meta[name]["type"] == "earning" else 1, name.lower()),
	)
	component_totals = {name: 0 for name in columns}
	for item in employees:
		for name in columns:
			component_totals[name] += flt(item["components"].get(name, 0))

	payment_journals = sorted({row.payment_entry for row in batch.employees if row.payment_entry})
	return {
		"remark": _format_bulk_jv_remark(batch),
		"accrual_journal_entry": batch.accrual_journal_entry,
		"bulk_payment_entry": batch.get("bulk_payment_entry"),
		"payment_journals": payment_journals,
		"columns": [{"key": name, **component_meta[name]} for name in columns],
		"employees": employees,
		"totals": {
			"ctc": _pb_money(sum(flt(row.ctc) for row in batch.employees)),
			"base_pay": _pb_money(sum(_pb_money(flt(row.ctc) / 30 * (flt(row.payment_days) or 30)) for row in batch.employees)),
			"ot_amount": _pb_money(sum(flt(row.ot_amount) for row in batch.employees)),
			"gross_pay": _pb_money(sum(flt(row.gross_pay) for row in batch.employees)),
			"adv_deduct": _pb_money(sum(flt(row.adv_deduct) for row in batch.employees)),
			"net_pay": _pb_money(sum(flt(row.net_pay) for row in batch.employees)),
			"components": component_totals,
		},
	}


@frappe.whitelist()
def create_bulk_payment_journal_entry(
	batch_name: str,
	pay_from_account: str,
	payment_date: str | None = None,
	employees: list | str | None = None,
	reference_no: str | None = None,
):
	"""Create one Bank/Cash JE debiting Payroll Payable for unpaid submitted rows."""
	if not batch_name or not pay_from_account:
		frappe.throw(_("Batch and pay-from account are required."))

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employee_set = set(employees or [])
	payment_date = payment_date or batch.posting_date or frappe.utils.today()
	remark = _format_bulk_jv_remark(batch)
	reference_no = (reference_no or "").strip()

	rows = [
		row
		for row in batch.employees
		if row.salary_slip
		and row.salary_slip_status == "Submitted"
		and not row.payment_entry
		and (not employee_set or row.employee in employee_set)
	]
	if not rows:
		frappe.throw(_("No submitted unpaid employee rows found for payment."))

	account_type = frappe.db.get_value("Account", pay_from_account, "account_type")
	voucher_type = "Cash Entry" if account_type == "Cash" else "Bank Entry"
	accounts = []
	total_net = 0

	for row in rows:
		payable_account = get_salary_payable_account(row.salary_slip, batch_name=batch_name)
		amount = flt(row.net_pay)
		if amount <= 0:
			continue
		total_net += amount
		accounts.append(
			{
				"account": payable_account,
				"party_type": "Employee",
				"party": row.employee,
				"debit_in_account_currency": amount,
				"credit_in_account_currency": 0,
			}
		)

	if not accounts:
		frappe.throw(_("No payable amounts found for payment."))

	accounts.append(
		{
			"account": pay_from_account,
			"debit_in_account_currency": 0,
			"credit_in_account_currency": total_net,
		}
	)

	je_data = {
		"doctype": "Journal Entry",
		"voucher_type": voucher_type,
		"posting_date": payment_date,
		"company": batch.company,
		"accounts": accounts,
	}
	_apply_bulk_jv_remarks(je_data, remark)
	# ERPNext requires Reference No + Date for Bank Entry; Cash only if reference is given.
	if voucher_type == "Bank Entry":
		je_data["cheque_no"] = reference_no or batch_name
		je_data["cheque_date"] = payment_date
	elif reference_no:
		je_data["cheque_no"] = reference_no
		je_data["cheque_date"] = payment_date

	journal_entry = frappe.get_doc(je_data)
	journal_entry.insert(ignore_permissions=True)
	journal_entry.submit()

	for row in rows:
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row.name,
			{
				"payment_entry": journal_entry.name,
				"payment_status": "Payment Created",
				"status": "Payment Created",
			},
			update_modified=False,
		)

	if len(rows) == len([r for r in batch.employees if r.salary_slip_status == "Submitted"]):
		batch.db_set("bulk_payment_entry", journal_entry.name)

	from payroll_bulk.events.salary_slip import _update_batch_summary

	_update_batch_summary(batch_name)
	frappe.db.commit()
	return {
		"journal_entry": journal_entry.name,
		"employee_count": len(rows),
		"total_net": total_net,
		"remark": remark,
	}


def _resolve_batch_accrual_journal_entry(batch, salary_slips) -> str | None:
	"""Link batch to accrual JE already set on submitted salary slips."""
	if batch.get("accrual_journal_entry"):
		return batch.accrual_journal_entry

	existing = sorted({slip.journal_entry for slip in salary_slips if slip.journal_entry})
	if not existing:
		return None
	if len(existing) == 1:
		je_name = existing[0]
		batch.db_set("accrual_journal_entry", je_name)
		frappe.db.commit()
		return je_name

	frappe.throw(
		_("Submitted slips in this batch use multiple accrual Journal Entries: {0}.").format(
			", ".join(existing)
		)
	)


@frappe.whitelist()
def create_bulk_accrual_journal_entry(batch_name: str):
	"""Create accrual JE from submitted slips (reuses Payroll Entry accounting)."""
	batch, salary_slips = _get_batch_submitted_salary_slips(batch_name)
	pending_slips = [slip for slip in salary_slips if not slip.journal_entry]
	if not pending_slips:
		resolved = _resolve_batch_accrual_journal_entry(batch, salary_slips)
		if resolved:
			return {"journal_entry": resolved, "created": False, "linked": True}
		frappe.throw(_("All submitted Salary Slips in this batch already have accrual Journal Entries."))

	payroll_payable_account = _get_common_payroll_payable_account(pending_slips)
	adapter = _BulkAccrualAdapter(batch, pending_slips, payroll_payable_account)

	employee_wise_accounting_enabled = frappe.db.get_single_value(
		"Payroll Settings", "process_payroll_accounting_entry_based_on_employee"
	)
	adapter.employee_based_payroll_payable_entries = {}
	adapter._advance_deduction_entries = []

	earnings = (
		adapter.get_salary_component_total(
			component_type="earnings",
			employee_wise_accounting_enabled=employee_wise_accounting_enabled,
		)
		or {}
	)
	deductions = (
		adapter.get_salary_component_total(
			component_type="deductions",
			employee_wise_accounting_enabled=employee_wise_accounting_enabled,
		)
		or {}
	)
	if not earnings and not deductions:
		frappe.throw(_("No earning or deduction components found on submitted Salary Slips."))

	accounts = []
	currencies = []
	payable_amount = 0
	accounting_dimensions = get_accounting_dimensions() or []
	company_currency = erpnext.get_company_currency(batch.company)
	precision = frappe.get_precision("Journal Entry Account", "debit_in_account_currency")

	payable_amount = adapter.get_payable_amount_for_earnings_and_deductions(
		accounts,
		earnings,
		deductions,
		currencies,
		company_currency,
		accounting_dimensions,
		precision,
		payable_amount,
		employee_wise_accounting_enabled,
	)
	payable_amount = adapter.set_accounting_entries_for_advance_deductions(
		accounts,
		currencies,
		company_currency,
		accounting_dimensions,
		precision,
		payable_amount,
	)
	adapter.set_payable_amount_against_payroll_payable_account(
		accounts,
		currencies,
		company_currency,
		accounting_dimensions,
		precision,
		payable_amount,
		payroll_payable_account,
		employee_wise_accounting_enabled,
	)

	journal_entry = adapter.make_journal_entry(
		accounts,
		currencies,
		payroll_payable_account,
		voucher_type="Journal Entry",
		user_remark=_format_bulk_jv_remark(batch),
		submitted_salary_slips=pending_slips,
		submit_journal_entry=True,
		employee_wise_accounting_enabled=employee_wise_accounting_enabled,
	)
	batch.db_set("accrual_journal_entry", journal_entry.name)
	return {"journal_entry": journal_entry.name, "created": True}


@frappe.whitelist()
def sync_salary_structure_assignment_base(assignment_name: str, base: float):
	if not assignment_name:
		frappe.throw(_("Salary Structure Assignment is required."))
	base = flt(base)
	if base <= 0:
		frappe.throw(_("Base must be greater than zero."))
	if not frappe.db.exists("Salary Structure Assignment", assignment_name):
		frappe.throw(_("Salary Structure Assignment {0} not found.").format(assignment_name))
	frappe.db.set_value("Salary Structure Assignment", assignment_name, "base", base, update_modified=True)
	return {"assignment_name": assignment_name, "base": base}


# ---------------------------------------------------------------------------
# Salary slip lifecycle & batch processing
# ---------------------------------------------------------------------------


def _get_salary_structure_assignment(employee: str, payroll_frequency: str, start_date: str, end_date: str):
	assignment = frappe.db.sql(
		"""
		select
			ssa.name,
			ssa.salary_structure,
			ssa.base,
			ssa.from_date,
			ssa.payroll_payable_account
		from `tabSalary Structure Assignment` ssa
		inner join `tabSalary Structure` ss on ss.name = ssa.salary_structure
		where
			ssa.docstatus = 1
			and ss.docstatus = 1
			and ss.is_active = 'Yes'
			and ssa.employee = %s
			and ss.payroll_frequency = %s
			and (
				ssa.from_date <= %s
				or ssa.from_date <= %s
			)
		order by ssa.from_date desc
		limit 1
		""",
		(employee, payroll_frequency, start_date, end_date),
		as_dict=True,
	)
	if not assignment:
		frappe.throw(
			_("No active Salary Structure Assignment found for employee {0}.").format(employee)
		)
	return assignment[0]


def _cancel_or_delete_existing_slip(slip_name: str):
	if not slip_name or not frappe.db.exists("Salary Slip", slip_name):
		return
	slip = frappe.get_doc("Salary Slip", slip_name)
	row_name = slip.get("bulk_salary_creation_employee")
	batch_name = slip.get("bulk_salary_creation")
	if slip.docstatus == 2:
		return
	if slip.get("journal_entry"):
		frappe.throw(
			_("Salary Slip {0} already has accrual Journal Entry {1}. Cancel that first.").format(
				slip.name, slip.journal_entry
			)
		)
	if slip.get("payment_entry"):
		frappe.throw(
			_("Salary Slip {0} already has payment reference {1}. Cancel that first.").format(
				slip.name, slip.payment_entry
			)
		)
	if slip.docstatus == 1:
		slip.cancel()
		_cancel_batch_additional_salaries(batch_name, employee=slip.employee)
	else:
		if row_name and frappe.db.exists("Bulk Salary Creation Employee", row_name):
			frappe.db.set_value(
				"Bulk Salary Creation Employee",
				row_name,
				{
					"salary_slip": "",
					"salary_slip_status": "",
					"status": "Pending",
					"error_message": "",
				},
				update_modified=False,
			)
		frappe.delete_doc("Salary Slip", slip.name, force=1, ignore_permissions=True)
		if batch_name:
			_cancel_batch_additional_salaries(batch_name, employee=slip.employee)
		if batch_name and frappe.db.exists("Bulk Salary Creation", batch_name):
			from payroll_bulk.events.salary_slip import _update_batch_summary

			_update_batch_summary(batch_name)


def _reset_batch_row_link(row_name: str, status: str = "Pending", salary_slip_status: str = "", error_message: str = ""):
	if row_name and frappe.db.exists("Bulk Salary Creation Employee", row_name):
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row_name,
			{
				"salary_slip": "",
				"salary_slip_status": salary_slip_status,
				"status": status,
				"error_message": error_message,
				"payment_entry": "",
			},
			update_modified=False,
		)


def _clear_salary_slip_bulk_links(slip):
	updates = {}
	for fieldname in ("bulk_salary_creation", "bulk_salary_creation_employee"):
		if slip.meta.get_field(fieldname):
			updates[fieldname] = ""
	if updates:
		frappe.db.set_value("Salary Slip", slip.name, updates, update_modified=False)


@frappe.whitelist()
def unlink_bulk_salary_slip(batch_name: str, row_name: str, action: str = "unlink"):
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))
	if not row.salary_slip:
		return {"ok": True, "message": _("No Salary Slip linked.")}

	slip = frappe.get_doc("Salary Slip", row.salary_slip)
	if action == "delete_draft":
		if slip.docstatus != 0:
			frappe.throw(_("Only Draft Salary Slips can be deleted from Bulk Salary Creation."))
		_clear_salary_slip_bulk_links(slip)
		_reset_batch_row_link(row_name)
		_cancel_batch_additional_salaries(batch_name, employee=row.employee)
		frappe.delete_doc("Salary Slip", slip.name, force=1, ignore_permissions=True)
	elif action == "cancel_unlink":
		if slip.docstatus != 1:
			frappe.throw(_("Only Submitted Salary Slips can be cancelled from Bulk Salary Creation."))
		if slip.get("journal_entry"):
			frappe.throw(_("Cancel accrual Journal Entry {0} first.").format(slip.journal_entry))
		if slip.get("payment_entry"):
			frappe.throw(_("Cancel payment reference {0} first.").format(slip.payment_entry))
		slip.cancel()
		_cancel_batch_additional_salaries(batch_name, employee=row.employee)
		_clear_salary_slip_bulk_links(slip)
		_reset_batch_row_link(row_name)
	elif action == "unlink":
		_clear_salary_slip_bulk_links(slip)
		_reset_batch_row_link(row_name)
	else:
		frappe.throw(_("Unsupported action {0}.").format(action))

	if batch_name and frappe.db.exists("Bulk Salary Creation", batch_name):
		from payroll_bulk.events.salary_slip import _update_batch_summary
		_update_batch_summary(batch_name)

	return {"ok": True, "message": _("Salary Slip link updated."), "action": action, "salary_slip": slip.name}


def _replace_salary_slip_rows(target_slip, source_slip):
	for parentfield in ("earnings", "deductions"):
		frappe.db.delete("Salary Detail", {"parent": target_slip.name, "parentfield": parentfield})
		for idx, row in enumerate(source_slip.get(parentfield) or [], start=1):
			data = row.as_dict(no_nulls=True)
			for key in (
				"name",
				"parent",
				"parentfield",
				"parenttype",
				"owner",
				"creation",
				"modified",
				"modified_by",
				"docstatus",
				"idx",
			):
				data.pop(key, None)
			data.update(
				{
					"doctype": "Salary Detail",
					"parent": target_slip.name,
					"parentfield": parentfield,
					"parenttype": "Salary Slip",
					"idx": idx,
				}
			)
			frappe.get_doc(data).db_insert()

	frappe.db.set_value(
		"Salary Slip",
		target_slip.name,
		{
			"gross_pay": source_slip.gross_pay,
			"net_pay": source_slip.net_pay,
			"total_deduction": source_slip.total_deduction,
			"base_gross_pay": source_slip.base_gross_pay,
			"base_net_pay": source_slip.base_net_pay,
			"base_total_deduction": source_slip.base_total_deduction,
			"payment_days": source_slip.payment_days,
			"absent_days": source_slip.absent_days,
			"total_working_days": source_slip.total_working_days,
			"salary_structure": source_slip.salary_structure,
		},
		update_modified=False,
	)
	target_slip.reload()


def _guess_base_component(structure_doc):
	keywords = ("basic", "base", "salary", "bs ")
	for row in structure_doc.get("earnings") or []:
		component_name = (row.salary_component or "").lower()
		if row.depends_on_payment_days:
			return row.salary_component
		if any(keyword in component_name for keyword in keywords):
			return row.salary_component
	return (structure_doc.get("earnings") or [None])[0].salary_component if structure_doc.get("earnings") else ""


def _guess_component(structure_doc, table: str, keywords: tuple[str, ...]) -> str:
	for row in structure_doc.get(table) or []:
		component_name = (row.salary_component or "").lower()
		if any(keyword in component_name for keyword in keywords):
			return row.salary_component
	return ""


def _structure_needs_base_fallback(structure_doc) -> bool:
	for row in structure_doc.get("earnings") or []:
		if flt(row.amount):
			return False
		if (row.formula or "").strip():
			return False
	return True


def _manual_base_amount(row, manual_salary_basis: str | None, ctc: float, daily: float) -> float:
	"""Pakistan monthly basis: CTC ÷ 30 × eligible days (full month / payment / absent)."""
	basis = manual_salary_basis or "Full Month"
	if basis == "By Payment Days":
		days = flt(row.get("payment_days"))
		return _pb_money(daily * days) if days else _pb_money(ctc)
	if basis == "Deduct Absent Days":
		absent = flt(row.get("absent_days"))
		return _pb_money(daily * max(0, 30 - absent)) if absent else _pb_money(ctc)
	days = flt(row.get("payment_days")) or 30
	return _pb_money(daily * days)


def _calculate_batch_base_amount(
	row,
	calculation_mode: str | None = None,
	manual_salary_basis: str | None = None,
	overtime_with_salary: int | bool = 0,
) -> float:
	"""Compute base salary amount per calculation mode before Additional Salary sync."""
	ctc = flt(row.get("ctc"))
	daily = flt(ctc / 30) if ctc else 0

	if calculation_mode in ("Attendance Based", "Checkin Based"):
		days = flt(row.get("payment_days")) or flt(row.get("attendance_days"))
		return flt(daily * days) if days else 0

	if calculation_mode == "Per Piece or Per Hour":
		if cint(overtime_with_salary):
			return _manual_base_amount(row, manual_salary_basis, ctc, daily)
		hourly_rate = flt(ctc / 30 / 8) if ctc else 0
		return flt(hourly_rate * flt(row.get("source_hours")) + flt(row.get("source_qty")) * flt(row.get("piece_rate")))

	return _manual_base_amount(row, manual_salary_basis, ctc, daily)


def _ensure_row_attendance_loaded(row, batch, options: dict):
	mode = batch.calculation_mode or "Manual"
	manual_basis = batch.get("manual_salary_basis") or "Full Month"
	needs_attendance = mode in ("Attendance Based", "Checkin Based") or (
		mode == "Manual" and manual_basis in ("By Payment Days", "Deduct Absent Days")
	)
	if not needs_attendance:
		return
	if flt(row.payment_days) or flt(row.attendance_days):
		return

	source = "Employee Checkin" if mode == "Checkin Based" else "Attendance"
	values = get_bulk_attendance_values([row.employee], source, options["start_date"], options["end_date"])
	item = values.get(row.employee) or {}
	if not any(flt(item.get(field)) for field in ("attendance_days", "payment_days", "absent_days")):
		return

	updates = {
		"attendance_days": item.get("attendance_days") or 0,
		"absent_days": item.get("absent_days") or 0,
		"attendance_hours": item.get("attendance_hours") or 0,
		"payment_days": item.get("payment_days") or 0,
	}
	frappe.db.set_value("Bulk Salary Creation Employee", row.name, updates, update_modified=False)
	for field, value in updates.items():
		row.set(field, value)


def _ensure_row_manual_payment_days(row, batch):
	mode = batch.calculation_mode or "Manual"
	if mode != "Manual":
		return
	basis = batch.get("manual_salary_basis") or "Full Month"
	if basis == "Full Month" and not flt(row.payment_days):
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row.name,
			"payment_days",
			30,
			update_modified=False,
		)
		row.payment_days = 30


def _validate_row_source_days(row, batch, start_date: str, end_date: str):
	mode = batch.calculation_mode or "Manual"
	if mode in ("Attendance Based", "Checkin Based"):
		days = flt(row.payment_days) or flt(row.attendance_days)
		if not days:
			frappe.throw(
				_(
					"No attendance/checkin days for {0} between {1} and {2}. "
					"Mark attendance, click Load Source, or switch to Manual mode."
				).format(row.employee, start_date, end_date)
			)


def _batch_needs_source_recalc(batch) -> bool:
	mode = batch.calculation_mode or "Manual"
	manual_basis = batch.get("manual_salary_basis") or "Full Month"
	for row in batch.get("employees") or []:
		if not row.get("employee"):
			continue
		if mode in ("Attendance Based", "Checkin Based"):
			if not flt(row.payment_days) and not flt(row.attendance_days):
				return True
		elif mode == "Manual" and manual_basis in ("By Payment Days", "Deduct Absent Days"):
			if not flt(row.payment_days) and not flt(row.attendance_days):
				return True
		elif mode == "Per Piece or Per Hour":
			if not flt(row.source_hours) and not flt(row.source_qty):
				return True
		elif mode == "Manual" and manual_basis == "Full Month":
			if not flt(row.payment_days):
				return True
	overtime_source = batch.get("overtime_source") or "Manual"
	if overtime_source != "Manual":
		for row in batch.get("employees") or []:
			if not row.get("employee"):
				continue
			if not flt(row.ot_input) and not flt(row.overtime_hours) and not flt(row.ot_amount):
				return True
	return False


@frappe.whitelist()
def ensure_bulk_batch_source_data(
	batch_name: str,
	start_date: str | None = None,
	end_date: str | None = None,
):
	"""Load attendance/checkin days onto batch employee rows before salary slip creation."""
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	start_date = batch.start_date or start_date
	end_date = batch.end_date or end_date
	if not start_date or not end_date:
		frappe.throw(_("Batch start and end dates are required."))

	options = {"start_date": start_date, "end_date": end_date}
	for row in batch.employees:
		if not row.employee:
			continue
		_ensure_row_attendance_loaded(row, batch, options)
		_ensure_row_manual_payment_days(row, batch)

	from payroll_bulk.source_recalc import recalculate_bulk_salary_source

	try:
		if _batch_needs_source_recalc(batch) and recalculate_bulk_salary_source(batch):
			batch.save(ignore_permissions=True)
	except Exception:
		frappe.log_error(title=f"Bulk source recalc failed for {batch_name}")

	batch.reload()
	rows_out = []
	for row in batch.employees:
		if not row.employee:
			continue
		rows_out.append(
			{
				"employee": row.employee,
				"payment_days": flt(row.payment_days),
				"attendance_days": flt(row.attendance_days),
				"absent_days": flt(row.absent_days),
				"ot_amount": flt(row.ot_amount),
				"source_hours": flt(row.source_hours),
			}
		)
	return {
		"batch_name": batch_name,
		"start_date": start_date,
		"end_date": end_date,
		"calculation_mode": batch.calculation_mode,
		"rows": rows_out,
	}


def _cancel_batch_additional_salaries(batch_name: str, employee: str | None = None):
	"""Cancel or delete Additional Salary rows linked to a bulk batch."""
	filters = {
		"ref_doctype": "Bulk Salary Creation",
		"ref_docname": batch_name,
		"docstatus": ["<", 2],
	}
	if employee:
		filters["employee"] = employee

	cancelled = 0
	for name in frappe.get_all("Additional Salary", filters=filters, pluck="name"):
		doc = frappe.get_doc("Additional Salary", name)
		if doc.docstatus == 1:
			doc.cancel()
			cancelled += 1
		elif doc.docstatus == 0:
			frappe.delete_doc("Additional Salary", doc.name, force=1, ignore_permissions=True)
			cancelled += 1
	return cancelled


def _get_existing_additional_salaries(employee: str, payroll_date: str, component: str, batch_name: str):
	return frappe.get_all(
		"Additional Salary",
		filters={
			"employee": employee,
			"salary_component": component,
			"ref_doctype": "Bulk Salary Creation",
			"ref_docname": batch_name,
			"docstatus": ["<", 2],
		},
		fields=["name", "docstatus", "payroll_date", "amount", "from_date", "to_date"],
		limit_page_length=20,
	)


def _upsert_additional_salary(
	row,
	company: str,
	component: str,
	component_type: str,
	amount: float,
	start_date: str,
	end_date: str,
	posting_date: str,
	batch_name: str,
):
	amount = flt(amount)
	if not component or amount <= 0:
		return

	existing_rows = _get_existing_additional_salaries(row.employee, posting_date, component, batch_name)
	foreign_rows = frappe.get_all(
		"Additional Salary",
		filters={
			"employee": row.employee,
			"salary_component": component,
			"payroll_date": posting_date,
			"ref_doctype": "Bulk Salary Creation",
			"ref_docname": ["!=", batch_name],
			"docstatus": ["<", 2],
		},
		fields=["name", "ref_docname", "docstatus"],
		limit_page_length=10,
	)
	if foreign_rows:
		other_batches = sorted({row.ref_docname for row in foreign_rows if row.ref_docname})
		frappe.throw(
			_(
				"Additional Salary for {0} / {1} already exists in batch {2}. "
				"Cancel that batch row first before creating here."
			).format(row.employee, component, ", ".join(other_batches))
		)

	for existing_row in existing_rows:
		doc = frappe.get_doc("Additional Salary", existing_row.name)
		if (
			doc.docstatus == 1
			and flt(doc.amount) == amount
			and str(doc.payroll_date) == str(posting_date)
			and str(doc.from_date) == str(start_date)
			and str(doc.to_date) == str(end_date)
		):
			return doc.name
		if doc.docstatus == 1:
			doc.cancel()
		else:
			frappe.delete_doc("Additional Salary", doc.name, force=1, ignore_permissions=True)

	additional_salary = frappe.get_doc(
		{
			"doctype": "Additional Salary",
			"employee": row.employee,
			"employee_name": row.employee_name or row.employee,
			"department": row.get("department") or "",
			"company": company,
			"is_recurring": 0,
			"from_date": start_date,
			"to_date": end_date,
			"payroll_date": posting_date,
			"salary_component": component,
			"type": component_type,
			"amount": amount,
			"overwrite_salary_structure_amount": 0,
			"ref_doctype": "Bulk Salary Creation",
			"ref_docname": batch_name,
		}
	)
	if additional_salary.meta.get_field("bulk_salary_creation"):
		additional_salary.bulk_salary_creation = batch_name
	additional_salary.insert(ignore_permissions=True)
	additional_salary.submit()
	return additional_salary.name


def _create_base_additional_salary_if_needed(
	row,
	assignment,
	company,
	start_date,
	end_date,
	posting_date,
	batch_name,
	calculation_mode: str | None = None,
	manual_salary_basis: str | None = None,
	overtime_with_salary: int | bool = 0,
):
	if calculation_mode == "Per Piece or Per Hour" and not cint(overtime_with_salary):
		return

	structure_doc = frappe.get_cached_doc("Salary Structure", assignment.salary_structure)
	if not _structure_needs_base_fallback(structure_doc):
		return

	base_component = _guess_base_component(structure_doc)
	base_amount = _calculate_batch_base_amount(
		row, calculation_mode, manual_salary_basis, overtime_with_salary
	)
	if not base_component or base_amount <= 0:
		return

	_upsert_additional_salary(
		row, company, base_component, "Earning", base_amount, start_date, end_date, posting_date, batch_name
	)


RECONCILE_TOLERANCE = 1


def _batch_row_expected_gross_net(row, batch) -> tuple[float, float]:
	"""Expected batch pay from components / CTC — not slip-synced zeros."""
	components = _get_batch_component_entries(batch.name, row.name, row.employee)
	earning_total = sum(
		flt(c.amount) for c in components if (c.component_type or "Earning") != "Deduction"
	)
	deduction_total = sum(
		flt(c.amount) for c in components if (c.component_type or "") == "Deduction"
	)

	if earning_total > RECONCILE_TOLERANCE:
		gross = earning_total
	elif flt(row.total_additions) > RECONCILE_TOLERANCE:
		gross = flt(row.total_additions)
	else:
		base = _calculate_batch_base_amount(
			row,
			batch.calculation_mode,
			batch.get("manual_salary_basis"),
			batch.get("overtime_with_salary"),
		)
		gross = base + flt(row.ot_amount) + flt(row.bonus_amount) + flt(row.other_allowance)

	if gross <= RECONCILE_TOLERANCE and flt(row.ctc) > RECONCILE_TOLERANCE:
		days = flt(row.payment_days) or 30
		gross = flt(row.ctc) / 30 * days + flt(row.ot_amount)

	stored_gross = flt(row.gross_pay)
	stored_net = flt(row.net_pay)
	if stored_gross > RECONCILE_TOLERANCE and stored_gross >= gross - RECONCILE_TOLERANCE:
		gross = stored_gross

	row_deductions = flt(row.adv_deduct) + flt(row.late_deduction) + flt(row.other_deduction)
	if deduction_total > RECONCILE_TOLERANCE:
		row_deductions = max(row_deductions, deduction_total)
	elif flt(row.total_deductions) > RECONCILE_TOLERANCE:
		row_deductions = max(row_deductions, flt(row.total_deductions))

	net = max(0, gross - row_deductions)
	if stored_net > RECONCILE_TOLERANCE and stored_gross > RECONCILE_TOLERANCE:
		net = stored_net
	return gross, net


def _reconcile_row_issue(expected_gross, expected_net, slip_gross, slip_net, has_ctc: bool) -> tuple[bool, str]:
	gross_diff = expected_gross - slip_gross
	net_diff = expected_net - slip_net
	if abs(gross_diff) > RECONCILE_TOLERANCE or abs(net_diff) > RECONCILE_TOLERANCE:
		if slip_gross <= RECONCILE_TOLERANCE and expected_gross > RECONCILE_TOLERANCE:
			return False, "Empty slip (zero gross)"
		if slip_net <= RECONCILE_TOLERANCE and expected_net > RECONCILE_TOLERANCE:
			return False, "Empty slip (zero net)"
		return False, "Amount mismatch"
	if expected_gross <= RECONCILE_TOLERANCE and slip_gross <= RECONCILE_TOLERANCE and has_ctc:
		return False, "Zero amounts (check payment days / source)"
	return True, ""


def _pb_money(value) -> float:
	return round(flt(value))


@frappe.whitelist()
def get_batch_slip_reconciliation(batch_name: str):
	"""Compare batch employee row totals with linked Salary Slip amounts."""
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	rows = []
	summary = {"total": 0, "matched": 0, "mismatched": 0, "missing_slip": 0, "no_row": 0, "zero_slip": 0}

	for row in batch.employees:
		expected_gross, expected_net = _batch_row_expected_gross_net(row, batch)
		item = {
			"employee": row.employee,
			"employee_name": row.employee_name,
			"department": row.department,
			"salary_slip": row.salary_slip or "",
			"salary_slip_status": row.salary_slip_status or "",
			"batch_gross": expected_gross,
			"batch_net": expected_net,
			"slip_gross": 0,
			"slip_net": 0,
			"gross_diff": 0,
			"net_diff": 0,
			"match": True,
			"issue": "",
		}
		summary["total"] += 1

		if not row.salary_slip or not frappe.db.exists("Salary Slip", row.salary_slip):
			item["match"] = False
			item["issue"] = "Missing Salary Slip"
			summary["missing_slip"] += 1
			rows.append(item)
			continue

		slip = frappe.db.get_value(
			"Salary Slip",
			row.salary_slip,
			["gross_pay", "net_pay", "docstatus", "status"],
			as_dict=True,
		)
		item["slip_gross"] = flt(slip.gross_pay)
		item["slip_net"] = flt(slip.net_pay)
		item["gross_diff"] = expected_gross - flt(slip.gross_pay)
		item["net_diff"] = expected_net - flt(slip.net_pay)

		item["match"], item["issue"] = _reconcile_row_issue(
			expected_gross,
			expected_net,
			flt(slip.gross_pay),
			flt(slip.net_pay),
			flt(row.ctc) > RECONCILE_TOLERANCE,
		)
		if item["match"]:
			summary["matched"] += 1
		else:
			summary["mismatched"] += 1
			if "Empty slip" in item["issue"] or "Zero amounts" in item["issue"]:
				summary["zero_slip"] += 1

		rows.append(item)

	orphan_slips = frappe.get_all(
		"Salary Slip",
		filters={
			"bulk_salary_creation": batch_name,
			"docstatus": ["<", 2],
		},
		fields=["name", "employee", "employee_name", "gross_pay", "net_pay", "status"],
	)
	linked_slips = {row.salary_slip for row in batch.employees if row.salary_slip}
	for slip in orphan_slips:
		if slip.name in linked_slips:
			continue
		summary["no_row"] += 1
		rows.append(
			{
				"employee": slip.employee,
				"employee_name": slip.employee_name,
				"department": "",
				"salary_slip": slip.name,
				"salary_slip_status": slip.status or "",
				"batch_gross": 0,
				"batch_net": 0,
				"slip_gross": flt(slip.gross_pay),
				"slip_net": flt(slip.net_pay),
				"gross_diff": -flt(slip.gross_pay),
				"net_diff": -flt(slip.net_pay),
				"match": False,
				"issue": "Slip not linked to batch row",
			}
		)

	return {"rows": rows, "summary": summary, "batch_name": batch_name}


def _guess_qty_component(structure_doc):
	return _guess_component(structure_doc, "earnings", ("qty", "quantity", "piece", "production"))


def _sync_piece_additional_salaries(
	row,
	batch,
	structure_doc,
	company,
	start_date,
	end_date,
	posting_date,
	batch_name,
):
	if (batch.calculation_mode or "Manual") != "Per Piece or Per Hour":
		return

	hourly_rate = flt(row.get("ctc")) / 30 / 8 if flt(row.get("ctc")) else 0
	hour_amount = hourly_rate * flt(row.get("source_hours")) if cint(row.get("use_hours")) else 0
	qty_amount = flt(row.get("source_qty")) * flt(row.get("piece_rate")) if cint(row.get("use_qty")) else 0
	overtime_component = _guess_component(structure_doc, "earnings", ("overtime", "ot", "hour", "hourly"))
	qty_component = _guess_qty_component(structure_doc)
	settings = frappe.get_cached_doc("Payroll Bulk Settings") if frappe.db.exists("Payroll Bulk Settings", "Payroll Bulk Settings") else None
	if settings and settings.get("qty_component"):
		qty_component = settings.qty_component
	if settings and settings.get("hours_component"):
		overtime_component = settings.hours_component

	merge_qty = not qty_component or qty_component == overtime_component or qty_component == "Bulk Piece Qty"
	if merge_qty:
		combined = hour_amount + qty_amount
		if combined > 0 and overtime_component:
			_upsert_additional_salary(
				row, company, overtime_component, "Earning", combined, start_date, end_date, posting_date, batch_name
			)
		return

	if hour_amount > 0 and overtime_component:
		_upsert_additional_salary(
			row, company, overtime_component, "Earning", hour_amount, start_date, end_date, posting_date, batch_name
		)
	if qty_amount > 0 and qty_component:
		_upsert_additional_salary(
			row, company, qty_component, "Earning", qty_amount, start_date, end_date, posting_date, batch_name
		)


def _get_batch_component_entries(batch_name: str, row_name: str, employee: str):
	filters = {"parent": batch_name}
	if row_name:
		filters["employee_row"] = row_name
	else:
		filters["employee"] = employee
	return frappe.get_all(
		"Bulk Salary Component Entry",
		filters=filters,
		fields=["salary_component", "component_type", "amount"],
		limit_page_length=200,
	)


@frappe.whitelist()
def reopen_bulk_batch_for_edit(batch_name: str):
	"""Mark batch as editable (Partially Processed) so desk UI opens entry mode."""
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	if batch.docstatus == 1:
		frappe.throw(_("Submitted batches cannot be reopened for editing."))

	frappe.db.set_value(
		"Bulk Salary Creation",
		batch_name,
		"processing_status",
		"Partially Processed",
		update_modified=True,
	)
	return {"ok": True, "processing_status": "Partially Processed"}


@frappe.whitelist()
def sync_bulk_batch_slip_status(batch_name: str):
	"""Reconcile batch employee rows with actual Salary Slip docstatus."""
	from payroll_bulk.events.salary_slip import _update_batch_summary

	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	updated = []
	for row in batch.employees:
		if not row.salary_slip or not frappe.db.exists("Salary Slip", row.salary_slip):
			continue
		slip = frappe.db.get_value(
			"Salary Slip",
			row.salary_slip,
			["docstatus", "gross_pay", "net_pay", "status"],
			as_dict=True,
		)
		if not slip:
			continue
		if slip.docstatus == 1:
			status, slip_status = "Submitted", "Submitted"
		elif slip.docstatus == 0:
			status, slip_status = "Slip Created", "Draft"
		else:
			status, slip_status = "Cancelled", "Cancelled"

		updates = {"error_message": ""}
		row_changed = False
		if row.status != status or row.salary_slip_status != slip_status:
			updates["status"] = status
			updates["salary_slip_status"] = slip_status
			row_changed = True
		# Do not overwrite batch totals with slip zeros — keeps expected amounts for reconciliation.
		if flt(slip.gross_pay) > RECONCILE_TOLERANCE:
			if flt(row.gross_pay) != flt(slip.gross_pay) or flt(row.net_pay) != flt(slip.net_pay):
				updates["gross_pay"] = slip.gross_pay
				updates["net_pay"] = slip.net_pay
				row_changed = True

		if not row_changed:
			continue

		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row.name,
			updates,
			update_modified=False,
		)
		updated.append(row.employee)

	_update_batch_summary(batch_name)
	frappe.db.commit()
	processing_status = frappe.db.get_value("Bulk Salary Creation", batch_name, "processing_status")
	return {"updated_count": len(updated), "updated_employees": updated, "processing_status": processing_status}


@frappe.whitelist()
def sync_bulk_row_additional_salaries(
	batch_name: str,
	row_name: str,
	company: str,
	start_date: str,
	end_date: str,
	posting_date: str,
	payroll_frequency: str = "Monthly",
):
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))

	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	calculation_mode = batch.calculation_mode or "Manual"
	manual_salary_basis = batch.get("manual_salary_basis") or "Full Month"
	overtime_with_salary = batch.get("overtime_with_salary") or 0
	assignment = _get_salary_structure_assignment(row.employee, payroll_frequency, start_date, end_date)
	structure_doc = frappe.get_cached_doc("Salary Structure", assignment.salary_structure)

	_create_base_additional_salary_if_needed(
		row,
		assignment,
		company,
		start_date,
		end_date,
		posting_date,
		batch_name,
		calculation_mode,
		manual_salary_basis,
		overtime_with_salary,
	)
	if calculation_mode == "Per Piece or Per Hour":
		_sync_piece_additional_salaries(
			row, batch, structure_doc, company, start_date, end_date, posting_date, batch_name
		)
	else:
		_upsert_additional_salary(
			row,
			company,
			_guess_component(structure_doc, "earnings", ("overtime", "ot")),
			"Earning",
			row.ot_amount,
			start_date,
			end_date,
			posting_date,
			batch_name,
		)
	_upsert_additional_salary(
		row,
		company,
		_guess_component(structure_doc, "deductions", ("advance",)),
		"Deduction",
		row.adv_deduct,
		start_date,
		end_date,
		posting_date,
		batch_name,
	)
	for component_row in _get_batch_component_entries(batch_name, row_name, row.employee):
		_upsert_additional_salary(
			row,
			company,
			component_row.salary_component,
			component_row.component_type or "Earning",
			component_row.amount,
			start_date,
			end_date,
			posting_date,
			batch_name,
		)
	return {
		"row_name": row_name,
		"employee": row.employee,
		"salary_structure": assignment.salary_structure,
	}


@frappe.whitelist()
def create_bulk_salary_slip(
	batch_name: str,
	row_name: str,
	company: str,
	payroll_frequency: str,
	start_date: str,
	end_date: str,
	posting_date: str,
	ctc: float | None = None,
	submit_slip: int | bool = 0,
	cancel_existing: int | bool = 0,
):
	if not batch_name or not row_name:
		frappe.throw(_("Batch and employee row are required."))

	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))

	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	validate_batch_period_dates(batch.start_date, batch.end_date, batch.posting_date, batch.get("month"))
	if str(batch.start_date) != str(start_date) or str(batch.end_date) != str(end_date):
		frappe.throw(
			_("Batch period mismatch. Save the batch with start {0}, end {1} before creating slips.").format(
				batch.start_date, batch.end_date
			)
		)

	if cancel_existing:
		slips_to_cancel = set()
		if row.salary_slip:
			slips_to_cancel.add(row.salary_slip)
		resolved = _resolve_existing_salary_slip(
			row.employee, company, start_date, end_date, batch_name, row_name
		)
		if resolved.get("name"):
			slips_to_cancel.add(resolved["name"])
		for slip_name in slips_to_cancel:
			_cancel_or_delete_existing_slip(slip_name)
		if row.salary_slip:
			frappe.db.set_value(
				"Bulk Salary Creation Employee",
				row_name,
				{"salary_slip": "", "salary_slip_status": "", "status": "Pending", "error_message": ""},
				update_modified=False,
			)
			row.reload()

	options = {"start_date": start_date, "end_date": end_date, "posting_date": posting_date}
	_ensure_row_attendance_loaded(row, batch, options)
	_ensure_row_manual_payment_days(row, batch)
	row.reload()
	_validate_row_source_days(row, batch, start_date, end_date)
	_validate_employee_holiday_list(row.employee, start_date, end_date)
	sync_bulk_row_additional_salaries(
		batch_name=batch_name,
		row_name=row_name,
		company=company,
		start_date=start_date,
		end_date=end_date,
		posting_date=posting_date,
		payroll_frequency=payroll_frequency,
	)

	assignment = _get_salary_structure_assignment(row.employee, payroll_frequency, start_date, end_date)
	calculation_mode = batch.calculation_mode or "Manual"
	ctc = flt(ctc or row.get("ctc"))
	if calculation_mode != "Per Piece or Per Hour" and flt(assignment.base) <= 0 and ctc > 0:
		frappe.db.set_value(
			"Salary Structure Assignment", assignment.name, "base", ctc, update_modified=True
		)
		assignment.base = ctc

	make_salary_slip = frappe.get_attr(
		"hrms.payroll.doctype.salary_structure.salary_structure.make_salary_slip"
	)
	target_doc = frappe.get_doc(
		{
			"doctype": "Salary Slip",
			"employee": row.employee,
			"employee_name": row.employee_name,
			"company": company,
			"payroll_frequency": payroll_frequency,
			"start_date": start_date,
			"end_date": end_date,
			"posting_date": posting_date,
			"salary_structure": assignment.salary_structure,
			"bulk_salary_creation": batch_name,
			"bulk_salary_creation_employee": row_name,
		}
	)
	make_salary_slip_kwargs = {
		"target_doc": target_doc,
		"employee": row.employee,
		"posting_date": posting_date,
	}
	try:
		slip = make_salary_slip(
			assignment.salary_structure,
			**make_salary_slip_kwargs,
			ignore_permissions=True,
		)
	except TypeError as error:
		if "ignore_permissions" not in str(error):
			raise
		slip = make_salary_slip(assignment.salary_structure, **make_salary_slip_kwargs)
	preview_slip = frappe.copy_doc(slip)
	preview_earnings_count = len(preview_slip.get("earnings") or [])
	preview_deductions_count = len(preview_slip.get("deductions") or [])
	slip.insert(ignore_permissions=True)
	if len(slip.get("earnings") or []) != preview_earnings_count or len(
		slip.get("deductions") or []
	) != preview_deductions_count:
		_replace_salary_slip_rows(slip, preview_slip)

	if cint(submit_slip):
		try:
			slip.submit()
		except Exception:
			slip.reload()
			if slip.docstatus != 1:
				raise
			frappe.log_error(title=f"Bulk Salary Slip post-submit warning ({slip.name})")
	else:
		slip.reload()
		if slip.docstatus == 1 and not cint(submit_slip):
			frappe.log_error(
				title=f"Unexpected submitted Salary Slip ({slip.name})",
				message=f"Bulk batch {batch_name} requested draft slip but {slip.name} is submitted.",
			)

	return {
		"name": slip.name,
		"docstatus": slip.docstatus,
		"status": slip.status,
		"salary_structure": slip.salary_structure,
		"salary_structure_assignment": assignment.name,
		"payroll_payable_account": assignment.payroll_payable_account,
		"gross_pay": slip.gross_pay,
		"net_pay": slip.net_pay,
		"payment_days": slip.payment_days,
		"absent_days": slip.absent_days,
		"total_working_days": slip.total_working_days,
		"earnings_count": len(slip.earnings or []),
		"deductions_count": len(slip.deductions or []),
	}


@frappe.whitelist()
def reprocess_bulk_salary_row(
	batch_name: str,
	row_name: str,
	submit_slip: int | bool = 0,
	cancel_existing: int | bool = 1,
):
	"""Cancel linked Additional Salary + slip, then recreate salary slip for one row."""
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))

	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	if cint(cancel_existing):
		resolved = _resolve_existing_salary_slip(
			row.employee,
			batch.company,
			batch.start_date,
			batch.end_date,
			batch_name,
			row_name,
		)
		slips_to_cancel = set()
		if row.salary_slip:
			slips_to_cancel.add(row.salary_slip)
		if resolved.get("name"):
			slips_to_cancel.add(resolved["name"])
		for slip_name in slips_to_cancel:
			_cancel_or_delete_existing_slip(slip_name)
		_cancel_batch_additional_salaries(batch_name, employee=row.employee)
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row_name,
			{"salary_slip": "", "salary_slip_status": "", "status": "Pending", "error_message": ""},
			update_modified=False,
		)
		row.reload()

	sync_bulk_row_additional_salaries(
		batch_name=batch_name,
		row_name=row_name,
		company=batch.company,
		start_date=batch.start_date,
		end_date=batch.end_date,
		posting_date=batch.posting_date,
		payroll_frequency=batch.payroll_frequency or "Monthly",
	)
	result = create_bulk_salary_slip(
		batch_name=batch_name,
		row_name=row_name,
		company=batch.company,
		payroll_frequency=batch.payroll_frequency or "Monthly",
		start_date=batch.start_date,
		end_date=batch.end_date,
		posting_date=batch.posting_date,
		ctc=row.ctc,
		submit_slip=cint(submit_slip),
		cancel_existing=0,
	)
	from payroll_bulk.events.salary_slip import _update_batch_summary

	_update_batch_summary(batch_name)
	return result


@frappe.whitelist()
def process_bulk_batch_rows(batch_name: str, submit_slip: int | bool = 0, replace_existing: int | bool = 0):
	"""Create salary slips for all pending rows in a batch (server-side helper)."""
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	options = {
		"company": batch.company,
		"payroll_frequency": batch.payroll_frequency or "Monthly",
		"start_date": batch.start_date,
		"end_date": batch.end_date,
		"posting_date": batch.posting_date,
		"submit_slips": cint(submit_slip),
		"replace_existing_slips": cint(replace_existing),
		"create_missing_only": 0,
		"row_names": [row.name for row in batch.employees if row.employee],
	}
	return process_bulk_salary_batch(batch_name, options)


BULK_BACKGROUND_ROW_THRESHOLD = 20


def validate_batch_period_dates(start_date: str, end_date: str, posting_date: str | None = None, month: str | None = None):
	"""Ensure batch header dates are one calendar month and posting date is in range."""
	if not start_date or not end_date:
		frappe.throw(_("Batch start and end dates are required."))
	start = getdate(start_date)
	end = getdate(end_date)
	posting = getdate(posting_date) if posting_date else end
	if start > end:
		frappe.throw(_("Start Date cannot be after End Date."))
	if (start.year, start.month) != (end.year, end.month):
		frappe.throw(
			_("Start Date and End Date must be in the same calendar month. Got {0} to {1}.").format(
				start_date, end_date
			)
		)
	if posting < start or posting > end:
		frappe.throw(
			_("Posting Date must fall within the salary period ({0} to {1}).").format(start_date, end_date)
		)
	if (posting.year, posting.month) != (start.year, start.month):
		frappe.throw(
			_("Posting Date must be in the same month as the salary period ({0}).").format(start_date[:7])
		)
	if month and month != start.strftime("%B"):
		frappe.throw(
			_("Month field ({0}) does not match Start Date month ({1}).").format(month, start.strftime("%B"))
		)


def validate_salary_slip_batch_link(
	slip_name: str,
	batch_name: str,
	start_date: str,
	end_date: str,
	employee: str | None = None,
):
	"""Reject salary slips whose period or bulk batch link does not match."""
	if not slip_name or not frappe.db.exists("Salary Slip", slip_name):
		return
	slip = frappe.db.get_value(
		"Salary Slip",
		slip_name,
		["employee", "start_date", "end_date", "bulk_salary_creation", "docstatus"],
		as_dict=True,
	)
	if not slip:
		return
	if employee and slip.employee != employee:
		frappe.throw(
			_("Salary Slip {0} belongs to {1}, not {2}.").format(slip_name, slip.employee, employee)
		)
	if str(slip.start_date) != str(start_date) or str(slip.end_date) != str(end_date):
		frappe.throw(
			_(
				"Salary Slip {0} is for {1} to {2}, but this batch period is {3} to {4}. "
				"Unlink the slip or correct the batch dates."
			).format(slip_name, slip.start_date, slip.end_date, start_date, end_date)
		)
	slip_batch = slip.bulk_salary_creation or ""
	if slip_batch and batch_name and slip_batch != batch_name:
		frappe.throw(
			_("Salary Slip {0} is already linked to batch {1} and cannot be linked to {2}.").format(
				slip_name, slip_batch, batch_name
			)
		)


def _parse_bulk_batch_options(options):
	if isinstance(options, str):
		options = frappe.parse_json(options)
	return options or {}


def _resolve_existing_salary_slip(
	employee: str,
	company: str,
	start_date: str,
	end_date: str,
	batch_name: str | None = None,
	row_name: str | None = None,
) -> dict:
	"""Find an existing salary slip for the period and whether it belongs to this batch."""
	slips = frappe.get_all(
		"Salary Slip",
		filters={
			"employee": employee,
			"company": company,
			"start_date": start_date,
			"end_date": end_date,
			"docstatus": ["<", 2],
		},
		fields=["name", "bulk_salary_creation", "bulk_salary_creation_employee", "docstatus"],
		order_by="modified desc",
		limit_page_length=20,
	)
	if not slips:
		return {}

	row_slip = ""
	if row_name and frappe.db.exists("Bulk Salary Creation Employee", row_name):
		row_slip = frappe.db.get_value("Bulk Salary Creation Employee", row_name, "salary_slip") or ""

	for slip in slips:
		if row_slip and slip.name == row_slip:
			return _existing_slip_resolution(slip, batch_name)

	if batch_name:
		for slip in slips:
			if slip.bulk_salary_creation == batch_name:
				return _existing_slip_resolution(slip, batch_name)

	return _existing_slip_resolution(slips[0], batch_name)


def _existing_slip_resolution(slip, batch_name: str | None) -> dict:
	slip_batch = slip.bulk_salary_creation or ""
	foreign_batch = bool(
		slip_batch and batch_name and slip_batch != batch_name
	) or bool(not slip_batch and batch_name)
	return {
		"name": slip.name,
		"batch_name": slip_batch,
		"foreign_batch": foreign_batch,
		"docstatus": slip.docstatus,
	}


def _get_existing_period_salary_slip(
	employee: str,
	company: str,
	start_date: str,
	end_date: str,
	batch_name: str | None = None,
	row_name: str | None = None,
) -> str | None:
	resolved = _resolve_existing_salary_slip(
		employee, company, start_date, end_date, batch_name, row_name
	)
	if not resolved:
		return None
	if resolved.get("foreign_batch") and batch_name:
		return None
	return resolved.get("name")


@frappe.whitelist()
def resolve_existing_salary_slip_for_row(
	batch_name: str,
	row_name: str,
	company: str,
	start_date: str,
	end_date: str,
):
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))
	return _resolve_existing_salary_slip(
		row.employee, company, start_date, end_date, batch_name, row_name
	)


@frappe.whitelist()
def get_batch_additional_salary_amounts(batch_name: str):
	"""Return submitted Additional Salary rows linked to a bulk batch (for UI hydration)."""
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		return {}

	rows = frappe.get_all(
		"Additional Salary",
		filters={
			"ref_doctype": "Bulk Salary Creation",
			"ref_docname": batch_name,
			"docstatus": 1,
		},
		fields=["employee", "salary_component", "amount", "type", "name"],
		limit_page_length=500,
	)
	by_employee: dict[str, dict] = {}
	for row in rows:
		entry = by_employee.setdefault(
			row.employee,
			{"components": [], "adv_deduct": 0.0, "additional_salaries": []},
		)
		amount = flt(row.amount)
		entry["components"].append(
			{
				"salary_component": row.salary_component,
				"amount": amount,
				"type": row.type,
				"name": row.name,
			}
		)
		entry["additional_salaries"].append(row.name)
		component_lower = (row.salary_component or "").lower()
		if row.type == "Deduction" and "advance" in component_lower:
			entry["adv_deduct"] += amount
	return by_employee


@frappe.whitelist()
def get_batch_period_artifacts(batch_name: str):
	"""Return salary slips and additional salaries already linked or existing for the batch period."""
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		return {"employees": {}, "batch_warnings": []}

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	employees = [row.employee for row in batch.employees if row.employee]
	by_employee: dict[str, dict] = {}
	batch_warnings: list[str] = []

	for row in batch.employees:
		if not row.employee:
			continue
		entry = {
			"row_name": row.name,
			"linked_salary_slip": row.salary_slip or "",
			"linked_salary_slip_status": row.salary_slip_status or "",
			"linked_additional_salaries": [],
			"period_salary_slip": "",
			"period_salary_slip_batch": "",
			"period_salary_slip_foreign": False,
			"period_salary_slip_docstatus": None,
			"period_additional_salaries": [],
			"period_mismatch": False,
		}
		if row.salary_slip:
			slip_dates = frappe.db.get_value(
				"Salary Slip",
				row.salary_slip,
				["start_date", "end_date", "bulk_salary_creation", "docstatus"],
				as_dict=True,
			)
			if slip_dates and (
				str(slip_dates.start_date) != str(batch.start_date)
				or str(slip_dates.end_date) != str(batch.end_date)
			):
				entry["period_mismatch"] = True
				batch_warnings.append(
					_("{0}: linked slip {1} is for {2} to {3}, batch is {4} to {5}.").format(
						row.employee,
						row.salary_slip,
						slip_dates.start_date,
						slip_dates.end_date,
						batch.start_date,
						batch.end_date,
					)
				)
		by_employee[row.employee] = entry

	if batch.start_date and batch.end_date:
		for emp in employees:
			entry = by_employee.get(emp) or {}
			resolved = _resolve_existing_salary_slip(
				emp, batch.company, batch.start_date, batch.end_date, batch_name, entry.get("row_name")
			)
			if resolved.get("name"):
				entry["period_salary_slip"] = resolved["name"]
				entry["period_salary_slip_batch"] = resolved.get("batch_name") or ""
				entry["period_salary_slip_foreign"] = bool(resolved.get("foreign_batch"))
				entry["period_salary_slip_docstatus"] = resolved.get("docstatus")

			ads_filters = {
				"employee": emp,
				"payroll_date": batch.posting_date or batch.end_date,
				"ref_doctype": "Bulk Salary Creation",
				"docstatus": ["<", 2],
			}
			period_ads = frappe.get_all(
				"Additional Salary",
				filters=ads_filters,
				fields=["name", "salary_component", "amount", "type", "ref_docname", "docstatus"],
				limit_page_length=50,
			)
			for ads in period_ads:
				item = {
					"name": ads.name,
					"salary_component": ads.salary_component,
					"amount": flt(ads.amount),
					"type": ads.type,
					"batch_name": ads.ref_docname or "",
					"docstatus": ads.docstatus,
					"foreign_batch": ads.ref_docname not in ("", batch_name),
				}
				entry.setdefault("period_additional_salaries", []).append(item)
				if ads.ref_docname == batch_name:
					entry.setdefault("linked_additional_salaries", []).append(item)

			by_employee[emp] = entry

	return {
		"employees": by_employee,
		"batch_warnings": batch_warnings,
		"period": {
			"start_date": batch.start_date,
			"end_date": batch.end_date,
			"posting_date": batch.posting_date,
			"month": batch.get("month") or "",
		},
	}


def _set_bulk_job_progress(job_id: str, batch_name: str, processed: int, total: int, error: str | None = None):
	frappe.cache.set_value(
		f"bulk_salary_job:{job_id}",
		{
			"batch_name": batch_name,
			"processed_count": processed,
			"total_count": total,
			"error": error,
		},
		expires_in_sec=86400,
	)


def _process_batch_row(batch_name: str, row_name: str, options: dict):
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))
	if not row.employee:
		frappe.throw(_("Employee is required."))
	if not flt(row.ctc):
		frappe.throw(_("CTC is missing."))
	if row.adv_deduct and row.advance_balance and flt(row.adv_deduct) > flt(row.advance_balance):
		frappe.throw(_("Advance deduction cannot exceed advance balance."))

	company = options["company"]
	start_date = options["start_date"]
	end_date = options["end_date"]
	posting_date = options["posting_date"]
	payroll_frequency = options.get("payroll_frequency") or "Monthly"
	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	validate_batch_period_dates(
		batch.start_date, batch.end_date, batch.posting_date, batch.get("month")
	)
	_validate_employee_holiday_list(row.employee, start_date, end_date)
	_ensure_row_attendance_loaded(row, batch, options)
	_ensure_row_manual_payment_days(row, batch)
	row.reload()
	_validate_row_source_days(row, batch, start_date, end_date)
	resolved = _resolve_existing_salary_slip(
		row.employee, company, start_date, end_date, batch_name, row_name
	)
	existing = resolved.get("name")
	foreign_batch = resolved.get("foreign_batch")
	foreign_batch_name = resolved.get("batch_name") or ""

	if existing and foreign_batch and not cint(options.get("replace_existing_slips")):
		message = _(
			"Salary Slip {0} already exists for this period"
			"{1}. Enable Cancel and Recreate to replace it."
		).format(
			existing,
			f" (linked to batch {foreign_batch_name})" if foreign_batch_name else "",
		)
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row_name,
			{
				"salary_slip": "",
				"status": "Failed",
				"error_message": message,
				"salary_slip_status": "",
			},
			update_modified=False,
		)
		return {"failed": True, "error": message}

	if existing and cint(options.get("replace_existing_slips")):
		slips_to_cancel = {existing}
		if row.salary_slip and row.salary_slip != existing:
			slips_to_cancel.add(row.salary_slip)
		for slip_name in slips_to_cancel:
			_cancel_or_delete_existing_slip(slip_name)
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row_name,
			{"salary_slip": "", "salary_slip_status": "", "status": "Pending", "error_message": ""},
			update_modified=False,
		)
		row.reload()
		existing = None

	if existing and not cint(options.get("replace_existing_slips")):
		validate_salary_slip_batch_link(
			existing, batch_name, start_date, end_date, employee=row.employee
		)
		slip_docstatus = resolved.get("docstatus")
		if slip_docstatus is None:
			slip_docstatus = frappe.db.get_value("Salary Slip", existing, "docstatus")
		if slip_docstatus == 0 and cint(options.get("submit_slips")):
			slip = frappe.get_doc("Salary Slip", existing)
			try:
				slip.submit()
			except Exception:
				slip.reload()
				if slip.docstatus != 1:
					raise
				frappe.log_error(title=f"Bulk Salary Slip post-submit warning ({existing})")
			frappe.db.set_value(
				"Bulk Salary Creation Employee",
				row_name,
				{
					"salary_slip": existing,
					"status": "Submitted",
					"error_message": "",
					"salary_slip_status": "Submitted",
					"gross_pay": slip.gross_pay,
					"net_pay": slip.net_pay,
				},
				update_modified=False,
			)
			return {"submitted": True, "salary_slip": existing}

		salary_slip_status = "Submitted" if slip_docstatus == 1 else "Draft"
		status = "Skipped"
		message = (
			"Skipped because Salary Slip already exists."
			if cint(options.get("create_missing_only"))
			else "Linked existing Salary Slip for this period."
		)
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row_name,
			{
				"salary_slip": existing,
				"status": status,
				"error_message": message,
				"salary_slip_status": salary_slip_status,
			},
			update_modified=False,
		)
		return {"skipped": True, "salary_slip": existing}

	sync_bulk_row_additional_salaries(
		batch_name=batch_name,
		row_name=row_name,
		company=company,
		start_date=start_date,
		end_date=end_date,
		posting_date=posting_date,
		payroll_frequency=payroll_frequency,
	)
	return create_bulk_salary_slip(
		batch_name=batch_name,
		row_name=row_name,
		company=company,
		payroll_frequency=payroll_frequency,
		start_date=start_date,
		end_date=end_date,
		posting_date=posting_date,
		ctc=row.ctc,
		submit_slip=cint(options.get("submit_slips")),
		cancel_existing=cint(options.get("replace_existing_slips")) and bool(existing),
	)


def process_bulk_salary_batch(batch_name: str, options=None, job_id: str | None = None):
	from payroll_bulk.events.salary_slip import _update_batch_summary

	options = _parse_bulk_batch_options(options)
	job_id = job_id or options.get("_job_id")
	frappe.db.set_value(
		"Bulk Salary Creation", batch_name, {"processing_status": "Processing"}, update_modified=False
	)
	frappe.db.commit()

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	row_names = options.get("row_names") or [row.name for row in batch.employees if row.employee]
	total = len(row_names)
	results = {"success": [], "failed": [], "skipped": []}

	for index, row_name in enumerate(row_names, start=1):
		try:
			row_result = _process_batch_row(batch_name, row_name, options)
			if row_result and row_result.get("skipped"):
				results["skipped"].append(row_name)
			else:
				results["success"].append(row_name)
		except Exception as error:
			frappe.log_error(title=f"Bulk Salary Batch Row Failed ({batch_name})")
			row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
			slip_docstatus = (
				frappe.db.get_value("Salary Slip", row.salary_slip, "docstatus") if row.salary_slip else None
			)
			if slip_docstatus == 1:
				results["success"].append(row_name)
				frappe.db.set_value(
					"Bulk Salary Creation Employee",
					row_name,
					{
						"status": "Submitted",
						"salary_slip_status": "Submitted",
						"error_message": str(error)[:200],
					},
					update_modified=False,
				)
			else:
				results["failed"].append(row_name)
				frappe.db.set_value(
					"Bulk Salary Creation Employee",
					row_name,
					{
						"status": "Failed",
						"error_message": str(error)[:500],
						"salary_slip_status": "",
					},
					update_modified=False,
				)
		if job_id:
			_set_bulk_job_progress(job_id, batch_name, index, total)
		frappe.db.commit()

	_update_batch_summary(batch_name)
	sync_bulk_batch_slip_status(batch_name)
	return results


@frappe.whitelist()
def enqueue_bulk_salary_batch(batch_name: str, options=None):
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	options = _parse_bulk_batch_options(options)
	options["user"] = frappe.session.user
	row_names = options.get("row_names") or []
	if not row_names:
		batch = frappe.get_doc("Bulk Salary Creation", batch_name)
		row_names = [row.name for row in batch.employees if row.employee]
		options["row_names"] = row_names
	if not row_names:
		frappe.throw(_("No employee rows found to process."))

	queued_job_id = frappe.generate_hash(length=12)
	frappe.enqueue(
		method="payroll_bulk.api.process_bulk_salary_batch",
		queue="long",
		timeout=3600,
		job_name=f"bulk_salary_{batch_name}",
		batch_name=batch_name,
		options={**options, "_job_id": queued_job_id},
		job_id=queued_job_id,
	)
	_set_bulk_job_progress(queued_job_id, batch_name, 0, len(row_names))
	return {"job_id": queued_job_id, "enqueued": True, "row_count": len(row_names)}


@frappe.whitelist()
def get_bulk_salary_batch_job_status(job_id: str):
	from frappe.utils.background_jobs import get_job_status

	status = get_job_status(job_id) or "queued"
	progress = frappe.cache.get_value(f"bulk_salary_job:{job_id}") or {}
	return {
		"job_id": job_id,
		"status": status,
		"processed_count": progress.get("processed_count", 0),
		"total_count": progress.get("total_count", 0),
		"batch_name": progress.get("batch_name"),
		"error": progress.get("error"),
	}
