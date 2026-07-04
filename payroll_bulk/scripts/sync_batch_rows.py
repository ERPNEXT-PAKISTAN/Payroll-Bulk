"""Sync batch employee rows from linked Salary Slip docstatus.

Run:
  bench --site your-site execute payroll_bulk.scripts.sync_batch_rows.run \\
    --kwargs '{"batch_name":"BSC-2026-00020"}'
"""

from __future__ import annotations

import frappe

from payroll_bulk.api import sync_bulk_batch_slip_status


def run(batch_name: str):
	frappe.only_for(("System Manager", "HR Manager"))
	result = sync_bulk_batch_slip_status(batch_name)
	print(f"Synced {batch_name}: {result.get('updated_count', 0)} row(s) updated")
	return result
