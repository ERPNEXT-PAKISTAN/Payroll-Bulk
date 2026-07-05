from __future__ import annotations

import frappe

from payroll_bulk.payroll_bulk.report.report_utils import pb_in_date_range, pb_money, pb_format_columns


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": "Batch", "fieldname": "parent", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 160},
		{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 130},
		{"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
		{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 120},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
		{"label": "Advance Balance", "fieldname": "advance_balance", "fieldtype": "Currency", "width": 120},
		{"label": "Advance Deduct", "fieldname": "adv_deduct", "fieldtype": "Currency", "width": 120},
		{"label": "Remaining", "fieldname": "remaining_advance", "fieldtype": "Currency", "width": 120},
		{"label": "Net Pay", "fieldname": "net_pay", "fieldtype": "Currency", "width": 110},
	]

	conditions = {}
	if filters.get("batch"):
		conditions["parent"] = filters.batch
	if filters.get("employee"):
		conditions["employee"] = filters.employee

	rows = frappe.get_all(
		"Bulk Salary Creation Employee",
		filters=conditions,
		fields=[
			"parent",
			"employee",
			"employee_name",
			"advance_balance",
			"adv_deduct",
			"net_pay",
		],
		order_by="parent desc, employee asc",
		limit_page_length=1000,
	)

	batch_cache = {}
	data = []
	total_balance = 0.0
	total_deduct = 0.0

	for row in rows:
		if row.parent not in batch_cache:
			batch_cache[row.parent] = frappe.db.get_value(
				"Bulk Salary Creation",
				row.parent,
				["company", "posting_date"],
				as_dict=True,
			) or {}

		batch = batch_cache[row.parent]
		if filters.get("company") and batch.get("company") != filters.company:
			continue
		if not pb_in_date_range(batch.get("posting_date"), filters):
			continue

		balance = pb_money(row.advance_balance)
		deduct = pb_money(row.adv_deduct)
		if filters.get("only_with_advance") and balance <= 0 and deduct <= 0:
			continue

		total_balance += balance
		total_deduct += deduct
		data.append(
			{
				**row,
				"company": batch.get("company"),
				"posting_date": batch.get("posting_date"),
				"advance_balance": balance,
				"adv_deduct": deduct,
				"net_pay": pb_money(row.net_pay),
				"remaining_advance": max(balance - deduct, 0),
			}
		)

	report_summary = [
		{"value": len(data), "label": "Employees", "datatype": "Int"},
		{"value": total_balance, "label": "Advance Balance", "datatype": "Currency"},
		{"value": total_deduct, "label": "Deduct This Run", "indicator": "Orange", "datatype": "Currency"},
	]

	return pb_format_columns(columns), data, None, None, report_summary
