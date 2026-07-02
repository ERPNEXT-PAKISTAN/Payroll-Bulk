from frappe.model.document import Document
import frappe


class PayrollBulkSettings(Document):
	def validate(self):
		if self.default_calculation_mode == "Per Piece Qty":
			self.default_calculation_mode = "Per Piece or Per Hour"

		if not self.enable_filter_fetch:
			self.show_department_filter = 0
			self.show_branch_filter = 0
			self.show_designation_filter = 0

		if not self.show_employee_filter:
			self.enable_manual_add = 0

		seen = set()
		deduped = []
		for row in self.get("component_rules") or []:
			if row.salary_component and not row.component_type:
				row.component_type = frappe.db.get_value("Salary Component", row.salary_component, "type") or row.component_type
			key = (row.salary_component, row.component_type)
			if row.salary_component and key not in seen:
				seen.add(key)
				deduped.append(row)

		if len(deduped) != len(self.get("component_rules") or []):
			self.set("component_rules", deduped)
