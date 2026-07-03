from __future__ import annotations

import frappe


def execute(filters=None):
	filters = filters or {}
	columns = [
		{"label": "Batch", "fieldname": "parent", "fieldtype": "Link", "options": "Bulk Salary Creation", "width": 160},
		{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 130},
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 170},
		{"label": "Department", "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 130},
		{"label": "Designation", "fieldname": "designation", "fieldtype": "Link", "options": "Designation", "width": 130},
		{"label": "Salary Structure", "fieldname": "salary_structure", "fieldtype": "Link", "options": "Salary Structure", "width": 160},
		{"label": "Salary Slip", "fieldname": "salary_slip", "fieldtype": "Link", "options": "Salary Slip", "width": 150},
		{"label": "Slip Status", "fieldname": "salary_slip_status", "fieldtype": "Data", "width": 100},
		{"label": "Payment Journal Entry", "fieldname": "payment_entry", "fieldtype": "Link", "options": "Journal Entry", "width": 150},
		{"label": "Payment Status", "fieldname": "payment_status", "fieldtype": "Data", "width": 110},
		{"label": "Gross Pay", "fieldname": "gross_pay", "fieldtype": "Currency", "width": 110},
		{"label": "Net Pay", "fieldname": "net_pay", "fieldtype": "Currency", "width": 110},
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
	data = frappe.get_all("Bulk Salary Creation Employee", filters=conditions, fields=["parent", "employee", "employee_name", "department", "designation", "salary_structure", "salary_slip", "salary_slip_status", "payment_entry", "payment_status", "gross_pay", "net_pay", "status", "error_message"], order_by="modified desc")
	return columns, data
