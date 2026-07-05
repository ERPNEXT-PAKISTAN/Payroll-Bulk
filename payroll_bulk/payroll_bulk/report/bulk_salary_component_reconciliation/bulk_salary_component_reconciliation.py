from __future__ import annotations

import frappe
from frappe import _

from payroll_bulk.api import get_batch_component_reconciliation
from payroll_bulk.payroll_bulk.report.report_utils import pb_money


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = [
		{"label": "Employee", "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 110},
		{"label": "Name", "fieldname": "employee_name", "fieldtype": "Data", "width": 140},
		{"label": "Salary Slip", "fieldname": "salary_slip", "fieldtype": "Link", "options": "Salary Slip", "width": 130},
		{"label": "Component", "fieldname": "salary_component", "fieldtype": "Link", "options": "Salary Component", "width": 150},
		{"label": "Type", "fieldname": "component_type", "fieldtype": "Data", "width": 80},
		{"label": "Batch", "fieldname": "batch_amount", "fieldtype": "Currency", "width": 100},
		{"label": "Slip", "fieldname": "slip_amount", "fieldtype": "Currency", "width": 100},
		{"label": "ADS", "fieldname": "ads_amount", "fieldtype": "Currency", "width": 100},
		{"label": "Batch−Slip", "fieldname": "batch_slip_diff", "fieldtype": "Currency", "width": 95},
		{"label": "Batch−ADS", "fieldname": "batch_ads_diff", "fieldtype": "Currency", "width": 95},
		{"label": "Slip−ADS", "fieldname": "slip_ads_diff", "fieldtype": "Currency", "width": 95},
		{"label": "Status", "fieldname": "match_label", "fieldtype": "Data", "width": 90},
		{"label": "Issue", "fieldname": "issue", "fieldtype": "Data", "width": 180},
	]

	if not filters.get("batch"):
		return columns, [], _("Select a batch to reconcile components."), None, []

	result = get_batch_component_reconciliation(filters.batch)
	rows = result.get("rows") or []
	summary = result.get("summary") or {}

	if not filters.get("show_matched"):
		rows = [row for row in rows if not row.get("match")]

	for row in rows:
		for fieldname in (
			"batch_amount",
			"slip_amount",
			"ads_amount",
			"batch_slip_diff",
			"batch_ads_diff",
			"slip_ads_diff",
		):
			row[fieldname] = pb_money(row.get(fieldname))

	matched = summary.get("matched", 0)
	mismatch = summary.get("mismatch", 0)
	batch_only = summary.get("batch_only", 0)
	slip_only = summary.get("slip_only", 0)
	ads_only = summary.get("ads_only", 0)
	missing_slip = summary.get("missing_slip", 0)
	issues = mismatch + batch_only + slip_only + ads_only + missing_slip

	report_summary = [
		{"value": summary.get("total", len(rows)), "label": _("Lines"), "datatype": "Int"},
		{"value": matched, "label": _("Matched"), "indicator": "Green", "datatype": "Int"},
		{"value": mismatch, "label": _("Mismatch"), "indicator": "Orange" if mismatch else "Green", "datatype": "Int"},
		{"value": batch_only, "label": _("Batch Only"), "indicator": "Orange" if batch_only else "Green", "datatype": "Int"},
		{"value": slip_only, "label": _("Slip Only"), "indicator": "Orange" if slip_only else "Green", "datatype": "Int"},
		{"value": ads_only, "label": _("ADS Only"), "indicator": "Orange" if ads_only else "Green", "datatype": "Int"},
	]

	chart = None
	chart_values = [matched, mismatch, batch_only, slip_only, ads_only, missing_slip]
	if any(chart_values):
		chart = {
			"data": {
				"labels": [_("Matched"), _("Mismatch"), _("Batch Only"), _("Slip Only"), _("ADS Only"), _("Missing Slip")],
				"datasets": [{"name": _("Lines"), "values": chart_values}],
			},
			"type": "donut",
			"colors": ["#16a34a", "#ea580c", "#2563eb", "#7c3aed", "#0891b2", "#dc2626"],
		}

	message = None
	if filters.batch:
		if issues:
			message = _("Batch {0}: {1} component issue(s) need attention.").format(
				frappe.bold(filters.batch),
				frappe.bold(str(issues)),
			)
		else:
			message = _("Batch {0}: all component lines matched.").format(frappe.bold(filters.batch))

	return columns, rows, message, chart, report_summary
