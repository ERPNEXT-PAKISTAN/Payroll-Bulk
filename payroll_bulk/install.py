from __future__ import annotations

import importlib.util
import json

import frappe


def after_install():
	_disable_legacy_scripts()
	_cleanup_navigation_records()
	_normalize_payroll_bulk_settings()


def after_migrate():
	_disable_legacy_scripts()
	_cleanup_navigation_records()
	_normalize_payroll_bulk_settings()


def _disable_legacy_scripts():
	if frappe.db.exists("Client Script", "Bulk Salary Creation"):
		frappe.db.set_value("Client Script", "Bulk Salary Creation", "enabled", 0, update_modified=False)
	for name in ("Bulk Salary Sync - Salary Slip After Insert", "Bulk Salary Sync - Salary Slip On Submit", "Bulk Salary Sync - Salary Slip On Cancel"):
		if frappe.db.exists("Server Script", name):
			frappe.db.set_value("Server Script", name, "disabled", 1, update_modified=False)


def _cleanup_navigation_records():
	_remove_missing_app_artifacts("main_reporting", ["Main Reporting", "Main Reports"])
	_remove_missing_app_artifacts("dashboarding", ["Dashboarding"])
	_cleanup_desktop_layout_entries({"Dashboarding", "Main Reporting", "Main Reports"})
	_ensure_payroll_bulk_in_desktop_layout()


def _remove_missing_app_artifacts(app_name: str, labels: list[str]):
	if importlib.util.find_spec(app_name):
		return

	if frappe.db.exists("Installed Application", app_name):
		frappe.delete_doc("Installed Application", app_name, force=1, ignore_permissions=True)

	for doctype, fieldnames in {
		"Workspace": ["name", "title", "app", "module"],
		"Workspace Sidebar": ["name", "title", "app", "module"],
		"Desktop Icon": ["name", "label", "app", "parent_icon", "link_to"],
	}.items():
		for fieldname in fieldnames:
			for value in [app_name, *labels]:
				names = frappe.get_all(doctype, filters={fieldname: value}, pluck="name")
				for name in names:
					frappe.delete_doc(doctype, name, force=1, ignore_permissions=True)


def _cleanup_desktop_layout_entries(stale_labels: set[str]):
	for layout_name in frappe.get_all("Desktop Layout", pluck="name"):
		layout_doc = frappe.get_doc("Desktop Layout", layout_name)
		layout_items = json.loads(layout_doc.layout or "[]")
		filtered_items = [item for item in layout_items if not _is_stale_layout_item(item, stale_labels)]
		if len(filtered_items) != len(layout_items):
			layout_doc.layout = json.dumps(filtered_items)
			layout_doc.save(ignore_permissions=True)


def _is_stale_layout_item(item: dict, stale_labels: set[str]) -> bool:
	if not isinstance(item, dict):
		return False

	workspace = item.get("workspace") if isinstance(item.get("workspace"), dict) else {}
	for value in (
		item.get("label"),
		item.get("name"),
		item.get("link_to"),
		item.get("parent_icon"),
		workspace.get("label"),
	):
		if value in stale_labels:
			return True
	return False


def _ensure_payroll_bulk_in_desktop_layout():
	if not frappe.db.exists("Desktop Icon", "Payroll Bulk"):
		return

	layout_icon = {
		"label": "Payroll Bulk",
		"bg_color": None,
		"link": None,
		"link_type": "Workspace Sidebar",
		"app": "payroll_bulk",
		"icon_type": "Link",
		"parent_icon": None,
		"icon": "briefcase",
		"link_to": "Payroll Bulk",
		"idx": 999,
		"standard": 1,
		"logo_url": "/assets/payroll_bulk/payroll_bulk_logo.svg",
		"hidden": 0,
		"name": "Payroll Bulk",
		"restrict_removal": 0,
		"icon_image": None,
		"child_icons": [],
	}

	for layout_name in frappe.get_all("Desktop Layout", pluck="name"):
		layout_doc = frappe.get_doc("Desktop Layout", layout_name)
		layout_items = json.loads(layout_doc.layout or "[]")
		if any(item.get("label") == "Payroll Bulk" or item.get("name") == "Payroll Bulk" for item in layout_items if isinstance(item, dict)):
			continue
		layout_items.append(layout_icon)
		layout_doc.layout = json.dumps(layout_items)
		layout_doc.save(ignore_permissions=True)


def _normalize_payroll_bulk_settings():
	settings = frappe.get_single("Payroll Bulk Settings")
	updates = {}
	legacy_settings = not settings.get("default_calculation_mode")

	if not settings.get("company"):
		default_company = frappe.defaults.get_global_default("company") or frappe.defaults.get_user_default("Company")
		if default_company:
			updates["company"] = default_company

	if legacy_settings:
		updates["default_calculation_mode"] = "Manual"
	elif settings.get("default_calculation_mode") == "Per Piece Qty":
		updates["default_calculation_mode"] = "Per Piece or Per Hour"

	if not settings.get("default_per_piece_basis"):
		updates["default_per_piece_basis"] = "Total Hours"

	for fieldname in (
		"show_department_filter",
		"show_branch_filter",
		"show_designation_filter",
		"show_employee_filter",
		"auto_hide_filters",
		"auto_load_structure_components",
	):
		if legacy_settings or settings.get(fieldname) is None:
			updates[fieldname] = 1

	if legacy_settings and settings.get("enable_manual_add") is None:
		updates["enable_manual_add"] = 1
	elif legacy_settings:
		updates["enable_manual_add"] = 1

	if not settings.get("enable_filter_fetch"):
		updates["show_department_filter"] = 0
		updates["show_branch_filter"] = 0
		updates["show_designation_filter"] = 0

	if not settings.get("show_employee_filter"):
		updates["enable_manual_add"] = 0

	if updates:
		frappe.db.set_value("Payroll Bulk Settings", "Payroll Bulk Settings", updates, update_modified=False)
