frappe.query_reports["Bulk Salary Component Detail"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{
			fieldname: "component_type",
			label: __("Type"),
			fieldtype: "Select",
			options: "\nAll\nEarning\nDeduction",
			default: "All",
		},
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldtype === "Currency" && data && data[column.fieldname] != null) {
			return frappe.format(data[column.fieldname], { fieldtype: "Currency", precision: 0 });
		}
		if (column.fieldname === "component_type") {
			const cls = data.component_type === "Earning" ? "green" : "red";
			return `<span class="indicator-pill ${cls}">${frappe.utils.escape_html(data.component_type || "")}</span>`;
		}
		return value;
	},
};
