frappe.query_reports["Bulk Salary Slip Reconciliation"] = {
	filters: [
		{
			fieldname: "batch",
			label: __("Batch"),
			fieldtype: "Link",
			options: "Bulk Salary Creation",
			reqd: 1,
		},
		{
			fieldname: "show_matched",
			label: __("Show Matched Rows"),
			fieldtype: "Check",
			default: 0,
		},
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldtype === "Currency" && data && data[column.fieldname] != null) {
			return frappe.format(data[column.fieldname], { fieldtype: "Currency", precision: 0 });
		}
		if (column.fieldname === "match_label") {
			if (data.match) {
				return `<span class="indicator-pill green">${__("Matched")}</span>`;
			}
			return `<span class="indicator-pill red">${__("Issue")}</span>`;
		}
		if (column.fieldname === "issue" && data.issue) {
			const issue_map = {
				matched: "green",
				mismatch: "orange",
				missing_slip: "red",
				no_row: "purple",
				other: "grey",
			};
			const cls = issue_map[data.issue_type] || "orange";
			return `<span class="indicator-pill ${cls}">${frappe.utils.escape_html(data.issue)}</span>`;
		}
		if (column.fieldname === "net_diff" || column.fieldname === "gross_diff") {
			const diff = Math.abs(parseFloat(data[column.fieldname] || 0));
			if (diff > 1) {
				return `<span style="color:#dc2626;font-weight:600">${value}</span>`;
			}
			return `<span style="color:#16a34a">${value}</span>`;
		}
		if (column.fieldname === "batch_net" || column.fieldname === "batch_gross") {
			return `<span style="color:#2563eb;font-weight:500">${value}</span>`;
		}
		if (column.fieldname === "slip_net" || column.fieldname === "slip_gross") {
			return `<span style="color:#7c3aed;font-weight:500">${value}</span>`;
		}
		if (column.fieldname === "salary_slip_status") {
			const status = (data.salary_slip_status || "").toLowerCase();
			if (status === "submitted") return `<span class="indicator-pill green">${value}</span>`;
			if (status === "draft") return `<span class="indicator-pill orange">${value}</span>`;
			if (status === "cancelled") return `<span class="indicator-pill red">${value}</span>`;
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
