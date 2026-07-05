frappe.query_reports["Employee Salary Slip"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "salary_slip", label: __("Salary Slip"), fieldtype: "Link", options: "Salary Slip" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date" },
	],
	formatter: pb_report_currency_formatter,
	onload(report) {
		const batch = frappe.route_options?.batch;
		const slip = frappe.route_options?.salary_slip;
		if (batch && report.set_filter_value) report.set_filter_value("batch", batch);
		if (slip && report.set_filter_value) report.set_filter_value("salary_slip", slip);
		pb_bind_salary_slip_print_button(report);
	},
	refresh(report) {
		pb_update_salary_slip_print_button(report);
		if (!report.get_filter_value("salary_slip") && report.data?.length) {
			const slip = report.data[0].salary_slip;
			if (slip) report.set_filter_value("salary_slip", slip);
		}
	},
};
