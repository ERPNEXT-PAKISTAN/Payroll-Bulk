from __future__ import annotations

import json

import frappe


def after_install():
	_disable_legacy_scripts()
	_sync_desk()


def after_migrate():
	_disable_legacy_scripts()
	_sync_desk()


def _disable_legacy_scripts():
	if frappe.db.exists("Client Script", "Bulk Salary Creation"):
		frappe.db.set_value("Client Script", "Bulk Salary Creation", "enabled", 0, update_modified=False)
	for name in ("Bulk Salary Sync - Salary Slip After Insert", "Bulk Salary Sync - Salary Slip On Submit", "Bulk Salary Sync - Salary Slip On Cancel"):
		if frappe.db.exists("Server Script", name):
			frappe.db.set_value("Server Script", name, "disabled", 1, update_modified=False)


def _sync_desk():
	_sync_workspace()
	_sync_workspace_sidebar()
	_sync_workspace_sidebar_items()
	_sync_desktop_icon()
	_remove_legacy_desk_items()


def _sync_workspace():
	content = [
		{"id": "pb_001", "type": "header", "data": {"text": "Payroll Bulk Workspace", "col": 12}},
		{
			"id": "pb_002",
			"type": "paragraph",
			"data": {
				"text": "Manage bulk salary batches, employee review, payroll settings, and reports from one place.",
				"col": 12,
			},
		},
		{"id": "pb_003", "type": "shortcut", "data": {"shortcut_name": "Bulk Salary Creation", "col": 3}},
		{"id": "pb_004", "type": "shortcut", "data": {"shortcut_name": "Employee Rows", "col": 3}},
		{"id": "pb_005", "type": "shortcut", "data": {"shortcut_name": "Payroll Bulk Settings", "col": 3}},
		{"id": "pb_006", "type": "shortcut", "data": {"shortcut_name": "Batch Summary Report", "col": 3}},
		{"id": "pb_007", "type": "shortcut", "data": {"shortcut_name": "Employee Detail Report", "col": 3}},
		{"id": "pb_008", "type": "spacer", "data": {"col": 12}},
		{"id": "pb_009", "type": "header", "data": {"text": "Browse Links", "col": 12}},
		{"id": "pb_010", "type": "card", "data": {"card_name": "Operations", "col": 4}},
		{"id": "pb_011", "type": "card", "data": {"card_name": "Setup", "col": 4}},
		{"id": "pb_012", "type": "card", "data": {"card_name": "Reports", "col": 4}},
	]
	links = [
		{"type": "Card Break", "label": "Operations", "link_count": 2},
		{"type": "Link", "label": "Bulk Salary Creation", "link_type": "DocType", "link_to": "Bulk Salary Creation"},
		{
			"type": "Link",
			"label": "Bulk Salary Creation Employee",
			"link_type": "DocType",
			"link_to": "Bulk Salary Creation Employee",
		},
		{"type": "Card Break", "label": "Setup", "link_count": 1},
		{"type": "Link", "label": "Payroll Bulk Settings", "link_type": "DocType", "link_to": "Payroll Bulk Settings"},
		{"type": "Card Break", "label": "Reports", "link_count": 2},
		{
			"type": "Link",
			"label": "Bulk Salary Creation Summary",
			"link_type": "Report",
			"link_to": "Bulk Salary Creation Summary",
		},
		{
			"type": "Link",
			"label": "Bulk Salary Employee Detail",
			"link_type": "Report",
			"link_to": "Bulk Salary Employee Detail",
		},
	]
	shortcuts = [
		{"label": "Bulk Salary Creation", "link_to": "Bulk Salary Creation", "type": "DocType", "color": "Blue"},
		{"label": "Employee Rows", "link_to": "Bulk Salary Creation Employee", "type": "DocType", "color": "Cyan"},
		{"label": "Payroll Bulk Settings", "link_to": "Payroll Bulk Settings", "type": "DocType", "color": "Orange"},
		{
			"label": "Batch Summary Report",
			"link_to": "Bulk Salary Creation Summary",
			"type": "Report",
			"color": "Green",
			"report_ref_doctype": "Bulk Salary Creation",
		},
		{
			"label": "Employee Detail Report",
			"link_to": "Bulk Salary Employee Detail",
			"type": "Report",
			"color": "Purple",
			"report_ref_doctype": "Bulk Salary Creation Employee",
		},
	]
	roles = [{"role": "System Manager"}, {"role": "HR Manager"}, {"role": "HR User"}]

	if frappe.db.exists("Workspace", "Payroll Bulk"):
		workspace = frappe.get_doc("Workspace", "Payroll Bulk")
	else:
		workspace = frappe.new_doc("Workspace")
		workspace.name = "Payroll Bulk"

	workspace.title = "Payroll Bulk"
	workspace.label = "Payroll Bulk"
	workspace.module = "Payroll Bulk"
	workspace.app = "payroll_bulk"
	workspace.public = 1
	workspace.is_hidden = 0
	workspace.icon = "octicon octicon-briefcase"
	workspace.indicator_color = "blue"
	workspace.sequence_id = 15.0
	workspace.type = "Workspace"
	workspace.content = json.dumps(content, separators=(",", ":"))
	workspace.parent_page = ""
	workspace.for_user = ""
	workspace.hide_custom = 0

	workspace.set("links", [])
	for row in links:
		workspace.append("links", row)

	workspace.set("shortcuts", [])
	for row in shortcuts:
		workspace.append("shortcuts", row)

	workspace.set("roles", [])
	for row in roles:
		workspace.append("roles", row)

	workspace.save(ignore_permissions=True)
	frappe.clear_cache()


def _sync_workspace_sidebar():
	filters = {"title": "Payroll Bulk"}
	if frappe.db.exists("Workspace Sidebar", filters):
		sidebar = frappe.get_doc("Workspace Sidebar", filters)
	else:
		sidebar = frappe.new_doc("Workspace Sidebar")

	sidebar.title = "Payroll Bulk"
	sidebar.module = "Payroll Bulk"
	sidebar.app = "payroll_bulk"
	sidebar.header_icon = "briefcase"
	sidebar.save(ignore_permissions=True)


def _sync_workspace_sidebar_items():
	sidebar = frappe.get_doc("Workspace Sidebar", {"title": "Payroll Bulk"})

	items = [
		{"label": "Payroll Bulk", "link_type": "Workspace", "link_to": "Payroll Bulk", "type": "Link"},
		{
			"label": "Bulk Salary Creation",
			"link_type": "DocType",
			"link_to": "Bulk Salary Creation",
			"type": "Link",
		},
		{
			"label": "Bulk Salary Creation Employee",
			"link_type": "DocType",
			"link_to": "Bulk Salary Creation Employee",
			"type": "Link",
		},
		{
			"label": "Payroll Bulk Settings",
			"link_type": "DocType",
			"link_to": "Payroll Bulk Settings",
			"type": "Link",
		},
		{
			"label": "Bulk Salary Creation Summary",
			"link_type": "Report",
			"link_to": "Bulk Salary Creation Summary",
			"type": "Link",
		},
		{
			"label": "Bulk Salary Employee Detail",
			"link_type": "Report",
			"link_to": "Bulk Salary Employee Detail",
			"type": "Link",
		},
	]

	sidebar.set("items", [])
	for row in items:
		sidebar.append("items", row)

	sidebar.save(ignore_permissions=True)


def _sync_desktop_icon():
	if frappe.db.exists("Desktop Icon", "Payroll Bulk"):
		icon = frappe.get_doc("Desktop Icon", "Payroll Bulk")
	else:
		icon = frappe.new_doc("Desktop Icon")
		icon.name = "Payroll Bulk"

	icon.label = "Payroll Bulk"
	icon.app = "payroll_bulk"
	icon.module_name = "Payroll Bulk"
	icon.link_type = "Workspace Sidebar"
	icon.link_to = "Payroll Bulk"
	icon.standard = 0
	icon.hidden = 0
	icon.icon = "briefcase"
	icon.color = "blue"
	icon.save(ignore_permissions=True)


def _remove_legacy_desk_items():
	if frappe.db.exists("Desktop Icon", "Dashboarding"):
		frappe.delete_doc("Desktop Icon", "Dashboarding", ignore_permissions=True, force=True)

	if frappe.db.exists("Workspace Sidebar", {"title": "Dashboarding"}):
		doc = frappe.get_doc("Workspace Sidebar", {"title": "Dashboarding"})
		doc.delete(ignore_permissions=True, force=True)

	if frappe.db.exists("Workspace", "Dashboarding"):
		frappe.delete_doc("Workspace", "Dashboarding", ignore_permissions=True, force=True)
