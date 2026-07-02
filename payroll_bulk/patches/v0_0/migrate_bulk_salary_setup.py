from __future__ import annotations

import frappe


def execute():
	for dt in ("Bulk Salary Creation", "Bulk Salary Creation Employee"):
		if frappe.db.exists("DocType", dt):
			frappe.db.set_value("DocType", dt, "module", "Payroll Bulk", update_modified=False)
			frappe.db.set_value("DocType", dt, "custom", 0, update_modified=False)
	if frappe.db.exists("Client Script", "Bulk Salary Creation"):
		frappe.db.set_value("Client Script", "Bulk Salary Creation", "enabled", 0, update_modified=False)
	for name in ("Bulk Salary Sync - Salary Slip After Insert", "Bulk Salary Sync - Salary Slip On Submit", "Bulk Salary Sync - Salary Slip On Cancel"):
		if frappe.db.exists("Server Script", name):
			frappe.db.set_value("Server Script", name, "disabled", 1, update_modified=False)
