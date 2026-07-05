// Shared helpers for Payroll Bulk query reports.

window.pb_open_salary_slip_print = (salary_slip) => {
	if (!salary_slip) {
		frappe.msgprint(__("Select a Salary Slip first"));
		return;
	}
	const url = frappe.urllib.get_full_url(
		`/printview?doctype=Salary Slip&name=${encodeURIComponent(salary_slip)}&trigger_print=1`,
	);
	window.open(url, "_blank");
};

window.pb_print_query_report = (report) => {
	if (!report?.data?.length) {
		frappe.msgprint(__("Run the report first"));
		return;
	}
	frappe.query_report.print_report();
};

window.pb_report_currency_formatter = (value, row, column, data, default_formatter) => {
	value = default_formatter(value, row, column, data);
	if (column.fieldtype === "Currency" && data && data[column.fieldname] != null) {
		return frappe.format(data[column.fieldname], { fieldtype: "Currency", precision: 0 });
	}
	return value;
};

window.pb_get_report_salary_slip = (report) => {
	const from_filter = report.get_filter_value?.("salary_slip");
	if (from_filter) return from_filter;
	const rows = report.data || [];
	return rows.length ? rows[0].salary_slip : "";
};

window.pb_bind_salary_slip_print_button = (report) => {
	if (report._pb_slip_print_btn) return;
	report._pb_slip_print_btn = report.page.add_inner_button(__("Print Salary Slip"), () => {
		const slip = pb_get_report_salary_slip(report);
		pb_open_salary_slip_print(slip);
	});
	pb_update_salary_slip_print_button(report);
};

window.pb_update_salary_slip_print_button = (report) => {
	if (!report._pb_slip_print_btn) return;
	const slip = pb_get_report_salary_slip(report);
	report._pb_slip_print_btn.toggle(!!slip);
};

window.pb_bind_register_print_button = (report) => {
	if (report._pb_register_print_btn) return;
	report._pb_register_print_btn = report.page.add_inner_button(__("Print Register"), () => {
		pb_print_query_report(report);
	});
};
