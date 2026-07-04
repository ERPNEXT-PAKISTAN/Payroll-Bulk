from __future__ import annotations

import frappe

from payroll_bulk.payroll_bulk.report.report_utils import pb_money


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": "Batch", "fieldname": "parent", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 160},
		{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 130},
		{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 120},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
		{"label": "Component", "fieldname": "salary_component", "fieldtype": "Link", "options": "Salary Component", "width": 160},
		{"label": "Type", "fieldname": "component_type", "fieldtype": "Data", "width": 90},
		{"label": "Amount", "fieldname": "amount", "fieldtype": "Currency", "width": 110},
	]

	conditions = {}
	if filters.get("batch"):
		conditions["parent"] = filters.batch
	if filters.get("employee"):
		conditions["employee"] = filters.employee
	if filters.get("component_type") and filters.component_type != "All":
		conditions["component_type"] = filters.component_type

	rows = frappe.get_all(
		"Bulk Salary Component Entry",
		filters=conditions,
		fields=["parent", "employee", "salary_component", "component_type", "amount"],
		order_by="parent desc, employee asc, component_type asc",
		limit_page_length=2000,
	)

	batch_cache = {}
	employee_cache = {}
	data = []
	earn_total = 0.0
	ded_total = 0.0

	for row in rows:
		if row.parent not in batch_cache:
			batch_cache[row.parent] = frappe.db.get_value("Bulk Salary Creation", row.parent, "company")
		if row.employee not in employee_cache:
			employee_cache[row.employee] = frappe.db.get_value("Employee", row.employee, "employee_name")

		company = batch_cache[row.parent]
		if filters.get("company") and company != filters.company:
			continue

		amount = pb_money(row.amount)
		if row.component_type == "Earning":
			earn_total += amount
		else:
			ded_total += amount

		data.append(
			{
				**row,
				"company": company,
				"employee_name": employee_cache[row.employee] or row.employee,
				"amount": amount,
			}
		)

	report_summary = [
		{"value": len(data), "label": "Lines", "datatype": "Int"},
		{"value": earn_total, "label": "Earnings", "indicator": "Green", "datatype": "Currency"},
		{"value": ded_total, "label": "Deductions", "indicator": "Red", "datatype": "Currency"},
	]

	return columns, data, None, None, report_summary
