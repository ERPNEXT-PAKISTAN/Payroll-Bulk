from __future__ import annotations

import frappe
from frappe import _

from payroll_bulk.payroll_bulk.report.report_utils import pb_format_columns, pb_in_date_range, pb_money


def execute(filters=None):
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
		order_by="parent desc, employee asc",
		limit_page_length=2000,
	)

	batch_cache = {}
	filtered_employees = []
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
		filtered_employees.append((row, batch))

	if not filtered_employees:
		return pb_format_columns(_base_columns([], [])), [], None, None, []

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
		{
			row.salary_component
			for row in component_rows
			if row.component_type == "Earning" and row.salary_component
		}
	)
	deduction_components = sorted(
		{
			row.salary_component
			for row in component_rows
			if row.component_type == "Deduction" and row.salary_component
		}
	)

	component_map = {}
	for row in component_rows:
		key = (row.parent, row.employee, row.component_type, row.salary_component)
		component_map[key] = component_map.get(key, 0) + pb_money(row.amount)

	columns = pb_format_columns(_base_columns(earning_components, deduction_components))
	data = []
	total_net = 0.0

	for emp_row, batch in filtered_employees:
		row = {
			"batch": emp_row.parent,
			"company": batch.get("company"),
			"payroll_frequency": batch.get("payroll_frequency"),
			"period": f"{batch.get('start_date') or ''} → {batch.get('end_date') or ''}",
			"employee": emp_row.employee,
			"employee_name": emp_row.employee_name,
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
		total_net += row["net_pay"]
		data.append(row)

	report_summary = [
		{"value": len(data), "label": _("Employees"), "datatype": "Int"},
		{"value": total_net, "label": _("Total Net"), "datatype": "Currency", "currency": frappe.defaults.get_global_default("currency")},
	]

	return columns, data, None, None, report_summary


def _base_columns(earning_components, deduction_components):
	columns = [
		{"label": "Batch", "fieldname": "batch", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 150},
		{"label": "Period", "fieldname": "period", "fieldtype": "Data", "width": 170},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
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
			{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 110},
			{"label": "Department", "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 120},
			{"label": "Frequency", "fieldname": "payroll_frequency", "fieldtype": "Data", "width": 100},
		]
	)
	return columns
