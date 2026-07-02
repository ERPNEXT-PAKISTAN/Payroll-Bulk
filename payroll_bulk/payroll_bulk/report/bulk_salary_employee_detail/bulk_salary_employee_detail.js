frappe.query_reports["Bulk Salary Employee Detail"] = {
	filters: [
		{fieldname: "batch", label: __("Batch"), fieldtype: "Link", options: "Bulk Salary Creation"},
		{fieldname: "employee", label: __("Employee"), fieldtype: "Link", options: "Employee"},
		{fieldname: "row_status", label: __("Row Status"), fieldtype: "Select", options: "\nPending\nValidated\nSlip Created\nSubmitted\nPayment Created\nCompleted\nCancelled\nFailed\nSkipped"},
		{fieldname: "slip_status", label: __("Slip Status"), fieldtype: "Select", options: "\nDraft\nSubmitted\nCancelled"},
	],
};
