from frappe.model.document import Document


class BulkSalaryCreation(Document):
	def validate(self):
		if self.calculation_mode == "Per Piece Qty":
			self.calculation_mode = "Per Piece or Per Hour"
