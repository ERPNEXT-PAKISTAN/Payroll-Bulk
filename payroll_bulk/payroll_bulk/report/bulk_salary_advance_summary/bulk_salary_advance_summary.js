frappe.query_reports["Bulk Salary Advance Summary"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
		{ fieldname: "only_with_advance", label: __("Only With Advance"), fieldtype: "Check", default: 1 },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldtype === "Currency" && data && data[column.fieldname] != null) {
			return frappe.format(data[column.fieldname], { fieldtype: "Currency", precision: 0 });
		}
		return value;
	},
};
