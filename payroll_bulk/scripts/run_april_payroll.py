"""Create and complete April 2026 bulk salary for all 4 employees.

bench --site ss.frappe.my execute payroll_bulk.scripts.run_april_payroll.run
"""

from __future__ import annotations

import frappe
from frappe.utils import add_months, get_first_day, get_last_day

from payroll_bulk.api import (
	create_bulk_accrual_journal_entry,
	create_bulk_payment_journal_entry,
	ensure_bulk_batch_source_data,
	process_bulk_batch_rows,
)


EMPLOYEES = [
	{"employee": "HR-EMP-00001", "ctc": 100000, "adv_deduct": 15000, "payment_days": 30},
	{"employee": "HR-EMP-00002", "ctc": 65000, "adv_deduct": 20000, "payment_days": 30},
	{"employee": "HR-EMP-00003", "ctc": 85000, "adv_deduct": 13000, "payment_days": 30},
	{"employee": "HR-EMP-00004", "ctc": 65000, "adv_deduct": 0, "payment_days": 30},
]


def _april_dates():
	start = get_first_day(add_months("2026-04-01", 0))
	end = get_last_day(start)
	return start, end


def _default_bank_account(company: str) -> str:
	for account_type in ("Bank", "Cash"):
		name = frappe.db.get_value(
			"Account",
			{"company": company, "account_type": account_type, "is_group": 0},
			"name",
		)
		if name:
			return name
	frappe.throw(f"No Bank/Cash account found for {company}")


def _create_batch(company: str, start_date, end_date):
	batch = frappe.get_doc(
		{
			"doctype": "Bulk Salary Creation",
			"company": company,
			"payroll_frequency": "Monthly",
			"start_date": start_date,
			"end_date": end_date,
			"posting_date": end_date,
			"calculation_mode": "Manual",
			"manual_salary_basis": "Full Month",
		}
	)
	for emp in EMPLOYEES:
		employee_doc = frappe.get_doc("Employee", emp["employee"])
		batch.append(
			"employees",
			{
				"employee": emp["employee"],
				"employee_name": employee_doc.employee_name,
				"department": employee_doc.department,
				"designation": employee_doc.designation,
				"ctc": emp["ctc"],
				"adv_deduct": emp["adv_deduct"],
				"payment_days": emp["payment_days"],
				"status": "Pending",
			},
		)
	batch.insert(ignore_permissions=True)
	return batch


def _print_batch(batch_name: str):
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	print(f"\n=== {batch_name} | {batch.start_date} → {batch.end_date} | {batch.processing_status} ===")
	for row in batch.employees:
		print(
			row.employee,
			row.status,
			row.salary_slip or "-",
			row.salary_slip_status or "-",
			f"gross={row.gross_pay}",
			f"net={row.net_pay}",
			f"adv={row.adv_deduct}",
			(row.error_message or "")[:80],
		)
	print("Accrual JE:", batch.accrual_journal_entry or "-")
	return batch


def _fix_batch_00023():
	"""Remove cross-batch slip links wrongly copied from BSC-2026-00022."""
	if not frappe.db.exists("Bulk Salary Creation", "BSC-2026-00023"):
		return
	for row in frappe.get_all(
		"Bulk Salary Creation Employee",
		filters={"parent": "BSC-2026-00023"},
		fields=["name", "employee", "salary_slip"],
	):
		if not row.salary_slip:
			continue
		slip_batch = frappe.db.get_value("Salary Slip", row.salary_slip, "bulk_salary_creation")
		if slip_batch and slip_batch != "BSC-2026-00023":
			frappe.db.set_value(
				"Bulk Salary Creation Employee",
				row.name,
				{
					"salary_slip": "",
					"salary_slip_status": "",
					"status": "Pending",
					"error_message": f"Unlinked slip from batch {slip_batch} (cross-batch link removed).",
				},
				update_modified=False,
			)
	frappe.db.set_value(
		"Bulk Salary Creation",
		"BSC-2026-00023",
		{"processing_status": "Draft", "accrual_journal_entry": ""},
		update_modified=False,
	)
	frappe.db.commit()


def fix_emp01(batch_name: str = "BSC-2026-00024"):
	"""Reprocess HR-EMP-00001 after replace-existing fix."""
	from payroll_bulk.api import reprocess_bulk_salary_row

	frappe.only_for(("System Manager", "HR Manager"))
	result = reprocess_bulk_salary_row(
		batch_name, "kp1jh7d717", submit_slip=1, cancel_existing=1
	)
	frappe.db.commit()
	_print_batch(batch_name)
	return result


def run(batch_name: str | None = "BSC-2026-00024", skip_payment: int = 0, fix_failed_only: int = 0):
	frappe.only_for(("System Manager", "HR Manager"))
	_fix_batch_00023()

	company = frappe.db.get_value("Bulk Salary Creation", "BSC-2026-00022", "company")
	if not company:
		company = frappe.defaults.get_global_default("company")

	start_date, end_date = _april_dates()

	if batch_name and frappe.db.exists("Bulk Salary Creation", batch_name):
		batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	else:
		batch = _create_batch(company, start_date, end_date)
		batch_name = batch.name

	if int(fix_failed_only):
		from payroll_bulk.api import reprocess_bulk_salary_row

		for row in batch.employees:
			if row.status != "Failed":
				continue
			print(f"Reprocessing failed row {row.employee} …")
			reprocess_bulk_salary_row(batch_name, row.name, submit_slip=1, cancel_existing=1)
		frappe.db.commit()
		try:
			accrual = create_bulk_accrual_journal_entry(batch_name)
			print("Accrual JE:", accrual)
		except Exception as error:
			print("Accrual skipped:", error)
		if not int(skip_payment):
			bank = _default_bank_account(company)
			try:
				payment = create_bulk_payment_journal_entry(batch_name, bank)
				print("Payment JE:", payment)
			except Exception as error:
				print("Payment skipped:", error)
		frappe.db.commit()
		_print_batch(batch_name)
		return {"batch_name": batch_name, "fix_failed_only": True}

	print(f"Processing {batch_name} for April 2026 …")
	ensure_bulk_batch_source_data(batch_name, start_date, end_date)

	draft = process_bulk_batch_rows(batch_name, submit_slip=0, replace_existing=1)
	print("Draft result:", draft)
	_print_batch(batch_name)

	submit = process_bulk_batch_rows(batch_name, submit_slip=1, replace_existing=0)
	print("Submit result:", submit)
	_print_batch(batch_name)

	accrual = create_bulk_accrual_journal_entry(batch_name)
	print("Accrual JE:", accrual)
	_print_batch(batch_name)

	if not int(skip_payment):
		bank = _default_bank_account(company)
		payment = create_bulk_payment_journal_entry(batch_name, bank)
		print("Payment JE:", payment)
		_print_batch(batch_name)

	frappe.db.commit()
	return {"batch_name": batch_name, "draft": draft, "submit": submit, "accrual": accrual}
