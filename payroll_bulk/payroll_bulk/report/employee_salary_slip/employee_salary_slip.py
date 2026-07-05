from __future__ import annotations

import frappe
from frappe import _

from payroll_bulk.payroll_bulk.report.report_utils import pb_format_columns, pb_money


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = pb_format_columns(
		[
			{"label": "Salary Slip", "fieldname": "salary_slip", "fieldtype": "Link", "options": "Salary Slip", "width": 150},
			{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
			{"label": "Batch", "fieldname": "batch", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 140},
			{"label": "Period", "fieldname": "period", "fieldtype": "Data", "width": 170},
			{"label": "Component", "fieldname": "salary_component", "fieldtype": "Link", "options": "Salary Component", "width": 150},
			{"label": "Type", "fieldname": "component_type", "fieldtype": "Data", "width": 90},
			{"label": "Amount", "fieldname": "amount", "fieldtype": "Currency", "width": 110},
			{"label": "Gross Pay", "fieldname": "gross_pay", "fieldtype": "Currency", "width": 110},
			{"label": "Net Pay", "fieldname": "net_pay", "fieldtype": "Currency", "width": 110},
			{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 120},
			{"label": "Department", "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 120},
			{"label": "Payroll Frequency", "fieldname": "payroll_frequency", "fieldtype": "Data", "width": 110},
		]
	)

	slip_name = filters.get("salary_slip")
	if not slip_name and filters.get("employee"):
		slip_filters = {"employee": filters.employee, "docstatus": ["<", 2]}
		if filters.get("company"):
			slip_filters["company"] = filters.company
		rows = frappe.get_all(
			"Salary Slip",
			filters=slip_filters,
			fields=["name"],
			order_by="start_date desc",
			limit_page_length=1,
		)
		slip_name = rows[0].name if rows else None

	if not slip_name and filters.get("batch"):
		slip_name = frappe.db.get_value(
			"Bulk Salary Creation Employee",
			{"parent": filters.batch, "salary_slip": ["is", "set"]},
			"salary_slip",
			order_by="modified desc",
		)

	if not slip_name:
		return columns, [], _("Select a Salary Slip, Employee, or Batch."), None, []

	if not frappe.has_permission("Salary Slip", "read", slip_name):
		frappe.throw(_("Not permitted to read Salary Slip {0}").format(slip_name))

	slip = frappe.get_doc("Salary Slip", slip_name)
	batch = frappe.db.get_value(
		"Bulk Salary Creation Employee",
		{"salary_slip": slip.name},
		"parent",
	)

	data = []
	header = {
		"salary_slip": slip.name,
		"batch": batch,
		"company": slip.company,
		"employee": slip.employee,
		"employee_name": slip.employee_name,
		"department": slip.department,
		"payroll_frequency": slip.payroll_frequency,
		"period": f"{slip.start_date} → {slip.end_date}",
		"gross_pay": pb_money(slip.gross_pay),
		"net_pay": pb_money(slip.net_pay),
	}

	for row in slip.earnings or []:
		data.append(
			{
				**header,
				"salary_component": row.salary_component,
				"component_type": "Earning",
				"amount": pb_money(row.amount),
			}
		)
	for row in slip.deductions or []:
		data.append(
			{
				**header,
				"salary_component": row.salary_component,
				"component_type": "Deduction",
				"amount": pb_money(row.amount),
			}
		)

	if not data:
		data.append({**header, "salary_component": "", "component_type": "", "amount": 0})

	report_summary = [
		{"value": slip.name, "label": _("Salary Slip"), "datatype": "Data"},
		{"value": pb_money(slip.net_pay), "label": _("Net Pay"), "datatype": "Currency", "currency": slip.currency},
	]

	message = _("Use Print Salary Slip above to open the official salary slip print view.")

	return columns, data, message, None, report_summary
