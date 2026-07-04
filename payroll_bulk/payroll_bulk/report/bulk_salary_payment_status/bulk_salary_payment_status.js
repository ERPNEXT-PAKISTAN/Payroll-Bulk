frappe.query_reports["Bulk Salary Payment Status"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{
			fieldname: "payment_status",
			label: __("Payment Status"),
			fieldtype: "Select",
			options: "\nNot Paid\nPaid\nAll",
			default: "All",
		},
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "payment_status") {
			const cls = data.payment_status === "Paid" ? "green" : "orange";
			return `<span class="indicator-pill ${cls}">${frappe.utils.escape_html(data.payment_status || "")}</span>`;
		}
		return value;
	},
	onload(report) {
		const batch = frappe.route_options?.batch;
		if (batch && report.set_filter_value) {
			report.set_filter_value("batch", batch);
		}
	},
};
