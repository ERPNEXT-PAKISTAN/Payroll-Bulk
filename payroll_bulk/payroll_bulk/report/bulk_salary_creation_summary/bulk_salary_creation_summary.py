from __future__ import annotations

import frappe


def execute(filters=None):
	filters = filters or {}
	columns = [
		{"label": "Batch", "fieldname": "name", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 170},
		{"label": "Company", "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 180},
		{"label": "Posting Date", "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
		{"label": "Frequency", "fieldname": "payroll_frequency", "fieldtype": "Data", "width": 100},
		{"label": "Status", "fieldname": "processing_status", "fieldtype": "Data", "width": 150},
		{"label": "Employees", "fieldname": "total_employees", "fieldtype": "Int", "width": 90},
		{"label": "Success", "fieldname": "success_count", "fieldtype": "Int", "width": 80},
		{"label": "Failed", "fieldname": "failed_count", "fieldtype": "Int", "width": 80},
		{"label": "Submitted", "fieldname": "submitted_count", "fieldtype": "Int", "width": 90},
		{"label": "Cancelled", "fieldname": "cancelled_count", "fieldtype": "Int", "width": 90},
		{"label": "Total Gross", "fieldname": "total_gross", "fieldtype": "Currency", "width": 120},
		{"label": "Total Net", "fieldname": "total_net", "fieldtype": "Currency", "width": 120},
	]
	conditions = {}
	if filters.get("company"):
		conditions["company"] = filters["company"]
	if filters.get("status"):
		conditions["processing_status"] = filters["status"]
	if filters.get("from_date") and filters.get("to_date"):
		conditions["posting_date"] = ["between", [filters["from_date"], filters["to_date"]]]
	elif filters.get("from_date"):
		conditions["posting_date"] = [">=", filters["from_date"]]
	elif filters.get("to_date"):
		conditions["posting_date"] = ["<=", filters["to_date"]]
	data = frappe.get_all("Bulk Salary Creation", filters=conditions, fields=["name", "company", "posting_date", "payroll_frequency", "processing_status", "total_employees", "success_count", "failed_count", "submitted_count", "cancelled_count", "total_gross", "total_net"], order_by="posting_date desc, modified desc")
	return columns, data
