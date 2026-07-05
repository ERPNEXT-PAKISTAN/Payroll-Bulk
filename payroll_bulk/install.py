from __future__ import annotations

import importlib.util
import json

import frappe


def after_install():
	_disable_legacy_scripts()
	_cleanup_navigation_records()
	_normalize_payroll_bulk_settings()
	_ensure_reports()
	_ensure_pages()
	_cleanup_duplicate_dashboard_artifacts()
	_ensure_workspace_dashboard()


def after_migrate():
	_disable_legacy_scripts()
	_cleanup_navigation_records()
	_normalize_payroll_bulk_settings()
	_ensure_reports()
	_ensure_pages()
	_ensure_currency_precision()
	_cleanup_duplicate_dashboard_artifacts()
	_ensure_workspace_dashboard()
	_sync_additional_salary_bulk_links()


def _sync_additional_salary_bulk_links():
	if not frappe.db.exists("DocType", "Additional Salary"):
		return
	meta = frappe.get_meta("Additional Salary")
	if not meta.get_field("bulk_salary_creation"):
		return
	for row in frappe.get_all(
		"Additional Salary",
		filters={"ref_doctype": "Bulk Salary Creation"},
		fields=["name", "ref_docname", "bulk_salary_creation"],
		limit_page_length=0,
	):
		if row.ref_docname and row.bulk_salary_creation != row.ref_docname:
			frappe.db.set_value(
				"Additional Salary",
				row.name,
				"bulk_salary_creation",
				row.ref_docname,
				update_modified=False,
			)


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

	if not settings.get("default_payroll_frequency"):
		updates["default_payroll_frequency"] = "Monthly"

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


def _ensure_reports():
	import os

	report_root = frappe.get_app_path("payroll_bulk", "payroll_bulk", "report")
	if not os.path.isdir(report_root):
		return

	for folder in sorted(os.listdir(report_root)):
		if folder in ("__pycache__",) or folder.endswith(".py"):
			continue
		folder_path = os.path.join(report_root, folder)
		if not os.path.isdir(folder_path):
			continue
		json_path = os.path.join(folder_path, f"{folder}.json")
		if not os.path.isfile(json_path):
			continue
		with open(json_path) as handle:
			data = json.load(handle)
		name = data.get("name") or data.get("report_name")
		if not name:
			continue
		if not data.get("report_name"):
			data["report_name"] = name
		if frappe.db.exists("Report", name):
			frappe.db.set_value(
				"Report",
				name,
				{
					"disabled": 0,
					"report_type": data.get("report_type") or "Script Report",
					"ref_doctype": data.get("ref_doctype"),
					"module": data.get("module") or "Payroll Bulk",
				},
				update_modified=False,
			)
			continue
		doc = frappe.get_doc(data)
		doc.insert(ignore_permissions=True)


PB_PAGES = [
	("daily-employee-check", "Daily Employee Checkin"),
]


def _ensure_pages():
	import os

	page_root = frappe.get_app_path("payroll_bulk", "payroll_bulk", "page")
	if not os.path.isdir(page_root):
		return

	for folder in sorted(os.listdir(page_root)):
		if folder in ("__pycache__",) or folder.endswith(".py"):
			continue
		folder_path = os.path.join(page_root, folder)
		if not os.path.isdir(folder_path):
			continue
		json_path = os.path.join(folder_path, f"{folder}.json")
		if not os.path.isfile(json_path):
			continue
		with open(json_path) as handle:
			data = json.load(handle)
		name = data.get("name") or data.get("page_name")
		if not name:
			continue
		if frappe.db.exists("Page", name):
			frappe.db.set_value(
				"Page",
				name,
				{
					"title": data.get("title") or name,
					"module": data.get("module") or "Payroll Bulk",
				},
				update_modified=False,
			)
			continue
		doc = frappe.get_doc(data)
		doc.insert(ignore_permissions=True)


PB_CURRENCY_FIELDS = {
	"Bulk Salary Creation Employee": [
		"ctc", "ot_amount", "bonus_amount", "other_allowance", "total_additions",
		"advance_balance", "adv_deduct", "late_deduction", "other_deduction",
		"total_deductions", "gross_pay", "net_pay", "source_hours", "source_qty",
		"piece_rate", "structure_base",
	],
	"Bulk Salary Component Entry": ["amount"],
	"Bulk Salary Creation": [
		"total_gross", "total_net", "total_deductions", "total_additions",
	],
}


def _ensure_currency_precision():
	for doctype, fieldnames in PB_CURRENCY_FIELDS.items():
		for fieldname in fieldnames:
			frappe.db.set_value(
				"DocField",
				{"parent": doctype, "fieldname": fieldname},
				"precision",
				"0",
				update_modified=False,
			)
	# Keep overtime rate fields at 2 decimals where applicable.
	for fieldname in ("piece_rate",):
		frappe.db.set_value(
			"DocField",
			{"parent": "Bulk Salary Creation Employee", "fieldname": fieldname},
			"precision",
			"2",
			update_modified=False,
		)


def _cleanup_duplicate_dashboard_artifacts():
	for label in ("Open Batches", "Failed Rows", "Pending Payment", "Month Net Pay"):
		cards = frappe.get_all(
			"Number Card",
			filters={"label": label, "module": "Payroll Bulk"},
			pluck="name",
			order_by="creation asc",
		)
		for duplicate in cards[1:]:
			frappe.delete_doc("Number Card", duplicate, force=1, ignore_permissions=True)

	for chart_name in ("PB Batch Status", "PB Payment Overview"):
		charts = frappe.get_all(
			"Dashboard Chart",
			filters={"chart_name": chart_name, "module": "Payroll Bulk"},
			pluck="name",
			order_by="creation asc",
		)
		for duplicate in charts[1:]:
			frappe.delete_doc("Dashboard Chart", duplicate, force=1, ignore_permissions=True)


def _ensure_workspace_dashboard():
	card_names = [
		_ensure_number_card(
			"PB Open Batches",
			"Open Batches",
			"Bulk Salary Creation",
			"Count",
			[["processing_status", "not in", ["Completed", "Completed With Errors", "Cancelled"]]],
			"Blue",
		),
		_ensure_number_card(
			"PB Failed Rows",
			"Failed Rows",
			"Bulk Salary Creation Employee",
			"Count",
			[["status", "=", "Failed"]],
			"Red",
			parent_document_type="Bulk Salary Creation",
		),
		_ensure_number_card(
			"PB Pending Payment",
			"Pending Payment",
			"Bulk Salary Creation Employee",
			"Count",
			[["salary_slip_status", "=", "Submitted"], ["payment_entry", "is", "not set"]],
			"Orange",
			parent_document_type="Bulk Salary Creation",
		),
		_ensure_number_card(
			"PB Month Net Pay",
			"Month Net Pay",
			"Bulk Salary Creation",
			"Sum",
			[["posting_date", "Timespan", "this month"], ["docstatus", "<", 2]],
			"Green",
			aggregate_field="total_net",
		),
	]
	chart_name = _ensure_dashboard_chart(
		"PB Batch Status",
		"Bulk Salary Creation",
		"processing_status",
	)
	_payment_chart = _ensure_dashboard_chart(
		"PB Payment Overview",
		"Bulk Salary Creation Employee",
		"payment_status",
		parent_document_type="Bulk Salary Creation",
	)
	_row_chart = _ensure_dashboard_chart(
		"PB Employee Row Status",
		"Bulk Salary Creation Employee",
		"status",
		parent_document_type="Bulk Salary Creation",
	)
	_sync_payroll_bulk_workspace(card_names, chart_name, payment_chart_name=_payment_chart, row_chart_name=_row_chart)


PB_REPORTS = [
	("Bulk Salary Creation Summary", "Bulk Salary Creation"),
	("Bulk Salary Employee Detail", "Bulk Salary Creation Employee"),
	("Bulk Salary Payment Status", "Bulk Salary Creation Employee"),
	("Bulk Salary Slip Reconciliation", "Bulk Salary Creation"),
	("Bulk Salary Component Reconciliation", "Bulk Salary Creation"),
	("Bulk Salary Component Detail", "Bulk Salary Creation"),
	("Bulk Salary Advance Summary", "Bulk Salary Creation"),
	("Bulk Salary Report", "Salary Slip"),
	("Bulk Salary Register", "Bulk Salary Creation"),
	("Employee Salary Slip", "Salary Slip"),
]

PB_REPORT_SHORTCUTS = [
	("Batch Summary", "Bulk Salary Creation Summary", "Bulk Salary Creation", "Green"),
	("Employee Detail", "Bulk Salary Employee Detail", "Bulk Salary Creation Employee", "Cyan"),
	("Payment Status", "Bulk Salary Payment Status", "Bulk Salary Creation Employee", "Orange"),
	("Slip Reconciliation", "Bulk Salary Slip Reconciliation", "Bulk Salary Creation", "Red"),
	("Component Reconciliation", "Bulk Salary Component Reconciliation", "Bulk Salary Creation", "Pink"),
	("Component Detail", "Bulk Salary Component Detail", "Bulk Salary Creation", "Purple"),
	("Advance Summary", "Bulk Salary Advance Summary", "Bulk Salary Creation", "Yellow"),
	("Salary Report", "Bulk Salary Report", "Salary Slip", "Blue"),
	("Salary Register", "Bulk Salary Register", "Bulk Salary Creation", "Green"),
	("Employee Slip", "Employee Salary Slip", "Salary Slip", "Cyan"),
	("ERP Salary Register", "Salary Register", "Salary Slip", "Grey"),
]

PB_OPERATIONS_LINKS = [
	("Salary Slip", "Salary Slip", "DocType"),
	("Additional Salary", "Additional Salary", "DocType"),
	("Employee", "Employee", "DocType"),
	("Journal Entry", "Journal Entry", "DocType"),
	("Daily Overtime", "Daily Overtime", "DocType"),
	("Attendance", "Attendance", "DocType"),
	("Employee Checkin", "Employee Checkin", "DocType"),
	("Employee Advance", "Employee Advance", "DocType"),
]

PB_SETUP_LINKS = [
	("Salary Component", "Salary Component", "DocType"),
	("Salary Structure", "Salary Structure", "DocType"),
]

PB_OPERATIONS_SHORTCUTS = [
	("Salary Slip", "Salary Slip", "DocType", "Blue"),
	("Additional Salary", "Additional Salary", "DocType", "Cyan"),
	("Employee", "Employee", "DocType", "Green"),
	("Journal Entry", "Journal Entry", "DocType", "Orange"),
	("Daily Overtime", "Daily Overtime", "DocType", "Yellow"),
	("Attendance", "Attendance", "DocType", "Pink"),
	("Employee Checkin", "Employee Checkin", "DocType", "Purple"),
	("Employee Advance", "Employee Advance", "DocType", "Red"),
]

PB_SETUP_SHORTCUTS = [
	("Salary Component", "Salary Component", "DocType", "Grey"),
	("Salary Structure", "Salary Structure", "DocType", "Grey"),
]


def _ensure_number_card(name, label, document_type, function, filters, color, aggregate_field=None, parent_document_type=None):
	existing = frappe.db.get_value("Number Card", {"label": label, "module": "Payroll Bulk"}, "name")
	if existing:
		return existing

	doc = frappe.new_doc("Number Card")
	doc.update(
		{
			"label": label,
			"type": "Document Type",
			"document_type": document_type,
			"function": function,
			"is_public": 1,
			"is_standard": 1,
			"module": "Payroll Bulk",
			"filters_json": json.dumps(filters),
			"color": color,
		}
	)
	if parent_document_type:
		doc.parent_document_type = parent_document_type
	if aggregate_field:
		doc.aggregate_function_based_on = aggregate_field
	doc.insert(ignore_permissions=True)
	return doc.name


def _ensure_dashboard_chart(chart_name, document_type, group_by_field, parent_document_type=None):
	existing = frappe.db.get_value("Dashboard Chart", {"chart_name": chart_name, "module": "Payroll Bulk"}, "name")
	if existing:
		return existing

	doc = frappe.new_doc("Dashboard Chart")
	doc.update(
		{
			"chart_name": chart_name,
			"chart_type": "Group By",
			"document_type": document_type,
			"group_by_based_on": group_by_field,
			"group_by_type": "Count",
			"is_public": 1,
			"is_standard": 1,
			"module": "Payroll Bulk",
			"type": "Donut",
			"filters_json": "[]",
		}
	)
	if parent_document_type:
		doc.parent_document_type = parent_document_type
	doc.insert(ignore_permissions=True)
	return doc.name


def _sync_payroll_bulk_workspace(card_names=None, chart_name=None, payment_chart_name=None, row_chart_name=None):
	if not frappe.db.exists("Workspace", "Payroll Bulk"):
		return

	card_names = card_names or []
	card_labels = ["Open Batches", "Failed Rows", "Pending Payment", "Month Net Pay"]
	if len(card_names) < 4:
		card_names = [
			frappe.db.get_value("Number Card", {"label": label, "module": "Payroll Bulk"}, "name") or label
			for label in card_labels
		]
	if not chart_name:
		chart_name = frappe.db.get_value("Dashboard Chart", {"chart_name": "PB Batch Status"}, "name") or "PB Batch Status"
	if not payment_chart_name:
		payment_chart_name = frappe.db.get_value("Dashboard Chart", {"chart_name": "PB Payment Overview"}, "name") or "PB Payment Overview"
	if not row_chart_name:
		row_chart_name = frappe.db.get_value("Dashboard Chart", {"chart_name": "PB Employee Row Status"}, "name") or "PB Employee Row Status"

	content = [
		{"id": "pb_hdr", "type": "header", "data": {"text": "<span class=\"h4\"><b>Payroll Bulk</b></span>", "col": 12}},
		{"id": "pb_desc", "type": "paragraph", "data": {"text": "Dashboard, batches, payments, reconciliation, and reports.", "col": 12}},
		{"id": "pb_nc1", "type": "number_card", "data": {"number_card_name": card_names[0], "col": 3}},
		{"id": "pb_nc2", "type": "number_card", "data": {"number_card_name": card_names[1], "col": 3}},
		{"id": "pb_nc3", "type": "number_card", "data": {"number_card_name": card_names[2], "col": 3}},
		{"id": "pb_nc4", "type": "number_card", "data": {"number_card_name": card_names[3], "col": 3}},
		{"id": "pb_chart", "type": "chart", "data": {"chart_name": chart_name, "col": 4}},
		{"id": "pb_chart2", "type": "chart", "data": {"chart_name": payment_chart_name, "col": 4}},
		{"id": "pb_chart3", "type": "chart", "data": {"chart_name": row_chart_name, "col": 4}},
		{"id": "pb_sp", "type": "spacer", "data": {"col": 12}},
		{"id": "pb_sc1", "type": "shortcut", "data": {"shortcut_name": "Bulk Salary Creation", "col": 3}},
		{"id": "pb_sc2", "type": "shortcut", "data": {"shortcut_name": "Employee Rows", "col": 3}},
		{"id": "pb_sc3", "type": "shortcut", "data": {"shortcut_name": "Payroll Bulk Settings", "col": 3}},
		{"id": "pb_sc4", "type": "shortcut", "data": {"shortcut_name": "Daily Employee Checkin", "col": 3}},
		{"id": "pb_ops_hdr", "type": "header", "data": {"text": "<span class=\"h6\"><b>Operations</b></span>", "col": 12}},
	]
	col = 0
	for label, _, _, color in PB_OPERATIONS_SHORTCUTS:
		content.append(
			{
				"id": f"pb_ops_{col}",
				"type": "shortcut",
				"data": {"shortcut_name": label, "col": 3},
			}
		)
		col += 1
	content.append({"id": "pb_setup_hdr", "type": "header", "data": {"text": "<span class=\"h6\"><b>Setup</b></span>", "col": 12}})
	for idx, (label, _, _, _) in enumerate(PB_SETUP_SHORTCUTS):
		content.append(
			{
				"id": f"pb_setup_{idx}",
				"type": "shortcut",
				"data": {"shortcut_name": label, "col": 3},
			}
		)
	content.append({"id": "pb_rep_hdr", "type": "header", "data": {"text": "<span class=\"h6\"><b>Reports</b></span>", "col": 12}})
	for idx, (label, _, _, _) in enumerate(PB_REPORT_SHORTCUTS):
		content.append(
			{
				"id": f"pb_rep_{idx}",
				"type": "shortcut",
				"data": {"shortcut_name": label, "col": 4 if idx % 3 else 4},
			}
		)
	content.extend([
		{"id": "pb_lnk", "type": "header", "data": {"text": "<span class=\"h6\">Browse Links</span>", "col": 12}},
		{"id": "pb_card1", "type": "card", "data": {"card_name": "Operations", "col": 4}},
		{"id": "pb_card2", "type": "card", "data": {"card_name": "Setup", "col": 4}},
		{"id": "pb_card3", "type": "card", "data": {"card_name": "Reports", "col": 4}},
	])

	ws = frappe.get_doc("Workspace", "Payroll Bulk")
	ws.content = json.dumps(content)
	ws.number_cards = []
	for card_name, label in zip(card_names, card_labels):
		ws.append("number_cards", {"number_card_name": card_name, "label": label})
	ws.charts = []
	ws.append("charts", {"chart_name": chart_name, "label": "Batch Status"})
	ws.append("charts", {"chart_name": payment_chart_name, "label": "Payment Overview"})
	ws.append("charts", {"chart_name": row_chart_name, "label": "Row Status"})

	existing = {(link.link_to, link.link_type) for link in ws.links}
	for page_name, page_label in PB_PAGES:
		key = (page_name, "Page")
		if key in existing:
			continue
		ws.append(
			"links",
			{
				"label": page_label,
				"link_to": page_name,
				"link_type": "Page",
				"type": "Link",
			},
		)
	for report_name, ref_doctype in PB_REPORTS:
		key = (report_name, "Report")
		if key in existing:
			for link in ws.links:
				if link.link_to == report_name and link.link_type == "Report":
					link.is_query_report = 1
					link.report_ref_doctype = ref_doctype
			continue
		ws.append(
			"links",
			{
				"label": report_name,
				"link_to": report_name,
				"link_type": "Report",
				"report_ref_doctype": ref_doctype,
				"type": "Link",
				"is_query_report": 1,
			},
		)

	def append_card_links(card_label, links):
		if not any(link.type == "Card Break" and link.label == card_label for link in ws.links):
			return
		for label, link_to, link_type in links:
			if link_type == "DocType" and not frappe.db.exists("DocType", link_to):
				continue
			if any(item.link_to == link_to and item.link_type == link_type for item in ws.links):
				continue
			ws.append(
				"links",
				{
					"label": label,
					"link_to": link_to,
					"link_type": link_type,
					"type": "Link",
				},
			)

	append_card_links("Operations", PB_OPERATIONS_LINKS)
	append_card_links("Setup", PB_SETUP_LINKS)

	keep_shortcuts = [row for row in ws.shortcuts if row.type not in ("Report", "Page", "DocType")]
	ws.shortcuts = []
	for row in keep_shortcuts:
		ws.append("shortcuts", row.as_dict())
	for page_name, page_label in PB_PAGES:
		ws.append(
			"shortcuts",
			{
				"label": page_label,
				"link_to": page_name,
				"type": "Page",
				"color": "Blue",
			},
		)
	for label, report_name, ref_doctype, color in PB_REPORT_SHORTCUTS:
		ws.append(
			"shortcuts",
			{
				"label": label,
				"link_to": report_name,
				"type": "Report",
				"report_ref_doctype": ref_doctype,
				"color": color,
			},
		)
	for label, link_to, link_type, color in PB_OPERATIONS_SHORTCUTS:
		if link_type == "DocType" and not frappe.db.exists("DocType", link_to):
			continue
		ws.append(
			"shortcuts",
			{
				"label": label,
				"link_to": link_to,
				"type": link_type,
				"color": color,
			},
		)
	for label, link_to, link_type, color in PB_SETUP_SHORTCUTS:
		if link_type == "DocType" and not frappe.db.exists("DocType", link_to):
			continue
		ws.append(
			"shortcuts",
			{
				"label": label,
				"link_to": link_to,
				"type": link_type,
				"color": color,
			},
		)

	ws.save(ignore_permissions=True)
	_sync_payroll_bulk_sidebar()


def _sync_payroll_bulk_sidebar():
	if not frappe.db.exists("Workspace Sidebar", "Payroll Bulk"):
		return

	sb = frappe.get_doc("Workspace Sidebar", "Payroll Bulk")
	existing = {item.label for item in sb.items}
	for page_name, page_label in PB_PAGES:
		if page_label in existing:
			continue
		sb.append(
			"items",
			{
				"label": page_label,
				"link_to": page_name,
				"link_type": "Page",
				"type": "Link",
				"child": 1,
				"indent": 0,
			},
		)
	for report_name, _ref in PB_REPORTS:
		if report_name in existing:
			continue
		sb.append(
			"items",
			{
				"label": report_name,
				"link_to": report_name,
				"link_type": "Report",
				"type": "Link",
				"child": 1,
				"indent": 0,
				"open_in_new_tab": 1,
			},
		)

	if "Operations ERP" not in existing:
		sb.append(
			"items",
			{
				"label": "Operations ERP",
				"link_type": "DocType",
				"type": "Section Break",
				"child": 0,
				"indent": 1,
				"keep_closed": 1,
			},
		)
		existing.add("Operations ERP")

	for label, link_to, link_type in PB_OPERATIONS_LINKS:
		if label in existing:
			continue
		if not frappe.db.exists("DocType", link_to):
			continue
		sb.append(
			"items",
			{
				"label": label,
				"link_to": link_to,
				"link_type": link_type,
				"type": "Link",
				"child": 1,
				"indent": 0,
			},
		)

	if "Setup ERP" not in existing:
		sb.append(
			"items",
			{
				"label": "Setup ERP",
				"link_type": "DocType",
				"type": "Section Break",
				"child": 0,
				"indent": 1,
				"keep_closed": 1,
			},
		)
		existing.add("Setup ERP")

	for label, link_to, link_type in PB_SETUP_LINKS:
		if label in existing:
			continue
		if not frappe.db.exists("DocType", link_to):
			continue
		sb.append(
			"items",
			{
				"label": label,
				"link_to": link_to,
				"link_type": link_type,
				"type": "Link",
				"child": 1,
				"indent": 0,
			},
		)
	sb.save(ignore_permissions=True)
