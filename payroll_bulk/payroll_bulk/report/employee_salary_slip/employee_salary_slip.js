frappe.query_reports["Employee Salary Slip"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "salary_slip", label: __("Salary Slip"), fieldtype: "Link", options: "Salary Slip" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldtype === "Currency" && data && data[column.fieldname] != null) {
			return frappe.format(data[column.fieldname], { fieldtype: "Currency", precision: 0 });
		}
		if (column.fieldname === "print_action" && data.salary_slip) {
			const slip = encodeURIComponent(data.salary_slip);
			return `<button type="button" class="btn btn-xs btn-default" onclick="pb_print_salary_slip('${slip}')">${__("Print")}</button>`;
		}
		return value;
	},
	onload(report) {
		const batch = frappe.route_options?.batch;
		const slip = frappe.route_options?.salary_slip;
		if (batch && report.set_filter_value) report.set_filter_value("batch", batch);
		if (slip && report.set_filter_value) report.set_filter_value("salary_slip", slip);
	},
};

window.pb_print_salary_slip = (salary_slip) => {
	if (!salary_slip) return;
	const url = frappe.urllib.get_full_url(
		`/printview?doctype=${encodeURIComponent("Salary Slip")}&name=${encodeURIComponent(salary_slip)}&trigger_print=1`,
	);
	window.open(url, "_blank");
};
