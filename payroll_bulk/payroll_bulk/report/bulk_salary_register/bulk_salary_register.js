frappe.query_reports["Bulk Salary Register"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
	],
	formatter: pb_report_currency_formatter,
	onload(report) {
		const batch = frappe.route_options?.batch;
		if (batch && report.set_filter_value) report.set_filter_value("batch", batch);
		pb_bind_register_print_button(report);
	},
};
