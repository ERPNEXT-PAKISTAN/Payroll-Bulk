frappe.query_reports["Bulk Salary Register"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldtype === "Currency" && data && data[column.fieldname] != null) {
			return frappe.format(data[column.fieldname], { fieldtype: "Currency", precision: 0 });
		}
		if (column.fieldname === "employee_name" && ["department", "subtotal", "grand_total"].includes(data.row_type)) {
			return `<b>${frappe.utils.escape_html(String(value || ""))}</b>`;
		}
		return value;
	},
	onload(report) {
		const batch = frappe.route_options?.batch;
		if (batch && report.set_filter_value) report.set_filter_value("batch", batch);
		pb_bind_register_print_button(report);
	},
};
