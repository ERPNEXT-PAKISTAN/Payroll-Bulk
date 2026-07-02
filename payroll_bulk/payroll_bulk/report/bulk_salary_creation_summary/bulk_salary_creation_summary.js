frappe.query_reports["Bulk Salary Creation Summary"] = {
	filters: [
		{fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company"},
		{fieldname: "status", label: __("Status"), fieldtype: "Select", options: "\nDraft\nReady\nProcessing\nPartially Processed\nCompleted\nCompleted With Errors\nCancelled"},
		{fieldname: "from_date", label: __("From Date"), fieldtype: "Date"},
		{fieldname: "to_date", label: __("To Date"), fieldtype: "Date"},
	],
};
