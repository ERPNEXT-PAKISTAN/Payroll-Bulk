from __future__ import annotations

import frappe

from payroll_bulk.payroll_bulk.report.report_utils import pb_in_date_range, pb_money, pb_format_columns


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": "Batch", "fieldname": "parent", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 160},
		{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 130},
		{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 130},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 170},
		{"label": "Department", "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 130},
		{"label": "CTC", "fieldname": "ctc", "fieldtype": "Currency", "width": 100},
		{"label": "Overtime", "fieldname": "ot_amount", "fieldtype": "Currency", "width": 100},
		{"label": "Salary Structure", "fieldname": "salary_structure", "fieldtype": "Link", "options": "Salary Structure", "width": 160},
		{"label": "Salary Slip", "fieldname": "salary_slip", "fieldtype": "Link", "options": "Salary Slip", "width": 150},
		{"label": "Slip Status", "fieldname": "salary_slip_status", "fieldtype": "Data", "width": 100},
		{"label": "Gross Pay", "fieldname": "gross_pay", "fieldtype": "Currency", "width": 110},
		{"label": "Adv.Deduct", "fieldname": "adv_deduct", "fieldtype": "Currency", "width": 100},
		{"label": "Net Pay", "fieldname": "net_pay", "fieldtype": "Currency", "width": 110},
		{"label": "Payment JE", "fieldname": "payment_entry", "fieldtype": "Link", "options": "Journal Entry", "width": 150},
		{"label": "Payment Status", "fieldname": "payment_status", "fieldtype": "Data", "width": 110},
		{"label": "Row Status", "fieldname": "status", "fieldtype": "Data", "width": 110},
		{"label": "Error", "fieldname": "error_message", "fieldtype": "Small Text", "width": 220},
	]
	conditions = {}
	if filters.get("batch"):
		conditions["parent"] = filters["batch"]
	if filters.get("employee"):
		conditions["employee"] = filters["employee"]
	if filters.get("row_status"):
		conditions["status"] = filters["row_status"]
	if filters.get("slip_status"):
		conditions["salary_slip_status"] = filters["slip_status"]
	data = frappe.get_all(
		"Bulk Salary Creation Employee",
		filters=conditions,
		fields=[
			"parent",
			"employee",
			"employee_name",
			"department",
			"ctc",
			"ot_amount",
			"salary_structure",
			"salary_slip",
			"salary_slip_status",
			"payment_entry",
			"payment_status",
			"gross_pay",
			"adv_deduct",
			"net_pay",
			"status",
			"error_message",
		],
		order_by="modified desc",
		limit_page_length=500,
	)
	batch_cache = {}
	filtered = []
	total_net = 0.0
	failed_count = 0
	for row in data:
		if row.parent not in batch_cache:
			batch_cache[row.parent] = frappe.db.get_value(
				"Bulk Salary Creation",
				row.parent,
				["company", "posting_date"],
				as_dict=True,
			) or {}
		batch = batch_cache[row.parent]
		row["company"] = batch.get("company")
		if filters.get("company") and row["company"] != filters.company:
			continue
		if not pb_in_date_range(batch.get("posting_date"), filters):
			continue
		total_net += pb_money(row.net_pay)
		if row.status == "Failed":
			failed_count += 1
		filtered.append({
			**row,
			"ctc": pb_money(row.get("ctc")),
			"ot_amount": pb_money(row.get("ot_amount")),
			"gross_pay": pb_money(row.get("gross_pay")),
			"adv_deduct": pb_money(row.get("adv_deduct")),
			"net_pay": pb_money(row.get("net_pay")),
		})

	report_summary = [
		{"value": len(filtered), "label": "Rows", "datatype": "Int"},
		{"value": failed_count, "label": "Failed", "indicator": "Red" if failed_count else "Green", "datatype": "Int"},
		{"value": total_net, "label": "Total Net", "datatype": "Currency", "currency": frappe.defaults.get_global_default("currency")},
	]

	return pb_format_columns(columns), filtered, None, None, report_summary
