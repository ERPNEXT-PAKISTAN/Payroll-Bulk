"""One-time site setup for payroll bulk on ss.frappe.my."""

from __future__ import annotations

import frappe


def run(company: str = "SS Coil Centre SMC Pvt Ltd"):
	frappe.only_for(("System Manager", "HR Manager"))
	updates = {}

	if not frappe.db.get_value("Company", company, "default_holiday_list"):
		if frappe.db.exists("Holiday List", "Company Holidays"):
			frappe.db.set_value("Company", company, "default_holiday_list", "Company Holidays")
			updates["default_holiday_list"] = "Company Holidays"

	payable = "Payroll Payable - SSC"
	if frappe.db.exists("Account", payable):
		if frappe.db.get_value("Account", payable, "account_type") != "Payable":
			frappe.db.set_value("Account", payable, "account_type", "Payable")
			updates["payroll_payable_account_type"] = "Payable"

	frappe.db.commit()
	print("Site setup updates:", updates or "none needed")
	return updates
