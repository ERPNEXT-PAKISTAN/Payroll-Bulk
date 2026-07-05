// Shared helpers for Payroll Bulk query reports.

const PB_SALARY_SLIP_PRINT_FORMAT = "Payroll Bulk Salary Slip";
const PB_REGISTER_PDF_METHOD =
	"payroll_bulk.payroll_bulk.report.bulk_salary_register.bulk_salary_register.download_register_pdf";

window.pb_salary_slip_print_url = (salary_slip, { trigger_print = false } = {}) => {
	const params = new URLSearchParams({
		doctype: "Salary Slip",
		name: salary_slip,
		format: PB_SALARY_SLIP_PRINT_FORMAT,
		no_letterhead: "1",
	});
	if (trigger_print) params.set("trigger_print", "1");
	return frappe.urllib.get_full_url(`/printview?${params.toString()}`);
};

window.pb_salary_slip_pdf_url = (salary_slip) => {
	const params = new URLSearchParams({
		doctype: "Salary Slip",
		name: salary_slip,
		format: PB_SALARY_SLIP_PRINT_FORMAT,
		no_letterhead: "1",
	});
	return frappe.urllib.get_full_url(
		`/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`
	);
};

window.pb_open_salary_slip_print = (salary_slip) => {
	if (!salary_slip) {
		frappe.msgprint(__("Select a Salary Slip first"));
		return;
	}
	window.open(pb_salary_slip_print_url(salary_slip, { trigger_print: true }), "_blank");
};

window.pb_download_salary_slip_pdf = (salary_slip) => {
	if (!salary_slip) {
		frappe.msgprint(__("Select a Salary Slip first"));
		return;
	}
	window.open(pb_salary_slip_pdf_url(salary_slip), "_blank");
};

window.pb_register_pdf_url = (filters) => {
	const params = new URLSearchParams({
		filters: JSON.stringify(filters || {}),
	});
	return frappe.urllib.get_full_url(`/api/method/${PB_REGISTER_PDF_METHOD}?${params.toString()}`);
};

window.pb_print_register_report = (report) => {
	if (!report?.data?.length) {
		frappe.msgprint(__("Run the report first"));
		return;
	}
	frappe.call({
		method: "payroll_bulk.payroll_bulk.report.bulk_salary_register.bulk_salary_register.get_register_print_html",
		args: { filters: report.get_filter_values() },
		freeze: true,
		freeze_message: __("Preparing print..."),
		callback(response) {
			const html = response.message;
			if (!html) {
				frappe.msgprint(__("Could not prepare register print"));
				return;
			}
			const win = window.open("", "_blank");
			if (!win) {
				frappe.msgprint(__("Allow pop-ups to print the register"));
				return;
			}
			win.document.open();
			win.document.write(html);
			win.document.close();
		},
	});
};

window.pb_download_register_pdf = (report) => {
	if (!report?.data?.length) {
		frappe.msgprint(__("Run the report first"));
		return;
	}
	window.open(pb_register_pdf_url(report.get_filter_values()), "_blank");
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
	const rows = (report.data || []).filter((row) => row.row_type === "data" || !row.row_type);
	return rows.length ? rows[0].salary_slip : "";
};

window.pb_bind_salary_slip_print_button = (report) => {
	if (report._pb_slip_print_btn) return;
	report._pb_slip_print_btn = report.page.add_inner_button(__("Print Salary Slip"), () => {
		pb_open_salary_slip_print(pb_get_report_salary_slip(report));
	});
	report._pb_slip_pdf_btn = report.page.add_inner_button(__("Download PDF"), () => {
		pb_download_salary_slip_pdf(pb_get_report_salary_slip(report));
	});
	pb_update_salary_slip_print_button(report);
};

window.pb_update_salary_slip_print_button = (report) => {
	if (!report._pb_slip_print_btn) return;
	const slip = pb_get_report_salary_slip(report);
	const visible = !!slip;
	report._pb_slip_print_btn.toggle(visible);
	if (report._pb_slip_pdf_btn) report._pb_slip_pdf_btn.toggle(visible);
};

window.pb_bind_register_print_button = (report) => {
	if (report._pb_register_print_btn) return;
	report._pb_register_print_btn = report.page.add_inner_button(__("Print Register"), () => {
		pb_print_register_report(report);
	});
	report._pb_register_pdf_btn = report.page.add_inner_button(__("Download PDF"), () => {
		pb_download_register_pdf(report);
	});
};
