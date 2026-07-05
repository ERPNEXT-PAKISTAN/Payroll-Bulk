from __future__ import annotations

import frappe
from frappe import _

from payroll_bulk.payroll_bulk.report.report_utils import pb_date_range, pb_format_columns, pb_money


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = pb_format_columns(
		[
			{"label": "Salary Slip", "fieldname": "salary_slip", "fieldtype": "Link", "options": "Salary Slip", "width": 150},
			{"label": "Batch", "fieldname": "batch", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 150},
			{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 110},
			{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
			{"label": "Department", "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 120},
			{"label": "Payroll Frequency", "fieldname": "payroll_frequency", "fieldtype": "Data", "width": 110},
			{"label": "Period Start", "fieldname": "start_date", "fieldtype": "Date", "width": 100},
			{"label": "Period End", "fieldname": "end_date", "fieldtype": "Date", "width": 100},
			{"label": "Payment Days", "fieldname": "payment_days", "fieldtype": "Float", "width": 90, "precision": 0},
			{"label": "Gross Pay", "fieldname": "gross_pay", "fieldtype": "Currency", "width": 110},
			{"label": "Total Deduction", "fieldname": "total_deduction", "fieldtype": "Currency", "width": 110},
			{"label": "Net Pay", "fieldname": "net_pay", "fieldtype": "Currency", "width": 110},
			{"label": "Slip Status", "fieldname": "slip_status", "fieldtype": "Data", "width": 90},
		]
	)

	if not filters.get("company"):
		return columns, [], _("Select a company."), None, []

	conditions = ["ss.company = %(company)s", "ss.docstatus < 2"]
	values = {"company": filters.company}

	if filters.get("employee"):
		conditions.append("ss.employee = %(employee)s")
		values["employee"] = filters.employee
	if filters.get("payroll_frequency"):
		conditions.append("ss.payroll_frequency = %(payroll_frequency)s")
		values["payroll_frequency"] = filters.payroll_frequency
	if filters.get("docstatus") == "Draft":
		conditions.append("ss.docstatus = 0")
	elif filters.get("docstatus") == "Submitted":
		conditions.append("ss.docstatus = 1")
	elif filters.get("docstatus") == "Cancelled":
		conditions.append("ss.docstatus = 2")

	date_clause = pb_date_range(filters, "ss.start_date")
	if date_clause:
		field, operator, val = date_clause
		if operator == "between":
			conditions.append(f"{field} between %(from_date)s and %(to_date)s")
			values["from_date"], values["to_date"] = val
		else:
			conditions.append(f"{field} {operator} %({field.replace('.', '_')})s")
			values[field.replace(".", "_")] = val

	if filters.get("batch"):
		conditions.append(
			"exists (select 1 from `tabBulk Salary Creation Employee` bse "
			"where bse.salary_slip = ss.name and bse.parent = %(batch)s)"
		)
		values["batch"] = filters.batch

	rows = frappe.db.sql(
		f"""
		select
			ss.name as salary_slip,
			ss.employee,
			ss.employee_name,
			ss.department,
			ss.payroll_frequency,
			ss.start_date,
			ss.end_date,
			ss.payment_days,
			ss.gross_pay,
			ss.total_deduction,
			ss.net_pay,
			case ss.docstatus when 0 then 'Draft' when 1 then 'Submitted' else 'Cancelled' end as slip_status,
			(
				select bse.parent
				from `tabBulk Salary Creation Employee` bse
				where bse.salary_slip = ss.name
				order by bse.modified desc
				limit 1
			) as batch
		from `tabSalary Slip` ss
		where {" and ".join(conditions)}
		order by ss.start_date desc, ss.employee asc
		limit 2000
		""",
		values,
		as_dict=True,
	)

	total_net = 0.0
	for row in rows:
		row["gross_pay"] = pb_money(row.get("gross_pay"))
		row["total_deduction"] = pb_money(row.get("total_deduction"))
		row["net_pay"] = pb_money(row.get("net_pay"))
		row["payment_days"] = pb_money(row.get("payment_days"))
		total_net += row["net_pay"]

	report_summary = [
		{"value": len(rows), "label": _("Slips"), "datatype": "Int"},
		{"value": total_net, "label": _("Total Net"), "datatype": "Currency", "currency": frappe.defaults.get_global_default("currency")},
	]

	return pb_format_columns(columns), rows, None, None, report_summary
