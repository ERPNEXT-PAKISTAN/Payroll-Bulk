frappe.query_reports["Bulk Salary Employee Detail"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company" },
		{ fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation" },
		{ fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee" },
		{
			fieldname: "row_status",
			label: __("Row Status"),
			fieldtype: "Select",
			options: "\nPending\nValidated\nSlip Created\nSubmitted\nPayment Created\nCompleted\nCancelled\nFailed\nSkipped",
		},
		{
			fieldname: "slip_status",
			label: __("Slip Status"),
			fieldtype: "Select",
			options: "\nDraft\nSubmitted\nCancelled",
		},
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "status") {
			const cls = data.status === "Failed" ? "red" : data.status === "Completed" ? "green" : "blue";
			return `<span class="indicator-pill ${cls}">${frappe.utils.escape_html(data.status || "")}</span>`;
		}
		if (column.fieldname === "payment_status") {
			const cls = data.payment_status === "Paid" ? "green" : "orange";
			return `<span class="indicator-pill ${cls}">${frappe.utils.escape_html(data.payment_status || "")}</span>`;
		}
		if (column.fieldname === "salary_slip_status") {
			const status = (data.salary_slip_status || "").toLowerCase();
			if (status === "submitted") return `<span class="indicator-pill green">${value}</span>`;
			if (status === "draft") return `<span class="indicator-pill orange">${value}</span>`;
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
