"""Sync batch row status from linked salary slips."""

from __future__ import annotations

import frappe

from payroll_bulk.events.salary_slip import _update_batch_summary


def run(batch_name: str = "BSC-2026-00020"):
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	for row in batch.employees:
		if not row.salary_slip:
			continue
		slip = frappe.db.get_value(
			"Salary Slip",
			row.salary_slip,
			["docstatus", "gross_pay", "net_pay"],
			as_dict=True,
		)
		if not slip:
			continue
		if slip.docstatus == 1:
			status = "Submitted"
			slip_status = "Submitted"
		elif slip.docstatus == 0:
			status = "Slip Created"
			slip_status = "Draft"
		else:
			status = "Cancelled"
			slip_status = "Cancelled"
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row.name,
			{
				"status": status,
				"salary_slip_status": slip_status,
				"gross_pay": slip.gross_pay,
				"net_pay": slip.net_pay,
				"error_message": "",
			},
			update_modified=False,
		)
	_update_batch_summary(batch_name)
	frappe.db.commit()
	print(f"Synced {batch_name}")
