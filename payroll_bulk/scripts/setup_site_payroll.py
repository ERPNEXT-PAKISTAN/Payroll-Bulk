"""One-time site setup helpers for Payroll Bulk.

Run:
  bench --site your-site execute payroll_bulk.scripts.setup_site_payroll.run \\
    --kwargs '{"company":"Your Company","payable_account":"Payroll Payable - CO"}'
"""

from __future__ import annotations

import frappe


def run(company: str | None = None, payable_account: str | None = None, holiday_list: str = "Company Holidays"):
	frappe.only_for(("System Manager", "HR Manager"))
	company = company or frappe.defaults.get_global_default("company")
	if not company:
		frappe.throw("Company is required.")

	updates = {}

	if not frappe.db.get_value("Company", company, "default_holiday_list"):
		if frappe.db.exists("Holiday List", holiday_list):
			frappe.db.set_value("Company", company, "default_holiday_list", holiday_list)
			updates["default_holiday_list"] = holiday_list

	if payable_account and frappe.db.exists("Account", payable_account):
		if frappe.db.get_value("Account", payable_account, "account_type") != "Payable":
			frappe.db.set_value("Account", payable_account, "account_type", "Payable")
			updates["payroll_payable_account_type"] = "Payable"

	frappe.db.commit()
	print("Site setup updates:", updates or "none needed")
	return updates
