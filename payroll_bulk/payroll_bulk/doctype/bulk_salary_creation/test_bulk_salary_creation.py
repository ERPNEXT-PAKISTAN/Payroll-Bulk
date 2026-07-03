from __future__ import annotations

import frappe
from frappe.utils import get_first_day, get_last_day, nowdate

from erpnext.setup.doctype.employee.test_employee import make_employee

from hrms.payroll.doctype.salary_structure.test_salary_structure import make_salary_structure
from hrms.tests.utils import HRMSTestSuite

from payroll_bulk.api import create_bulk_accrual_journal_entry, create_bulk_salary_slip


class TestBulkSalaryCreation(HRMSTestSuite):
	def setUp(self):
		self.company = "_Test Company"
		self.employee = make_employee("bulk_salary_test@example.com", company=self.company)
		self.salary_structure = make_salary_structure(
			"Bulk Salary Test Structure",
			"Monthly",
			employee=self.employee,
			company=self.company,
			from_date=nowdate(),
		)
		self.start_date = get_first_day(nowdate())
		self.end_date = get_last_day(nowdate())
		self.batch = self._make_batch()

	def _make_batch(self):
		batch = frappe.get_doc(
			{
				"doctype": "Bulk Salary Creation",
				"company": self.company,
				"payroll_frequency": "Monthly",
				"start_date": self.start_date,
				"end_date": self.end_date,
				"posting_date": self.end_date,
				"calculation_mode": "Manual",
				"employees": [
					{
						"employee": self.employee,
						"employee_name": frappe.db.get_value("Employee", self.employee, "employee_name"),
						"ctc": 30000,
						"status": "Pending",
					}
				],
			}
		)
		batch.insert()
		return batch

	def test_create_bulk_salary_slip(self):
		row_name = self.batch.employees[0].name
		result = create_bulk_salary_slip(
			batch_name=self.batch.name,
			row_name=row_name,
			company=self.company,
			payroll_frequency="Monthly",
			start_date=self.start_date,
			end_date=self.end_date,
			posting_date=self.end_date,
			ctc=30000,
			submit_slip=0,
		)

		self.assertTrue(result.get("name"))
		self.assertEqual(frappe.db.get_value("Salary Slip", result["name"], "employee"), self.employee)
		self.assertEqual(
			frappe.db.get_value("Bulk Salary Creation Employee", row_name, "salary_slip"),
			result["name"],
		)

	def test_create_bulk_accrual_journal_entry(self):
		row_name = self.batch.employees[0].name
		slip_result = create_bulk_salary_slip(
			batch_name=self.batch.name,
			row_name=row_name,
			company=self.company,
			payroll_frequency="Monthly",
			start_date=self.start_date,
			end_date=self.end_date,
			posting_date=self.end_date,
			ctc=30000,
			submit_slip=1,
		)
		self.assertEqual(slip_result.get("docstatus"), 1)

		accrual = create_bulk_accrual_journal_entry(self.batch.name)
		self.assertTrue(accrual.get("journal_entry"))
		self.assertTrue(accrual.get("created"))
		self.assertEqual(
			frappe.db.get_value("Bulk Salary Creation", self.batch.name, "accrual_journal_entry"),
			accrual["journal_entry"],
		)
