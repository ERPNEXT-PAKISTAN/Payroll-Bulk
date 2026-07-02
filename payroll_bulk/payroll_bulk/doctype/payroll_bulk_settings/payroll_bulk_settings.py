from frappe.model.document import Document


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
