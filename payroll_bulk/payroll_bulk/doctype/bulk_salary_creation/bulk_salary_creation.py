import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class BulkSalaryCreation(Document):
	def validate(self):
		if self.calculation_mode == "Per Piece Qty":
			self.calculation_mode = "Per Piece or Per Hour"
		self._remove_blank_employee_rows()
		self._remove_blank_component_rows()
		if not self.get("employees"):
			frappe.throw(_("Add at least one employee before saving."))
		self._validate_period_consistency()
		self._validate_linked_documents_match_period()

	def before_save(self):
		self._remove_blank_employee_rows()
		self._remove_blank_component_rows()
		from payroll_bulk.source_recalc import recalculate_bulk_salary_source

		recalculate_bulk_salary_source(self)

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

	def _validate_period_consistency(self):
		if not self.start_date or not self.end_date:
			return
		start = getdate(self.start_date)
		end = getdate(self.end_date)
		posting = getdate(self.posting_date) if self.posting_date else end
		if start > end:
			frappe.throw(_("Start Date cannot be after End Date."))
		if (start.year, start.month) != (end.year, end.month):
			frappe.throw(
				_("Start Date and End Date must be in the same calendar month. Got {0} to {1}.").format(
					self.start_date, self.end_date
				)
			)
		if posting < start or posting > end:
			frappe.throw(_("Posting Date must fall within the salary period ({0} to {1}).").format(
				self.start_date, self.end_date
			))
		if (posting.year, posting.month) != (start.year, start.month):
			frappe.throw(
				_("Posting Date must be in the same month as the salary period ({0}).").format(
					self.start_date[:7]
				)
			)
		if self.month:
			expected = getdate(self.start_date).strftime("%B")
			if self.month != expected:
				frappe.throw(
					_("Month field ({0}) does not match Start Date month ({1}).").format(
						self.month, expected
					)
				)

	def _validate_linked_documents_match_period(self):
		for row in self.get("employees") or []:
			if not row.salary_slip:
				continue
			from payroll_bulk.api import validate_salary_slip_batch_link

			validate_salary_slip_batch_link(
				row.salary_slip,
				self.name,
				self.start_date,
				self.end_date,
				employee=row.employee,
			)
