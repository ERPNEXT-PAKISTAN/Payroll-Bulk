from __future__ import annotations

import frappe
from frappe.model.document import Document

TRACKED_SUCCESS = {"Slip Created", "Submitted", "Payment Created", "Completed"}
TRACKED_PROCESSED = TRACKED_SUCCESS | {"Cancelled", "Failed"}


def after_insert(doc: Document, method=None):
	_sync_salary_slip_links(doc, event="after_insert")


def on_submit(doc: Document, method=None):
	_sync_salary_slip_links(doc, event="on_submit")


def on_cancel(doc: Document, method=None):
	_sync_salary_slip_links(doc, event="on_cancel")


def _sync_salary_slip_links(doc: Document, event: str):
	row_name = doc.get("bulk_salary_creation_employee")
	batch_name = doc.get("bulk_salary_creation")
	if not row_name or not batch_name:
		return
	row_updates = {
		"salary_slip": doc.name,
		"salary_structure": doc.get("salary_structure") or "",
		"gross_pay": doc.get("gross_pay") or 0,
		"net_pay": doc.get("net_pay") or 0,
	}
	if event == "after_insert":
		row_updates.update({"status": "Slip Created", "salary_slip_status": "Draft", "slip_cancelled_on": None, "error_message": ""})
	elif event == "on_submit":
		row_updates.update({"status": "Submitted", "salary_slip_status": "Submitted", "slip_cancelled_on": None, "error_message": ""})
	elif event == "on_cancel":
		row_updates.update({"status": "Cancelled", "salary_slip_status": "Cancelled", "slip_cancelled_on": frappe.utils.now_datetime(), "error_message": "Salary Slip cancelled from Salary Slip document."})
	frappe.db.set_value("Bulk Salary Creation Employee", row_name, row_updates, update_modified=False)
	_update_batch_summary(batch_name)


def _update_batch_summary(batch_name: str):
	rows = frappe.get_all("Bulk Salary Creation Employee", filters={"parent": batch_name}, fields=["status", "salary_slip_status", "gross_pay", "net_pay", "total_additions", "total_deductions"], limit_page_length=1000)
	total_employees = len(rows)
	processed_count = sum(1 for row in rows if row.status in TRACKED_PROCESSED)
	success_count = sum(1 for row in rows if row.status in TRACKED_SUCCESS)
	failed_count = sum(1 for row in rows if row.status == "Failed")
	submitted_count = sum(1 for row in rows if row.salary_slip_status == "Submitted")
	cancelled_count = sum(1 for row in rows if row.salary_slip_status == "Cancelled" or row.status == "Cancelled")
	total_additions = sum(row.total_additions or 0 for row in rows)
	total_deductions = sum(row.total_deductions or 0 for row in rows)
	total_gross = sum(row.gross_pay or 0 for row in rows)
	total_net = sum(row.net_pay or 0 for row in rows)
	if not total_employees:
		processing_status = "Draft"
	elif cancelled_count == total_employees:
		processing_status = "Cancelled"
	elif failed_count and success_count:
		processing_status = "Completed With Errors"
	elif failed_count:
		processing_status = "Partially Processed"
	elif submitted_count or success_count:
		processing_status = "Completed"
	else:
		processing_status = "Ready"
	frappe.db.set_value("Bulk Salary Creation", batch_name, {"total_employees": total_employees, "processed_count": processed_count, "success_count": success_count, "failed_count": failed_count, "submitted_count": submitted_count, "cancelled_count": cancelled_count, "total_additions": total_additions, "total_deductions": total_deductions, "total_gross": total_gross, "total_net": total_net, "processing_status": processing_status}, update_modified=False)
