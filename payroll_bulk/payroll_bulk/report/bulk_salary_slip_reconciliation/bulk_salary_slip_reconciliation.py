from __future__ import annotations

import frappe
from frappe import _

from payroll_bulk.api import get_batch_slip_reconciliation
from payroll_bulk.payroll_bulk.report.report_utils import pb_money, pb_format_columns


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": "Employee Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 150},
		{"label": "Department", "fieldname": "department", "fieldtype": "Link", "options": "Department", "width": 120},
		{"label": "Salary Slip", "fieldname": "salary_slip", "fieldtype": "Link", "options": "Salary Slip", "width": 140},
		{"label": "Slip Status", "fieldname": "salary_slip_status", "fieldtype": "Data", "width": 90},
		{"label": "Batch Gross", "fieldname": "batch_gross", "fieldtype": "Currency", "width": 110},
		{"label": "Slip Gross", "fieldname": "slip_gross", "fieldtype": "Currency", "width": 110},
		{"label": "Batch Net", "fieldname": "batch_net", "fieldtype": "Currency", "width": 110},
		{"label": "Slip Net", "fieldname": "slip_net", "fieldtype": "Currency", "width": 110},
		{"label": "Net Diff", "fieldname": "net_diff", "fieldtype": "Currency", "width": 100},
		{"label": "Status", "fieldname": "match_label", "fieldtype": "Data", "width": 100},
		{"label": "Issue", "fieldname": "issue", "fieldtype": "Data", "width": 180},
	]

	if not filters.get("batch"):
		return pb_format_columns(columns), [], _("Select a batch to reconcile."), None, []

	result = get_batch_slip_reconciliation(filters.batch)
	rows = result.get("rows") or []
	summary = result.get("summary") or {}

	if not filters.get("show_matched"):
		rows = [row for row in rows if not row.get("match")]

	for row in rows:
		row["match_label"] = "Matched" if row.get("match") else "Issue"
		row["net_diff"] = pb_money(row.get("net_diff"))
		row["gross_diff"] = pb_money(row.get("gross_diff"))
		row["batch_gross"] = pb_money(row.get("batch_gross"))
		row["batch_net"] = pb_money(row.get("batch_net"))
		row["slip_gross"] = pb_money(row.get("slip_gross"))
		row["slip_net"] = pb_money(row.get("slip_net"))
		if row.get("match"):
			row["issue_type"] = "matched"
		elif row.get("issue") == "Missing Salary Slip":
			row["issue_type"] = "missing_slip"
		elif row.get("issue") == "Amount mismatch":
			row["issue_type"] = "mismatch"
		elif "Empty slip" in (row.get("issue") or "") or "Zero amounts" in (row.get("issue") or ""):
			row["issue_type"] = "zero_slip"
		elif "No batch row" in (row.get("issue") or ""):
			row["issue_type"] = "no_row"
		else:
			row["issue_type"] = "other"

	matched = summary.get("matched", 0)
	mismatched = summary.get("mismatched", 0)
	missing_slip = summary.get("missing_slip", 0)
	no_row = summary.get("no_row", 0)
	issues = mismatched + missing_slip + no_row

	report_summary = [
		{"value": summary.get("total", len(rows)), "label": _("Employees"), "datatype": "Int"},
		{"value": matched, "label": _("Matched"), "indicator": "Green", "datatype": "Int"},
		{"value": mismatched, "label": _("Mismatch"), "indicator": "Orange" if mismatched else "Green", "datatype": "Int"},
		{"value": missing_slip, "label": _("Missing Slip"), "indicator": "Red" if missing_slip else "Green", "datatype": "Int"},
		{"value": no_row, "label": _("Orphan Slip"), "indicator": "Red" if no_row else "Green", "datatype": "Int"},
	]

	chart = None
	chart_values = [matched, mismatched, missing_slip, no_row]
	if any(chart_values):
		chart = {
			"data": {
				"labels": [_("Matched"), _("Mismatch"), _("Missing Slip"), _("Orphan Slip")],
				"datasets": [{"name": _("Rows"), "values": chart_values}],
			},
			"type": "donut",
			"colors": ["#16a34a", "#ea580c", "#dc2626", "#9333ea"],
		}

	message = None
	if filters.batch:
		batch_label = frappe.db.get_value("Bulk Salary Creation", filters.batch, "name") or filters.batch
		if issues:
			message = _("Batch {0}: {1} issue(s) need attention.").format(
				frappe.bold(batch_label),
				frappe.bold(str(issues)),
			)
		else:
			message = _("Batch {0}: all rows matched.").format(frappe.bold(batch_label))

	return pb_format_columns(columns), rows, message, chart, report_summary
