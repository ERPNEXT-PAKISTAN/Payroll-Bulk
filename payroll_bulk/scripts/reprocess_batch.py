"""Reprocess all rows in a bulk salary batch (dev/maintenance helper)."""

from __future__ import annotations

import frappe

from payroll_bulk.api import (
	_cancel_or_delete_existing_slip,
	ensure_bulk_batch_source_data,
	get_batch_slip_reconciliation,
	reprocess_bulk_salary_row,
)


def run(
	batch_name: str = "BSC-2026-00022",
	use_manual_full_month: int = 1,
):
	"""Recreate draft salary slips for every employee row in a batch."""
	if not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(f"Batch {batch_name} not found")

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	if int(use_manual_full_month):
		batch.calculation_mode = "Manual"
		batch.manual_salary_basis = "Full Month"

	for row in batch.employees:
		if int(use_manual_full_month):
			row.payment_days = 30
		if row.salary_slip:
			_cancel_or_delete_existing_slip(row.salary_slip)
			row.salary_slip = ""
			row.salary_slip_status = ""
			row.status = "Pending"
			row.error_message = ""

	batch.save(ignore_permissions=True)
	ensure_bulk_batch_source_data(batch_name, batch.start_date, batch.end_date)

	results = []
	for row in batch.employees:
		if not row.employee:
			continue
		results.append(
			reprocess_bulk_salary_row(
				batch_name,
				row.name,
				submit_slip=0,
				cancel_existing=1,
			)
		)

	frappe.db.commit()
	reconcile = get_batch_slip_reconciliation(batch_name)
	return {"slips": results, "reconciliation": reconcile}
