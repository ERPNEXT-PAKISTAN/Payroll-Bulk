from frappe import _


def get_data():
	return [
		{
			"module_name": "Payroll Bulk",
			"category": "Modules",
			"label": _("Payroll Bulk"),
			"color": "blue",
			"icon": "octicon octicon-briefcase",
			"type": "module",
			"description": _("Bulk payroll batches, processing, settings, and reports"),
		}
	]
