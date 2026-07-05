frappe.query_reports["Bulk Salary Report"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company", reqd: 1 },
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
		{
			fieldname: "payroll_frequency",
			label: __("Payroll Frequency"),
			fieldtype: "Select",
			options: "\nMonthly\nBimonthly\nFortnightly\nWeekly\nDaily",
		},
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{
			fieldname: "docstatus",
			label: __("Slip Status"),
			fieldtype: "Select",
			options: "\nDraft\nSubmitted\nCancelled",
			default: "Submitted",
		},
	],
	formatter: pb_report_currency_formatter,
	onload(report) {
		const batch = frappe.route_options?.batch;
		if (batch && report.set_filter_value) report.set_filter_value("batch", batch);
	},
};

function pb_report_currency_formatter(value, row, column, data, default_formatter) {
	value = default_formatter(value, row, column, data);
	if (column.fieldtype === "Currency" && data && data[column.fieldname] != null) {
		return frappe.format(data[column.fieldname], { fieldtype: "Currency", precision: 0 });
	}
	return value;
}
