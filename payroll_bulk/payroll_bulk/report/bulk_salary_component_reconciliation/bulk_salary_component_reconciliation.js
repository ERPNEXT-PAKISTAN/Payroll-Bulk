frappe.query_reports["Bulk Salary Component Reconciliation"] = {
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
				batch_only: "blue",
				slip_only: "purple",
				ads_only: "cyan",
				missing_slip: "red",
				other: "grey",
			};
			const cls = issue_map[data.issue_type] || "orange";
			return `<span class="indicator-pill ${cls}">${frappe.utils.escape_html(data.issue)}</span>`;
		}
		if (["batch_slip_diff", "batch_ads_diff", "slip_ads_diff"].includes(column.fieldname)) {
			const diff = Math.abs(parseFloat(data[column.fieldname] || 0));
			if (diff > 1) {
				return `<span style="color:#dc2626;font-weight:600">${value}</span>`;
			}
			return `<span style="color:#16a34a">${value}</span>`;
		}
		if (column.fieldname === "batch_amount") {
			return `<span style="color:#2563eb;font-weight:500">${value}</span>`;
		}
		if (column.fieldname === "slip_amount") {
			return `<span style="color:#7c3aed;font-weight:500">${value}</span>`;
		}
		if (column.fieldname === "ads_amount") {
			return `<span style="color:#0891b2;font-weight:500">${value}</span>`;
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
