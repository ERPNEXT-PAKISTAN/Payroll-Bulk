"""Run with:
bench --site ss.frappe.my execute payroll_bulk.scripts.process_batch_demo.run --kwargs '{"batch_name":"BSC-2026-00020"}'
bench --site ss.frappe.my execute payroll_bulk.scripts.process_batch_demo.run --kwargs '{"batch_name":"BSC-2026-00020","action":"cancel_repost"}'
"""

from __future__ import annotations

import frappe

from payroll_bulk.api import (
	_cancel_batch_additional_salaries,
	create_bulk_accrual_journal_entry,
	process_bulk_batch_rows,
	reprocess_bulk_salary_row,
)


def _print_rows(batch_name: str):
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	for row in batch.employees:
		print(
			row.employee,
			row.status,
			row.salary_slip,
			row.salary_slip_status,
			row.gross_pay,
			row.net_pay,
			(row.error_message or "")[:120],
		)
	return batch


def run(batch_name: str = "BSC-2026-00020", submit: int = 1, action: str = "process"):
	frappe.only_for(("System Manager", "HR Manager"))
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	print(f"Batch {batch_name} | {len(batch.employees)} employees | action={action}")

	if action == "cancel_repost":
		for row in batch.employees:
			if not row.employee:
				continue
			print(f"Reprocessing {row.employee} ...")
			reprocess_bulk_salary_row(batch_name, row.name, submit_slip=submit, cancel_existing=1)
		batch = _print_rows(batch_name)
		return {"batch_name": batch_name, "action": action}

	if action == "cancel_only":
		for row in batch.employees:
			if row.salary_slip:
				slip = frappe.get_doc("Salary Slip", row.salary_slip)
				if slip.docstatus == 1:
					slip.cancel()
				elif slip.docstatus == 0:
					slip.delete()
			_cancel_batch_additional_salaries(batch_name, employee=row.employee)
		batch.reload()
		_print_rows(batch_name)
		return {"batch_name": batch_name, "action": action}

	draft_result = process_bulk_batch_rows(batch_name, submit_slip=0, replace_existing=1)
	print("Draft slips:", draft_result)
	_print_rows(batch_name)

	if submit:
		submit_result = process_bulk_batch_rows(batch_name, submit_slip=1, replace_existing=0)
		print("Submitted slips:", submit_result)
		_print_rows(batch_name)
		try:
			accrual = create_bulk_accrual_journal_entry(batch_name)
			print("Accrual JE:", accrual)
		except Exception as error:
			print("Accrual skipped:", error)

	return {"batch_name": batch_name, "draft_result": draft_result}
