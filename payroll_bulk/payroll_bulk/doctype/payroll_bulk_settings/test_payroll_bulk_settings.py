from frappe.tests import IntegrationTestCase

from payroll_bulk.api import _merge_component_rules


class IntegrationTestPayrollBulkSettings(IntegrationTestCase):
	def test_merge_component_rules_preserves_existing_and_adds_missing(self):
		existing = [
			{
				"salary_component": "Manual Bonus",
				"component_type": "Earning",
				"enabled": 0,
			},
			{
				"salary_component": "Manual Deduction",
				"component_type": "Deduction",
				"enabled": 1,
			},
		]
		inferred = [
			{
				"salary_component": "Manual Bonus",
				"component_type": "Earning",
				"enabled": 1,
			},
			{
				"salary_component": "Shift Allowance",
				"component_type": "Earning",
				"enabled": 1,
			},
		]

		merged = _merge_component_rules(existing, inferred)

		self.assertEqual(
			merged,
			[
				{
					"salary_component": "Manual Bonus",
					"component_type": "Earning",
					"enabled": 0,
				},
				{
					"salary_component": "Manual Deduction",
					"component_type": "Deduction",
					"enabled": 1,
				},
				{
					"salary_component": "Shift Allowance",
					"component_type": "Earning",
					"enabled": 1,
				},
			],
		)
