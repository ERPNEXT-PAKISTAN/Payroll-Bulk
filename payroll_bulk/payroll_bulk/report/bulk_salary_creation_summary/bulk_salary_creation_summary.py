from __future__ import annotations

import frappe

from payroll_bulk.payroll_bulk.report.report_utils import pb_apply_date_filters, pb_money, pb_format_columns


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": "Batch", "fieldname": "name", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 170},
		{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 180},
		{"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
		{"label": "Period", "fieldname": "period", "fieldtype": "Data", "width": 170},
		{"label": "Frequency", "fieldname": "payroll_frequency", "fieldtype": "Data", "width": 100},
		{"label": "Status", "fieldname": "processing_status", "fieldtype": "Data", "width": 150},
		{"label": "Employees", "fieldname": "total_employees", "fieldtype": "Int", "width": 90},
		{"label": "Processed", "fieldname": "processed_count", "fieldtype": "Int", "width": 90},
		{"label": "Success", "fieldname": "success_count", "fieldtype": "Int", "width": 80},
		{"label": "Failed", "fieldname": "failed_count", "fieldtype": "Int", "width": 80},
		{"label": "Submitted", "fieldname": "submitted_count", "fieldtype": "Int", "width": 90},
		{"label": "Cancelled", "fieldname": "cancelled_count", "fieldtype": "Int", "width": 90},
		{"label": "Total Gross", "fieldname": "total_gross", "fieldtype": "Currency", "width": 120},
		{"label": "Total Net", "fieldname": "total_net", "fieldtype": "Currency", "width": 120},
	]

	conditions = {}
	if filters.get("company"):
		conditions["company"] = filters.company
	if filters.get("batch"):
		conditions["name"] = filters.batch
	if filters.get("status"):
		conditions["processing_status"] = filters.status
	pb_apply_date_filters(conditions, filters, "posting_date")

	data = frappe.get_all(
		"Bulk Salary Creation",
		filters=conditions,
		fields=[
			"name",
			"company",
			"posting_date",
			"start_date",
			"end_date",
			"payroll_frequency",
			"processing_status",
			"total_employees",
			"processed_count",
			"success_count",
			"failed_count",
			"submitted_count",
			"cancelled_count",
			"total_gross",
			"total_net",
		],
		order_by="posting_date desc, modified desc",
		limit_page_length=500,
	)
	total_net = 0.0
	for row in data:
		start = row.pop("start_date", None)
		end = row.pop("end_date", None)
		row["period"] = f"{start} → {end}" if start and end else ""
		row["total_gross"] = pb_money(row.get("total_gross"))
		row["total_net"] = pb_money(row.get("total_net"))
		total_net += pb_money(row.get("total_net"))

	report_summary = [
		{"value": len(data), "label": "Batches", "datatype": "Int"},
		{"value": total_net, "label": "Total Net", "datatype": "Currency", "currency": frappe.defaults.get_global_default("currency")},
	]

	return pb_format_columns(columns), data, None, None, report_summary
