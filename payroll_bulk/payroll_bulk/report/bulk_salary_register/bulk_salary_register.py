from __future__ import annotations

import json

import frappe
from frappe import _
from frappe.utils import flt

from payroll_bulk.payroll_bulk.report.report_utils import pb_format_columns, pb_in_date_range, pb_money


def execute(filters=None):
	columns, data, period_label, currency = _build_register_result(filters)
	report_summary = _build_summary(data, currency)
	return columns, data, None, None, report_summary


@frappe.whitelist()
def get_register_print_html(filters=None):
	if isinstance(filters, str):
		filters = json.loads(filters or "{}")
	columns, data, period_label, currency = _build_register_result(filters)
	return _render_register_print_html(columns, data, period_label, currency, auto_print=True)


@frappe.whitelist()
def download_register_pdf(filters=None):
	if isinstance(filters, str):
		filters = json.loads(filters or "{}")
	columns, data, period_label, currency = _build_register_result(filters)
	html = _render_register_print_html(columns, data, period_label, currency, auto_print=False)
	from frappe.utils.pdf import get_pdf

	frappe.local.response.filename = "bulk-salary-register.pdf"
	frappe.local.response.filecontent = get_pdf(
		html,
		{
			"orientation": "Landscape",
			"page-size": "A4",
		},
	)
	frappe.local.response.type = "pdf"


def _build_register_result(filters=None):
	filters = frappe._dict(filters or {})
	employee_conditions = {}
	if filters.get("batch"):
		employee_conditions["parent"] = filters.batch
	if filters.get("employee"):
		employee_conditions["employee"] = filters.employee

	employees = frappe.get_all(
		"Bulk Salary Creation Employee",
		filters=employee_conditions,
		fields=[
			"name",
			"parent",
			"employee",
			"employee_name",
			"department",
			"gross_pay",
			"net_pay",
			"total_deductions",
		],
		order_by="department asc, employee_name asc",
		limit_page_length=2000,
	)

	batch_cache = {}
	filtered_employees = []
	period_label = ""
	currency = frappe.defaults.get_global_default("currency")

	for row in employees:
		batch = batch_cache.get(row.parent)
		if batch is None:
			batch = frappe.db.get_value(
				"Bulk Salary Creation",
				row.parent,
				["company", "posting_date", "payroll_frequency", "start_date", "end_date"],
				as_dict=True,
			) or {}
			batch_cache[row.parent] = batch
		if filters.get("company") and batch.get("company") != filters.company:
			continue
		if not pb_in_date_range(batch.get("posting_date"), filters):
			continue
		if batch.get("company") and not currency:
			currency = frappe.db.get_value("Company", batch.get("company"), "default_currency") or currency
		if not period_label and batch.get("start_date") and batch.get("end_date"):
			period_label = _("Salary register for the period of {0} to {1}").format(
				batch.get("start_date"),
				batch.get("end_date"),
			)
		filtered_employees.append((row, batch))

	if not filtered_employees:
		return pb_format_columns(_base_columns([], [])), [], period_label, currency

	batch_names = list({row.parent for row, _batch in filtered_employees})
	component_conditions = {"parent": ["in", batch_names]}
	if filters.get("employee"):
		component_conditions["employee"] = filters.employee

	component_rows = frappe.get_all(
		"Bulk Salary Component Entry",
		filters=component_conditions,
		fields=["parent", "employee", "salary_component", "component_type", "amount"],
		limit_page_length=5000,
	)

	earning_components = sorted(
		{row.salary_component for row in component_rows if row.component_type == "Earning" and row.salary_component}
	)
	deduction_components = sorted(
		{row.salary_component for row in component_rows if row.component_type == "Deduction" and row.salary_component}
	)

	component_map = {}
	for row in component_rows:
		key = (row.parent, row.employee, row.component_type, row.salary_component)
		component_map[key] = component_map.get(key, 0) + pb_money(row.amount)

	employee_rows = []
	for emp_row, batch in filtered_employees:
		row = {
			"batch": emp_row.parent,
			"company": batch.get("company"),
			"payroll_frequency": batch.get("payroll_frequency"),
			"period": f"{batch.get('start_date') or ''} → {batch.get('end_date') or ''}",
			"employee_name": emp_row.employee_name or emp_row.employee,
			"department": emp_row.department,
			"gross_pay": pb_money(emp_row.gross_pay),
			"total_deductions": pb_money(emp_row.total_deductions),
			"net_pay": pb_money(emp_row.net_pay),
		}
		for component in earning_components:
			row[frappe.scrub(component)] = component_map.get(
				(emp_row.parent, emp_row.employee, "Earning", component), 0
			)
		for component in deduction_components:
			row[frappe.scrub(component)] = component_map.get(
				(emp_row.parent, emp_row.employee, "Deduction", component), 0
			)
		employee_rows.append(row)

	columns = pb_format_columns(_base_columns(earning_components, deduction_components))
	data = _group_rows_by_department(employee_rows, _numeric_fields(columns))
	return columns, data, period_label, currency


def _numeric_fields(columns):
	fields = []
	for column in columns:
		if column.get("fieldtype") in ("Currency", "Int", "Float"):
			fields.append(column.get("fieldname"))
	return fields


def _group_rows_by_department(rows, numeric_fields):
	from collections import OrderedDict

	grouped = OrderedDict()
	for row in rows:
		dept = row.get("department") or _("Unassigned")
		grouped.setdefault(dept, []).append(row)

	data = []
	grand = {field: 0 for field in numeric_fields}
	employee_count = 0

	for department, dept_rows in grouped.items():
		data.append({"employee_name": _("Department: {0}").format(department), "row_type": "department"})
		dept_totals = {field: 0 for field in numeric_fields}

		for index, row in enumerate(dept_rows, start=1):
			item = {**row, "si_no": index, "row_type": "data"}
			data.append(item)
			employee_count += 1
			for field in numeric_fields:
				value = flt(item.get(field))
				dept_totals[field] += value
				grand[field] += value

		subtotal = {
			"employee_name": _("No. of Employees = {0}").format(len(dept_rows)),
			"row_type": "subtotal",
		}
		for field in numeric_fields:
			subtotal[field] = pb_money(dept_totals[field])
		data.append(subtotal)

	grand_row = {"employee_name": _("Grand Total"), "row_type": "grand_total"}
	for field in numeric_fields:
		grand_row[field] = pb_money(grand[field])
	data.append(grand_row)

	return data


def _build_summary(data, currency):
	employee_rows = [row for row in data if row.get("row_type") == "data"]
	total_net = sum(flt(row.get("net_pay")) for row in employee_rows)
	return [
		{"value": len(employee_rows), "label": _("Employees"), "datatype": "Int"},
		{
			"value": pb_money(total_net),
			"label": _("Total Net"),
			"datatype": "Currency",
			"currency": currency,
		},
	]


def _base_columns(earning_components, deduction_components):
	columns = [
		{"label": "#", "fieldname": "si_no", "fieldtype": "Int", "width": 45},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 180},
		{"label": "Batch", "fieldname": "batch", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 140},
		{"label": "Period", "fieldname": "period", "fieldtype": "Data", "width": 160},
	]
	for component in earning_components:
		columns.append(
			{
				"label": component,
				"fieldname": frappe.scrub(component),
				"fieldtype": "Currency",
				"width": 100,
				"precision": 0,
			}
		)
	columns.append({"label": "Gross Pay", "fieldname": "gross_pay", "fieldtype": "Currency", "width": 110, "precision": 0})
	for component in deduction_components:
		columns.append(
			{
				"label": component,
				"fieldname": frappe.scrub(component),
				"fieldtype": "Currency",
				"width": 100,
				"precision": 0,
			}
		)
	columns.extend(
		[
			{"label": "Total Deductions", "fieldname": "total_deductions", "fieldtype": "Currency", "width": 110, "precision": 0},
			{"label": "Net Pay", "fieldname": "net_pay", "fieldtype": "Currency", "width": 110, "precision": 0},
			{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 120},
			{"label": "Frequency", "fieldname": "payroll_frequency", "fieldtype": "Data", "width": 100},
		]
	)
	return columns


def _render_register_print_html(columns, data, period_label, currency, auto_print=False):
	print_columns = [column for column in columns if column.get("fieldname") not in ("company", "payroll_frequency")]
	header = "".join(f"<th>{frappe.utils.escape_html(column.get('label') or '')}</th>" for column in print_columns)
	body_rows = []
	for row in data:
		row_class = row.get("row_type") or "data"
		cells = []
		for column in print_columns:
			fieldname = column.get("fieldname")
			value = row.get(fieldname)
			if column.get("fieldtype") == "Currency" and value not in (None, ""):
				display = frappe.format_value(value, {"fieldtype": "Currency", "options": currency, "precision": 0})
				cells.append(f'<td class="num">{frappe.utils.escape_html(display)}</td>')
			elif value not in (None, ""):
				cells.append(f'<td class="text">{frappe.utils.escape_html(str(value))}</td>')
			else:
				cells.append("<td></td>")
		body_rows.append(f'<tr class="{row_class}">{"".join(cells)}</tr>')

	print_script = "<script>window.onload = function() { window.print(); };</script>" if auto_print else ""

	return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{frappe.utils.escape_html(_("Bulk Salary Register"))}</title>
<style>
	body {{ font-family: Arial, sans-serif; color: #111; font-size: 11px; margin: 16px; }}
	h2, h4 {{ text-align: center; margin: 0 0 8px; }}
	table {{ width: 100%; border-collapse: collapse; }}
	th, td {{ border: 1px solid #222; padding: 5px 7px; line-height: 1.4; }}
	th {{ background: #e2e8f0; }}
	td.num {{ text-align: right; }}
	td.text {{ text-align: left; }}
	tr.department td {{ background: #f1f5f9; font-weight: 700; }}
	tr.subtotal td, tr.grand_total td {{ background: #f8fafc; font-weight: 700; }}
	tr.grand_total td {{ background: #cbd5e1; }}
</style></head><body>
<h2>{frappe.utils.escape_html(_("Bulk Salary Register"))}</h2>
<h4>{frappe.utils.escape_html(period_label or "")}</h4>
<table><thead><tr>{header}</tr></thead><tbody>{"".join(body_rows)}</tbody></table>
{print_script}
</body></html>"""
