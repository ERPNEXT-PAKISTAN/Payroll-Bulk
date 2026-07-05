from __future__ import annotations

import frappe

from payroll_bulk.payroll_bulk.report.report_utils import pb_in_date_range, pb_money, pb_format_columns


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": "Batch", "fieldname": "parent", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 160},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
		{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 140},
		{"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
		{"label": "Salary Slip", "fieldname": "salary_slip", "fieldtype": "Link", "options": "Salary Slip", "width": 150},
		{"label": "Slip Status", "fieldname": "salary_slip_status", "fieldtype": "Data", "width": 100},
		{"label": "Net Pay", "fieldname": "net_pay", "fieldtype": "Currency", "width": 110},
		{"label": "Payment Status", "fieldname": "payment_status", "fieldtype": "Data", "width": 110},
		{"label": "Payment JE", "fieldname": "payment_entry", "fieldtype": "Link", "options": "Journal Entry", "width": 150},
	]

	conditions = {}
	if filters.get("batch"):
		conditions["parent"] = filters.batch
	if filters.get("payment_status") and filters.payment_status != "All":
		if filters.payment_status == "Paid":
			conditions["payment_entry"] = ["is", "set"]
		else:
			conditions["payment_entry"] = ["is", "not set"]
			conditions["salary_slip_status"] = "Submitted"

	rows = frappe.get_all(
		"Bulk Salary Creation Employee",
		filters=conditions,
		fields=[
			"parent",
			"employee",
			"employee_name",
			"salary_slip",
			"salary_slip_status",
			"net_pay",
			"payment_status",
			"payment_entry",
		],
		order_by="parent desc, employee asc",
		limit_page_length=1000,
	)

	batch_cache = {}
	data = []
	paid_count = 0
	not_paid_count = 0
	total_net = 0.0

	for row in rows:
		batch = batch_cache.get(row.parent)
		if batch is None:
			batch = frappe.db.get_value(
				"Bulk Salary Creation",
				row.parent,
				["company", "posting_date"],
				as_dict=True,
			) or {}
			batch_cache[row.parent] = batch

		if filters.get("company") and batch.get("company") != filters.company:
			continue
		if not pb_in_date_range(batch.get("posting_date"), filters):
			continue

		payment_status = row.payment_status or ("Paid" if row.payment_entry else "Not Paid")
		if payment_status == "Paid":
			paid_count += 1
		else:
			not_paid_count += 1
		total_net += pb_money(row.net_pay)

		data.append(
			{
				**row,
				"company": batch.get("company"),
				"posting_date": batch.get("posting_date"),
				"payment_status": payment_status,
				"net_pay": pb_money(row.net_pay),
			}
		)

	report_summary = [
		{"value": len(data), "label": "Rows", "datatype": "Int"},
		{"value": paid_count, "label": "Paid", "indicator": "Green", "datatype": "Int"},
		{"value": not_paid_count, "label": "Not Paid", "indicator": "Orange", "datatype": "Int"},
		{"value": total_net, "label": "Total Net", "datatype": "Currency", "currency": frappe.defaults.get_global_default("currency")},
	]

	return pb_format_columns(columns), data, None, None, report_summary
