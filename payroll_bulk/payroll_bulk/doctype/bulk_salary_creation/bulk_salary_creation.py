import frappe
from frappe import _
from frappe.model.document import Document


class BulkSalaryCreation(Document):
	def validate(self):
		if self.calculation_mode == "Per Piece Qty":
			self.calculation_mode = "Per Piece or Per Hour"
		self._remove_blank_employee_rows()
		self._remove_blank_component_rows()
		if not self.get("employees"):
			frappe.throw(_("Add at least one employee before saving."))

	def before_save(self):
		self._remove_blank_employee_rows()
		self._remove_blank_component_rows()

	def _remove_blank_employee_rows(self):
		valid_rows = [row for row in (self.get("employees") or []) if row.get("employee")]
		self.set("employees", valid_rows)

	def _remove_blank_component_rows(self):
		valid_rows = [
			row
			for row in (self.get("component_entries") or [])
			if row.get("employee") and row.get("salary_component")
		]
		self.set("component_entries", valid_rows)
