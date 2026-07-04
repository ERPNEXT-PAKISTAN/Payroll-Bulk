from __future__ import annotations

import erpnext
import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, getdate

from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
	get_accounting_dimensions,
)
from hrms.payroll.doctype.payroll_entry.payroll_entry import PayrollEntry
from hrms.utils.holiday_list import get_holiday_list_for_employee


def _resolve_default_holiday_list(company: str) -> str | None:
	holiday_list = frappe.db.get_value("Company", company, "default_holiday_list")
	if holiday_list:
		return holiday_list

	for employee in frappe.get_all(
		"Employee", filters={"company": company, "status": "Active"}, pluck="name", limit_page_length=200
	):
		existing = get_holiday_list_for_employee(employee, raise_exception=False)
		if existing:
			return existing if isinstance(existing, str) else existing.get("holiday_list")

	if frappe.db.exists("Holiday List", "Company Holidays"):
		return "Company Holidays"

	return frappe.db.get_value("Holiday List", {}, "name", order_by="creation desc")


def _ensure_holiday_list_for_employee(
	employee: str, as_on: str | None = None, assign_from: str | None = None
) -> str | None:
	"""Assign a company holiday list when the employee has none (avoids slip creation failures)."""
	check_dates = [getdate(as_on or frappe.utils.today())]
	if assign_from:
		check_dates.insert(0, getdate(assign_from))

	for check_date in check_dates:
		existing = get_holiday_list_for_employee(employee, as_on=check_date, raise_exception=False)
		if existing:
			return existing if isinstance(existing, str) else existing.get("holiday_list")

	company = frappe.db.get_value("Employee", employee, "company")
	holiday_list = _resolve_default_holiday_list(company)
	if not holiday_list:
		return None

	doc = frappe.get_doc(
		{
			"doctype": "Holiday List Assignment",
			"naming_series": "HR-HLA-.YYYY.-",
			"applicable_for": "Employee",
			"assigned_to": employee,
			"holiday_list": holiday_list,
			"from_date": min(check_dates),
		}
	)
	doc.insert(ignore_permissions=True)
	doc.submit()
	return holiday_list


def _validate_employee_holiday_list(employee: str, start_date: str, end_date: str | None = None):
	end_date = end_date or start_date
	if not _ensure_holiday_list_for_employee(employee, as_on=end_date, assign_from=start_date):
		frappe.throw(
			_(
				"No Holiday List is assigned for {0} for payroll period {1} to {2}. Assign one via Holiday List Assignment or set Default Holiday List on the company."
			).format(employee, frappe.utils.formatdate(start_date), frappe.utils.formatdate(end_date))
		)


def _validate_field(meta, fieldname: str) -> str:
	if not fieldname:
		return ""
	if not meta.get_field(fieldname):
		frappe.throw(f"Field {fieldname} does not exist in {meta.name}.")
	return fieldname


@frappe.whitelist()
def get_doctype_field_options(doctype_name: str):
	if not doctype_name:
		return []

	meta = frappe.get_meta(doctype_name)
	layout_fields = {
		"Section Break",
		"Column Break",
		"Tab Break",
		"HTML",
		"Button",
		"Fold",
		"Heading",
		"Image",
		"Table",
		"Table MultiSelect",
	}

	return [
		{
			"fieldname": df.fieldname,
			"label": df.label or df.fieldname,
			"fieldtype": df.fieldtype,
			"options": df.options,
		}
		for df in meta.fields
		if df.fieldname and df.fieldtype not in layout_fields
	]


def _is_excluded_structure_component(component_name: str | None, component_type: str | None) -> bool:
	value = (component_name or "").strip().lower()
	component_type = (component_type or "").strip()
	if not value:
		return True
	if component_type == "Earning" and any(
		token in value for token in ("basic", "base salary", "bs salary", "ctc", "gross")
	):
		return True
	if component_type == "Earning" and ("overtime" in value or value == "ot"):
		return True
	if component_type == "Deduction" and "advance" in value:
		return True
	return False


def _get_structure_names_for_company(company: str | None = None) -> list[str]:
	structure_names = frappe.get_all(
		"Salary Structure Assignment",
		filters={"docstatus": 1, **({"company": company} if company else {})},
		pluck="salary_structure",
		distinct=True,
		limit_page_length=1000,
	)
	structure_names = [name for name in structure_names if name]
	if structure_names:
		return structure_names

	meta = frappe.get_meta("Salary Structure")
	if company and meta.get_field("company"):
		structure_names = frappe.get_all(
			"Salary Structure",
			filters={"company": company, "docstatus": ["!=", 2]},
			pluck="name",
			limit_page_length=1000,
		)
		structure_names = [name for name in structure_names if name]
		if structure_names:
			return structure_names

	return frappe.get_all(
		"Salary Structure",
		filters={"docstatus": ["!=", 2]},
		pluck="name",
		limit_page_length=1000,
	)


def _get_component_rules_from_structures(company: str | None = None) -> list[dict]:
	component_map: dict[tuple[str, str], dict] = {}
	for structure_name in _get_structure_names_for_company(company):
		structure = frappe.get_cached_doc("Salary Structure", structure_name)
		for fieldname, component_type in (("earnings", "Earning"), ("deductions", "Deduction")):
			for row in structure.get(fieldname) or []:
				component = row.salary_component
				if _is_excluded_structure_component(component, component_type):
					continue
				key = (component_type, component)
				component_map.setdefault(
					key,
					{
						"salary_component": component,
						"component_type": component_type,
						"enabled": 1,
					},
				)

	return [
		component_map[key]
		for key in sorted(component_map, key=lambda item: (item[0], item[1]))
	]


def _merge_component_rules(existing_rules: list[dict] | None, inferred_rules: list[dict] | None) -> list[dict]:
	existing_rules = existing_rules or []
	inferred_rules = inferred_rules or []
	merged: list[dict] = []
	seen: set[tuple[str, str]] = set()

	def append_rule(rule: dict | None):
		if not rule:
			return
		component = (rule.get("salary_component") or "").strip()
		component_type = (rule.get("component_type") or "").strip()
		if not component:
			return
		if not component_type:
			component_type = frappe.db.get_value("Salary Component", component, "type") or "Earning"
		key = (component_type, component)
		if key in seen:
			return
		seen.add(key)
		merged.append(
			{
				"salary_component": component,
				"component_type": component_type,
				"enabled": cint(rule.get("enabled", 1)),
			}
		)

	for rule in existing_rules:
		append_rule(rule)
	for rule in inferred_rules:
		append_rule(rule)

	return merged


@frappe.whitelist()
def sync_payroll_bulk_component_rules(company: str | None = None):
	settings = frappe.get_single("Payroll Bulk Settings")
	company = company or settings.company or frappe.defaults.get_user_default("Company")
	rules = _merge_component_rules(settings.get("component_rules"), _get_component_rules_from_structures(company))
	settings.set("component_rules", [])
	for rule in rules:
		settings.append("component_rules", rule)
	settings.save(ignore_permissions=True)
	return {"count": len(rules), "company": company, "rules": rules}


@frappe.whitelist()
def get_bulk_source_values(
	employees: list[str] | str,
	source_doctype: str,
	employee_field: str,
	date_field: str,
	hours_field: str | None = None,
	qty_field: str | None = None,
	rate_field: str | None = None,
	start_date: str | None = None,
	end_date: str | None = None,
	batch_name: str | None = None,
):
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employees = [employee for employee in (employees or []) if employee]
	if not employees:
		return {}

	meta = frappe.get_meta(source_doctype)
	employee_field = _validate_field(meta, employee_field)
	date_field = _validate_field(meta, date_field)
	hours_field = _validate_field(meta, hours_field or "")
	qty_field = _validate_field(meta, qty_field or "")
	rate_field = _validate_field(meta, rate_field or "")

	fields = ["name", employee_field]
	if hours_field:
		fields.append(hours_field)
	if qty_field:
		fields.append(qty_field)
	if rate_field:
		fields.append(rate_field)
	has_bulk_payroll_field = bool(meta.get_field("bulk_payroll"))
	has_salary_slip_field = bool(meta.get_field("salary_slip"))
	if has_bulk_payroll_field:
		fields.append("bulk_payroll")
	if has_salary_slip_field:
		fields.append("salary_slip")

	filters = [[employee_field, "in", employees]]
	if start_date:
		filters.append([date_field, ">=", start_date])
	if end_date:
		filters.append([date_field, "<=", end_date])
	if meta.is_submittable:
		filters.append(["docstatus", "=", 1])

	rows = frappe.get_all(source_doctype, filters=filters, fields=fields, limit_page_length=5000)
	result = {employee: {"hours": 0.0, "qty": 0.0, "rate": 0.0, "row_names": []} for employee in employees}

	for row in rows:
		if has_salary_slip_field and row.get("salary_slip"):
			continue
		if has_bulk_payroll_field and row.get("bulk_payroll") and row.get("bulk_payroll") != batch_name:
			continue
		employee = row.get(employee_field)
		if employee not in result:
			continue
		hours = float(row.get(hours_field) or 0) if hours_field else 0.0
		qty = float(row.get(qty_field) or 0) if qty_field else 0.0
		rate = float(row.get(rate_field) or 0) if rate_field else 0.0
		item = result[employee]
		item["hours"] += hours
		item["qty"] += qty
		if qty and rate:
			total_amount = item.get("_amount", 0.0) + (qty * rate)
			item["_amount"] = total_amount
			item["rate"] = total_amount / item["qty"] if item["qty"] else 0.0
		elif rate:
			item["rate"] = rate
		item["row_names"].append(row.get("name"))

	for item in result.values():
		item.pop("_amount", None)

	return result


@frappe.whitelist()
def mark_bulk_source_rows(
	source_doctype: str,
	row_names: list[str] | str,
	batch_name: str | None = None,
	salary_slip: str | None = None,
):
	if isinstance(row_names, str):
		row_names = frappe.parse_json(row_names)
	row_names = [name for name in (row_names or []) if name]
	if not source_doctype or not row_names:
		return {"updated": 0}

	meta = frappe.get_meta(source_doctype)
	values = {}
	if batch_name and meta.get_field("bulk_payroll"):
		values["bulk_payroll"] = batch_name
	if salary_slip and meta.get_field("salary_slip"):
		values["salary_slip"] = salary_slip
	if not values:
		return {"updated": 0}

	updated = 0
	for row_name in row_names:
		if frappe.db.exists(source_doctype, row_name):
			frappe.db.set_value(source_doctype, row_name, values, update_modified=False)
			updated += 1
	return {"updated": updated}


@frappe.whitelist()
def get_bulk_attendance_values(
	employees: list[str] | str,
	source: str,
	start_date: str,
	end_date: str,
):
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employees = [employee for employee in (employees or []) if employee]
	if not employees:
		return {}

	result = {
		employee: {"attendance_days": 0.0, "absent_days": 0.0, "attendance_hours": 0.0, "payment_days": 0.0}
		for employee in employees
	}

	if source == "Attendance":
		rows = frappe.get_all(
			"Attendance",
			filters=[
				["employee", "in", employees],
				["attendance_date", ">=", start_date],
				["attendance_date", "<=", end_date],
				["docstatus", "!=", 2],
			],
			fields=["employee", "status", "working_hours"],
			limit_page_length=5000,
		)
		for row in rows:
			item = result.get(row.employee)
			if not item:
				continue
			status = row.status or ""
			if status in {"Present", "Work From Home", "On Leave"}:
				item["attendance_days"] += 1
				item["payment_days"] += 1
			elif status == "Half Day":
				item["attendance_days"] += 0.5
				item["payment_days"] += 0.5
				item["absent_days"] += 0.5
			elif status == "Absent":
				item["absent_days"] += 1
			item["attendance_hours"] += float(row.working_hours or 0)
		return result

	if source == "Employee Checkin":
		rows = frappe.get_all(
			"Employee Checkin",
			filters=[
				["employee", "in", employees],
				["time", ">=", f"{start_date} 00:00:00"],
				["time", "<=", f"{end_date} 23:59:59"],
			],
			fields=["employee", "time", "shift_actual_start", "shift_actual_end"],
			order_by="employee asc, time asc",
			limit_page_length=10000,
		)
		per_day = {}
		for row in rows:
			employee = row.employee
			day = getdate(row.time)
			key = (employee, day)
			bucket = per_day.setdefault(key, {"min_time": None, "max_time": None, "hours": 0.0})
			time_value = get_datetime(row.time)
			bucket["min_time"] = time_value if not bucket["min_time"] or time_value < bucket["min_time"] else bucket["min_time"]
			bucket["max_time"] = time_value if not bucket["max_time"] or time_value > bucket["max_time"] else bucket["max_time"]
			if row.shift_actual_start and row.shift_actual_end:
				start = get_datetime(row.shift_actual_start)
				end = get_datetime(row.shift_actual_end)
				if end > start:
					bucket["hours"] = max(bucket["hours"], (end - start).total_seconds() / 3600)
		for (employee, _day), bucket in per_day.items():
			item = result.get(employee)
			if not item:
				continue
			item["attendance_days"] += 1
			item["payment_days"] += 1
			hours = bucket["hours"]
			if not hours and bucket["min_time"] and bucket["max_time"] and bucket["max_time"] > bucket["min_time"]:
				hours = (bucket["max_time"] - bucket["min_time"]).total_seconds() / 3600
			item["attendance_hours"] += hours
		return result

	return result


@frappe.whitelist()
def get_bulk_checkin_overtime_values(
	employees: list[str] | str,
	start_date: str,
	end_date: str,
):
	if isinstance(employees, str):
		employees = frappe.parse_json(employees)
	employees = [employee for employee in (employees or []) if employee]
	if not employees:
		return {}

	rows = frappe.get_all(
		"Employee Checkin",
		filters=[
			["employee", "in", employees],
			["time", ">=", f"{start_date} 00:00:00"],
			["time", "<=", f"{end_date} 23:59:59"],
		],
		fields=["employee", "time", "shift_start", "shift_end", "shift_actual_start", "shift_actual_end"],
		order_by="employee asc, time asc",
		limit_page_length=10000,
	)

	per_day = {}
	for row in rows:
		employee = row.employee
		day = getdate(row.time)
		key = (employee, day)
		bucket = per_day.setdefault(
			key,
			{
				"min_time": None,
				"max_time": None,
				"shift_start": None,
				"shift_end": None,
				"actual_start": None,
				"actual_end": None,
			},
		)
		time_value = get_datetime(row.time)
		bucket["min_time"] = time_value if not bucket["min_time"] or time_value < bucket["min_time"] else bucket["min_time"]
		bucket["max_time"] = time_value if not bucket["max_time"] or time_value > bucket["max_time"] else bucket["max_time"]

		if row.shift_start:
			shift_start = get_datetime(row.shift_start)
			bucket["shift_start"] = shift_start if not bucket["shift_start"] or shift_start < bucket["shift_start"] else bucket["shift_start"]
		if row.shift_end:
			shift_end = get_datetime(row.shift_end)
			bucket["shift_end"] = shift_end if not bucket["shift_end"] or shift_end > bucket["shift_end"] else bucket["shift_end"]
		if row.shift_actual_start:
			actual_start = get_datetime(row.shift_actual_start)
			bucket["actual_start"] = actual_start if not bucket["actual_start"] or actual_start < bucket["actual_start"] else bucket["actual_start"]
		if row.shift_actual_end:
			actual_end = get_datetime(row.shift_actual_end)
			bucket["actual_end"] = actual_end if not bucket["actual_end"] or actual_end > bucket["actual_end"] else bucket["actual_end"]

	result = {employee: {"days": 0.0, "worked_hours": 0.0, "shift_hours": 0.0, "overtime_hours": 0.0} for employee in employees}
	for (employee, _day), bucket in per_day.items():
		item = result.get(employee)
		if not item:
			continue
		item["days"] += 1

		actual_start = bucket["actual_start"] or bucket["min_time"]
		actual_end = bucket["actual_end"] or bucket["max_time"]
		shift_start = bucket["shift_start"]
		shift_end = bucket["shift_end"]

		worked_hours = 0.0
		if actual_start and actual_end and actual_end > actual_start:
			worked_hours = (actual_end - actual_start).total_seconds() / 3600

		shift_hours = 0.0
		if shift_start and shift_end and shift_end > shift_start:
			shift_hours = (shift_end - shift_start).total_seconds() / 3600

		overtime_hours = max(worked_hours - shift_hours, 0.0)
		item["worked_hours"] += worked_hours
		item["shift_hours"] += shift_hours
		item["overtime_hours"] += overtime_hours

	return result


@frappe.whitelist()
def get_employee_advance_balance(employee: str):
	if not employee:
		return {"employee": "", "balance": 0.0, "count": 0}

	rows = frappe.get_all(
		"Employee Advance",
		filters=[
			["employee", "=", employee],
			["docstatus", "=", 1],
			["pending_amount", ">", 0],
		],
		fields=["name", "pending_amount"],
		limit_page_length=5000,
	)

	return {
		"employee": employee,
		"balance": sum(flt(row.pending_amount) for row in rows),
		"count": len(rows),
	}


class _BulkAccrualAdapter:
	def __init__(self, batch, submitted_salary_slips, payroll_payable_account: str):
		self.batch = batch
		self.doctype = "Bulk Salary Creation"
		self.name = batch.name
		self.company = batch.company
		self.start_date = batch.start_date
		self.end_date = batch.end_date
		self.posting_date = batch.posting_date
		self.payroll_payable_account = payroll_payable_account
		self.cost_center = frappe.get_cached_value("Company", batch.company, "cost_center")
		self.project = None
		self.exchange_rate = 1
		self.employee_based_payroll_payable_entries = {}
		self._advance_deduction_entries = []
		self._submitted_salary_slips = submitted_salary_slips

	def check_permission(self, *_args, **_kwargs):
		return

	def log_error(self, message):
		frappe.log_error(title="Payroll Bulk Accrual", message=message)

	def get(self, key, default=None):
		return getattr(self, key, default)

	def get_sal_slip_list(self, ss_status=1, as_dict=False):
		slips = [slip for slip in self._submitted_salary_slips if slip.docstatus == ss_status]
		if as_dict:
			return [{"name": slip.name, "salary_structure": slip.salary_structure} for slip in slips]
		return slips

	def get_salary_components(self, component_type):
		salary_slips = self.get_sal_slip_list(ss_status=1, as_dict=True)
		if not salary_slips:
			return []

		ss = frappe.qb.DocType("Salary Slip")
		ssd = frappe.qb.DocType("Salary Detail")
		return (
			frappe.qb.from_(ss)
			.join(ssd)
			.on(ss.name == ssd.parent)
			.select(
				ssd.salary_component,
				ssd.amount,
				ssd.parentfield,
				ssd.additional_salary,
				ss.salary_structure,
				ss.employee,
			)
			.where(
				(ssd.parentfield == component_type)
				& (ss.name.isin([d["name"] for d in salary_slips]))
				& (
					(ssd.do_not_include_in_total == 0)
					| ((ssd.do_not_include_in_total == 1) & (ssd.do_not_include_in_accounts == 0))
				)
			)
		).run(as_dict=True)

	def get_salary_component_total(self, component_type=None, employee_wise_accounting_enabled=False):
		salary_components = self.get_salary_components(component_type)
		if not salary_components:
			return {}

		component_dict = {}
		for item in salary_components:
			employee_cost_centers = self.get_payroll_cost_centers_for_employee(
				item.employee, item.salary_structure
			)
			employee_advance = self.get_advance_deduction(component_type, item)

			for cost_center, percentage in employee_cost_centers.items():
				amount_against_cost_center = flt(item.amount) * percentage / 100

				if employee_advance:
					self.add_advance_deduction_entry(
						item, amount_against_cost_center, cost_center, employee_advance
					)
				else:
					key = (item.salary_component, cost_center)
					component_dict[key] = component_dict.get(key, 0) + amount_against_cost_center

				if employee_wise_accounting_enabled:
					self.set_employee_based_payroll_payable_entries(
						component_type, item.employee, amount_against_cost_center
					)

		return self.get_account(component_dict=component_dict)

	def set_journal_entry_in_salary_slips(self, submitted_salary_slips, jv_name=None):
		salary_slip_names = [salary_slip.name for salary_slip in submitted_salary_slips]
		if not salary_slip_names:
			return
		salary_slip = frappe.qb.DocType("Salary Slip")
		(
			frappe.qb.update(salary_slip)
			.set(salary_slip.journal_entry, jv_name)
			.where(salary_slip.name.isin(salary_slip_names))
		).run()

	def make_journal_entry(
		self,
		accounts,
		currencies,
		payroll_payable_account=None,
		voucher_type="Journal Entry",
		user_remark="",
		submitted_salary_slips=None,
		submit_journal_entry=False,
		employee_wise_accounting_enabled=False,
	):
		for row in accounts:
			if row.get("reference_type") == self.doctype:
				row["reference_type"] = None
				row["reference_name"] = None

		multi_currency = 1 if len(currencies) > 1 else 0
		journal_entry = frappe.new_doc("Journal Entry")
		journal_entry.voucher_type = voucher_type
		journal_entry.user_remark = user_remark
		journal_entry.company = self.company
		journal_entry.posting_date = self.posting_date
		journal_entry.party_not_required = False if employee_wise_accounting_enabled else True
		journal_entry.set("accounts", accounts)
		journal_entry.multi_currency = multi_currency
		if voucher_type == "Journal Entry":
			journal_entry.title = payroll_payable_account
		journal_entry.save(ignore_permissions=True)
		if submit_journal_entry:
			journal_entry.submit()
		if submitted_salary_slips:
			self.set_journal_entry_in_salary_slips(submitted_salary_slips, jv_name=journal_entry.name)
		return journal_entry


for _method_name in (
	"get_salary_component_account",
	"get_account",
	"get_advance_deduction",
	"add_advance_deduction_entry",
	"set_accounting_entries_for_advance_deductions",
	"set_employee_based_payroll_payable_entries",
	"get_payroll_cost_centers_for_employee",
	"get_payable_amount_for_earnings_and_deductions",
	"set_payable_amount_against_payroll_payable_account",
	"get_accounting_entries_and_payable_amount",
	"update_accounting_dimensions",
	"get_amount_and_exchange_rate_for_journal_entry",
):
	setattr(_BulkAccrualAdapter, _method_name, getattr(PayrollEntry, _method_name))


def _get_batch_submitted_salary_slips(batch_name: str):
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	salary_slip_names = [
		row.salary_slip
		for row in batch.employees
		if row.salary_slip and row.salary_slip_status == "Submitted"
	]
	if not salary_slip_names:
		frappe.throw(_("No submitted Salary Slips found for batch {0}.").format(batch_name))
	salary_slips = [frappe.get_doc("Salary Slip", name) for name in salary_slip_names]
	return batch, salary_slips


def _get_common_payroll_payable_account(salary_slips):
	payable_accounts = set()
	for slip in salary_slips:
		account = frappe.db.get_value(
			"Salary Structure Assignment",
			{
				"employee": slip.employee,
				"salary_structure": slip.salary_structure,
				"from_date": ("<=", slip.start_date),
				"docstatus": 1,
			},
			"payroll_payable_account",
			order_by="from_date desc",
		)
		if not account:
			frappe.throw(
				_("Payroll Payable Account is missing on Salary Structure Assignment for {0}.").format(
					slip.employee
				)
			)
		payable_accounts.add(account)

	if len(payable_accounts) != 1:
		frappe.throw(
			_("Submitted slips in this batch use multiple Payroll Payable Accounts: {0}.").format(
				", ".join(sorted(payable_accounts))
			)
		)

	payable_account = next(iter(payable_accounts))
	account_type = frappe.db.get_value("Account", payable_account, "account_type")
	if account_type != "Payable":
		frappe.throw(
			_("Payroll Payable Account {0} must be a Payable account.").format(payable_account)
		)
	return payable_account


@frappe.whitelist()
def create_bulk_accrual_journal_entry(batch_name: str):
	batch, salary_slips = _get_batch_submitted_salary_slips(batch_name)
	pending_slips = [slip for slip in salary_slips if not slip.journal_entry]
	if not pending_slips:
		if batch.accrual_journal_entry:
			return {"journal_entry": batch.accrual_journal_entry, "created": False}
		frappe.throw(_("All submitted Salary Slips in this batch already have accrual Journal Entries."))

	payroll_payable_account = _get_common_payroll_payable_account(pending_slips)
	adapter = _BulkAccrualAdapter(batch, pending_slips, payroll_payable_account)

	employee_wise_accounting_enabled = frappe.db.get_single_value(
		"Payroll Settings", "process_payroll_accounting_entry_based_on_employee"
	)
	adapter.employee_based_payroll_payable_entries = {}
	adapter._advance_deduction_entries = []

	earnings = (
		adapter.get_salary_component_total(
			component_type="earnings",
			employee_wise_accounting_enabled=employee_wise_accounting_enabled,
		)
		or {}
	)
	deductions = (
		adapter.get_salary_component_total(
			component_type="deductions",
			employee_wise_accounting_enabled=employee_wise_accounting_enabled,
		)
		or {}
	)
	if not earnings and not deductions:
		frappe.throw(_("No earning or deduction components found on submitted Salary Slips."))

	accounts = []
	currencies = []
	payable_amount = 0
	accounting_dimensions = get_accounting_dimensions() or []
	company_currency = erpnext.get_company_currency(batch.company)
	precision = frappe.get_precision("Journal Entry Account", "debit_in_account_currency")

	payable_amount = adapter.get_payable_amount_for_earnings_and_deductions(
		accounts,
		earnings,
		deductions,
		currencies,
		company_currency,
		accounting_dimensions,
		precision,
		payable_amount,
		employee_wise_accounting_enabled,
	)
	payable_amount = adapter.set_accounting_entries_for_advance_deductions(
		accounts,
		currencies,
		company_currency,
		accounting_dimensions,
		precision,
		payable_amount,
	)
	adapter.set_payable_amount_against_payroll_payable_account(
		accounts,
		currencies,
		company_currency,
		accounting_dimensions,
		precision,
		payable_amount,
		payroll_payable_account,
		employee_wise_accounting_enabled,
	)

	journal_entry = adapter.make_journal_entry(
		accounts,
		currencies,
		payroll_payable_account,
		voucher_type="Journal Entry",
		user_remark=_("Accrual Journal Entry for salaries from {0} to {1} (Batch {2})").format(
			batch.start_date, batch.end_date, batch.name
		),
		submitted_salary_slips=pending_slips,
		submit_journal_entry=True,
		employee_wise_accounting_enabled=employee_wise_accounting_enabled,
	)
	batch.db_set("accrual_journal_entry", journal_entry.name)
	return {"journal_entry": journal_entry.name, "created": True}


@frappe.whitelist()
def sync_salary_structure_assignment_base(assignment_name: str, base: float):
	if not assignment_name:
		frappe.throw(_("Salary Structure Assignment is required."))
	base = flt(base)
	if base <= 0:
		frappe.throw(_("Base must be greater than zero."))
	if not frappe.db.exists("Salary Structure Assignment", assignment_name):
		frappe.throw(_("Salary Structure Assignment {0} not found.").format(assignment_name))
	frappe.db.set_value("Salary Structure Assignment", assignment_name, "base", base, update_modified=True)
	return {"assignment_name": assignment_name, "base": base}


def _get_salary_structure_assignment(employee: str, payroll_frequency: str, start_date: str, end_date: str):
	assignment = frappe.db.sql(
		"""
		select
			ssa.name,
			ssa.salary_structure,
			ssa.base,
			ssa.from_date,
			ssa.payroll_payable_account
		from `tabSalary Structure Assignment` ssa
		inner join `tabSalary Structure` ss on ss.name = ssa.salary_structure
		where
			ssa.docstatus = 1
			and ss.docstatus = 1
			and ss.is_active = 'Yes'
			and ssa.employee = %s
			and ss.payroll_frequency = %s
			and (
				ssa.from_date <= %s
				or ssa.from_date <= %s
			)
		order by ssa.from_date desc
		limit 1
		""",
		(employee, payroll_frequency, start_date, end_date),
		as_dict=True,
	)
	if not assignment:
		frappe.throw(
			_("No active Salary Structure Assignment found for employee {0}.").format(employee)
		)
	return assignment[0]


def _cancel_or_delete_existing_slip(slip_name: str):
	if not slip_name or not frappe.db.exists("Salary Slip", slip_name):
		return
	slip = frappe.get_doc("Salary Slip", slip_name)
	row_name = slip.get("bulk_salary_creation_employee")
	batch_name = slip.get("bulk_salary_creation")
	if slip.docstatus == 2:
		return
	if slip.get("journal_entry"):
		frappe.throw(
			_("Salary Slip {0} already has accrual Journal Entry {1}. Cancel that first.").format(
				slip.name, slip.journal_entry
			)
		)
	if slip.get("payment_entry"):
		frappe.throw(
			_("Salary Slip {0} already has payment reference {1}. Cancel that first.").format(
				slip.name, slip.payment_entry
			)
		)
	if slip.docstatus == 1:
		slip.cancel()
		_cancel_batch_additional_salaries(batch_name, employee=slip.employee)
	else:
		if row_name and frappe.db.exists("Bulk Salary Creation Employee", row_name):
			frappe.db.set_value(
				"Bulk Salary Creation Employee",
				row_name,
				{
					"salary_slip": "",
					"salary_slip_status": "",
					"status": "Pending",
					"error_message": "",
				},
				update_modified=False,
			)
		frappe.delete_doc("Salary Slip", slip.name, force=1, ignore_permissions=True)
		if batch_name:
			_cancel_batch_additional_salaries(batch_name, employee=slip.employee)
		if batch_name and frappe.db.exists("Bulk Salary Creation", batch_name):
			from payroll_bulk.events.salary_slip import _update_batch_summary

			_update_batch_summary(batch_name)


def _reset_batch_row_link(row_name: str, status: str = "Pending", salary_slip_status: str = "", error_message: str = ""):
	if row_name and frappe.db.exists("Bulk Salary Creation Employee", row_name):
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row_name,
			{
				"salary_slip": "",
				"salary_slip_status": salary_slip_status,
				"status": status,
				"error_message": error_message,
				"payment_entry": "",
			},
			update_modified=False,
		)


def _clear_salary_slip_bulk_links(slip):
	updates = {}
	for fieldname in ("bulk_salary_creation", "bulk_salary_creation_employee"):
		if slip.meta.get_field(fieldname):
			updates[fieldname] = ""
	if updates:
		frappe.db.set_value("Salary Slip", slip.name, updates, update_modified=False)


@frappe.whitelist()
def unlink_bulk_salary_slip(batch_name: str, row_name: str, action: str = "unlink"):
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))
	if not row.salary_slip:
		return {"ok": True, "message": _("No Salary Slip linked.")}

	slip = frappe.get_doc("Salary Slip", row.salary_slip)
	if action == "delete_draft":
		if slip.docstatus != 0:
			frappe.throw(_("Only Draft Salary Slips can be deleted from Bulk Salary Creation."))
		_clear_salary_slip_bulk_links(slip)
		_reset_batch_row_link(row_name)
		_cancel_batch_additional_salaries(batch_name, employee=row.employee)
		frappe.delete_doc("Salary Slip", slip.name, force=1, ignore_permissions=True)
	elif action == "cancel_unlink":
		if slip.docstatus != 1:
			frappe.throw(_("Only Submitted Salary Slips can be cancelled from Bulk Salary Creation."))
		if slip.get("journal_entry"):
			frappe.throw(_("Cancel accrual Journal Entry {0} first.").format(slip.journal_entry))
		if slip.get("payment_entry"):
			frappe.throw(_("Cancel payment reference {0} first.").format(slip.payment_entry))
		slip.cancel()
		_cancel_batch_additional_salaries(batch_name, employee=row.employee)
		_clear_salary_slip_bulk_links(slip)
		_reset_batch_row_link(row_name)
	elif action == "unlink":
		_clear_salary_slip_bulk_links(slip)
		_reset_batch_row_link(row_name)
	else:
		frappe.throw(_("Unsupported action {0}.").format(action))

	if batch_name and frappe.db.exists("Bulk Salary Creation", batch_name):
		from payroll_bulk.events.salary_slip import _update_batch_summary
		_update_batch_summary(batch_name)

	return {"ok": True, "message": _("Salary Slip link updated."), "action": action, "salary_slip": slip.name}


def _replace_salary_slip_rows(target_slip, source_slip):
	for parentfield in ("earnings", "deductions"):
		frappe.db.delete("Salary Detail", {"parent": target_slip.name, "parentfield": parentfield})
		for idx, row in enumerate(source_slip.get(parentfield) or [], start=1):
			data = row.as_dict(no_nulls=True)
			for key in (
				"name",
				"parent",
				"parentfield",
				"parenttype",
				"owner",
				"creation",
				"modified",
				"modified_by",
				"docstatus",
				"idx",
			):
				data.pop(key, None)
			data.update(
				{
					"doctype": "Salary Detail",
					"parent": target_slip.name,
					"parentfield": parentfield,
					"parenttype": "Salary Slip",
					"idx": idx,
				}
			)
			frappe.get_doc(data).db_insert()

	frappe.db.set_value(
		"Salary Slip",
		target_slip.name,
		{
			"gross_pay": source_slip.gross_pay,
			"net_pay": source_slip.net_pay,
			"total_deduction": source_slip.total_deduction,
			"base_gross_pay": source_slip.base_gross_pay,
			"base_net_pay": source_slip.base_net_pay,
			"base_total_deduction": source_slip.base_total_deduction,
			"payment_days": source_slip.payment_days,
			"absent_days": source_slip.absent_days,
			"total_working_days": source_slip.total_working_days,
			"salary_structure": source_slip.salary_structure,
		},
		update_modified=False,
	)
	target_slip.reload()


def _guess_base_component(structure_doc):
	keywords = ("basic", "base", "salary", "bs ")
	for row in structure_doc.get("earnings") or []:
		component_name = (row.salary_component or "").lower()
		if row.depends_on_payment_days:
			return row.salary_component
		if any(keyword in component_name for keyword in keywords):
			return row.salary_component
	return (structure_doc.get("earnings") or [None])[0].salary_component if structure_doc.get("earnings") else ""


def _guess_component(structure_doc, table: str, keywords: tuple[str, ...]) -> str:
	for row in structure_doc.get(table) or []:
		component_name = (row.salary_component or "").lower()
		if any(keyword in component_name for keyword in keywords):
			return row.salary_component
	return ""


def _structure_needs_base_fallback(structure_doc) -> bool:
	for row in structure_doc.get("earnings") or []:
		if flt(row.amount):
			return False
		if (row.formula or "").strip():
			return False
	return True


def _manual_base_amount(row, manual_salary_basis: str | None, ctc: float, daily: float) -> float:
	basis = manual_salary_basis or "Full Month"
	if basis == "By Payment Days":
		days = flt(row.get("payment_days"))
		return flt(daily * days) if days else ctc
	if basis == "Deduct Absent Days":
		absent = flt(row.get("absent_days"))
		return flt(daily * max(0, 30 - absent)) if absent else ctc
	return ctc


def _calculate_batch_base_amount(
	row,
	calculation_mode: str | None = None,
	manual_salary_basis: str | None = None,
	overtime_with_salary: int | bool = 0,
) -> float:
	ctc = flt(row.get("ctc"))
	daily = flt(ctc / 30) if ctc else 0

	if calculation_mode in ("Attendance Based", "Checkin Based"):
		days = flt(row.get("payment_days")) or flt(row.get("attendance_days"))
		return flt(daily * days) if days else 0

	if calculation_mode == "Per Piece or Per Hour":
		if cint(overtime_with_salary):
			return _manual_base_amount(row, manual_salary_basis, ctc, daily)
		hourly_rate = flt(ctc / 30 / 8) if ctc else 0
		return flt(hourly_rate * flt(row.get("source_hours")) + flt(row.get("source_qty")) * flt(row.get("piece_rate")))

	return _manual_base_amount(row, manual_salary_basis, ctc, daily)


def _ensure_row_attendance_loaded(row, batch, options: dict):
	mode = batch.calculation_mode or "Manual"
	manual_basis = batch.get("manual_salary_basis") or "Full Month"
	needs_attendance = mode in ("Attendance Based", "Checkin Based") or (
		mode == "Manual" and manual_basis in ("By Payment Days", "Deduct Absent Days")
	)
	if not needs_attendance:
		return
	if flt(row.payment_days) or flt(row.attendance_days):
		return

	source = "Employee Checkin" if mode == "Checkin Based" else "Attendance"
	values = get_bulk_attendance_values([row.employee], source, options["start_date"], options["end_date"])
	item = values.get(row.employee) or {}
	if not any(flt(item.get(field)) for field in ("attendance_days", "payment_days", "absent_days")):
		return

	updates = {
		"attendance_days": item.get("attendance_days") or 0,
		"absent_days": item.get("absent_days") or 0,
		"attendance_hours": item.get("attendance_hours") or 0,
		"payment_days": item.get("payment_days") or 0,
	}
	frappe.db.set_value("Bulk Salary Creation Employee", row.name, updates, update_modified=False)
	for field, value in updates.items():
		row.set(field, value)


def _cancel_batch_additional_salaries(batch_name: str, employee: str | None = None):
	"""Cancel or delete Additional Salary rows linked to a bulk batch."""
	filters = {
		"ref_doctype": "Bulk Salary Creation",
		"ref_docname": batch_name,
		"docstatus": ["<", 2],
	}
	if employee:
		filters["employee"] = employee

	cancelled = 0
	for name in frappe.get_all("Additional Salary", filters=filters, pluck="name"):
		doc = frappe.get_doc("Additional Salary", name)
		if doc.docstatus == 1:
			doc.cancel()
			cancelled += 1
		elif doc.docstatus == 0:
			frappe.delete_doc("Additional Salary", doc.name, force=1, ignore_permissions=True)
			cancelled += 1
	return cancelled


def _get_existing_additional_salaries(employee: str, payroll_date: str, component: str, batch_name: str):
	return frappe.get_all(
		"Additional Salary",
		filters={
			"employee": employee,
			"payroll_date": payroll_date,
			"salary_component": component,
			"ref_doctype": "Bulk Salary Creation",
			"ref_docname": batch_name,
			"docstatus": ["<", 2],
		},
		fields=["name", "docstatus"],
		limit_page_length=20,
	)


def _upsert_additional_salary(
	row,
	company: str,
	component: str,
	component_type: str,
	amount: float,
	start_date: str,
	end_date: str,
	posting_date: str,
	batch_name: str,
):
	amount = flt(amount)
	if not component or amount <= 0:
		return

	existing_rows = _get_existing_additional_salaries(row.employee, posting_date, component, batch_name)
	for existing_row in existing_rows:
		if existing_row.docstatus == 1:
			return existing_row.name
		frappe.get_doc("Additional Salary", existing_row.name).delete()

	additional_salary = frappe.get_doc(
		{
			"doctype": "Additional Salary",
			"employee": row.employee,
			"employee_name": row.employee_name or row.employee,
			"department": row.get("department") or "",
			"company": company,
			"is_recurring": 0,
			"from_date": start_date,
			"to_date": end_date,
			"payroll_date": posting_date,
			"salary_component": component,
			"type": component_type,
			"amount": amount,
			"overwrite_salary_structure_amount": 0,
			"ref_doctype": "Bulk Salary Creation",
			"ref_docname": batch_name,
		}
	)
	additional_salary.insert(ignore_permissions=True)
	additional_salary.submit()
	return additional_salary.name


def _create_base_additional_salary_if_needed(
	row,
	assignment,
	company,
	start_date,
	end_date,
	posting_date,
	batch_name,
	calculation_mode: str | None = None,
	manual_salary_basis: str | None = None,
	overtime_with_salary: int | bool = 0,
):
	if calculation_mode == "Per Piece or Per Hour" and not cint(overtime_with_salary):
		return

	structure_doc = frappe.get_cached_doc("Salary Structure", assignment.salary_structure)
	if not _structure_needs_base_fallback(structure_doc):
		return

	base_component = _guess_base_component(structure_doc)
	base_amount = _calculate_batch_base_amount(
		row, calculation_mode, manual_salary_basis, overtime_with_salary
	)
	if not base_component or base_amount <= 0:
		return

	_upsert_additional_salary(
		row, company, base_component, "Earning", base_amount, start_date, end_date, posting_date, batch_name
	)


def _get_batch_component_entries(batch_name: str, row_name: str, employee: str):
	filters = {"parent": batch_name}
	if row_name:
		filters["employee_row"] = row_name
	else:
		filters["employee"] = employee
	return frappe.get_all(
		"Bulk Salary Component Entry",
		filters=filters,
		fields=["salary_component", "component_type", "amount"],
		limit_page_length=200,
	)


@frappe.whitelist()
def sync_bulk_batch_slip_status(batch_name: str):
	"""Reconcile batch employee rows with actual Salary Slip docstatus."""
	from payroll_bulk.events.salary_slip import _update_batch_summary

	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	updated = []
	for row in batch.employees:
		if not row.salary_slip or not frappe.db.exists("Salary Slip", row.salary_slip):
			continue
		slip = frappe.db.get_value(
			"Salary Slip",
			row.salary_slip,
			["docstatus", "gross_pay", "net_pay", "status"],
			as_dict=True,
		)
		if not slip:
			continue
		if slip.docstatus == 1:
			status, slip_status = "Submitted", "Submitted"
		elif slip.docstatus == 0:
			status, slip_status = "Slip Created", "Draft"
		else:
			status, slip_status = "Cancelled", "Cancelled"

		if row.status == status and row.salary_slip_status == slip_status:
			continue

		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row.name,
			{
				"status": status,
				"salary_slip_status": slip_status,
				"gross_pay": slip.gross_pay,
				"net_pay": slip.net_pay,
				"error_message": "",
			},
			update_modified=False,
		)
		updated.append(row.employee)

	_update_batch_summary(batch_name)
	frappe.db.commit()
	return {"updated_count": len(updated), "updated_employees": updated}


@frappe.whitelist()
def sync_bulk_row_additional_salaries(
	batch_name: str,
	row_name: str,
	company: str,
	start_date: str,
	end_date: str,
	posting_date: str,
	payroll_frequency: str = "Monthly",
):
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))

	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	calculation_mode = batch.calculation_mode or "Manual"
	manual_salary_basis = batch.get("manual_salary_basis") or "Full Month"
	overtime_with_salary = batch.get("overtime_with_salary") or 0
	assignment = _get_salary_structure_assignment(row.employee, payroll_frequency, start_date, end_date)
	structure_doc = frappe.get_cached_doc("Salary Structure", assignment.salary_structure)

	_create_base_additional_salary_if_needed(
		row,
		assignment,
		company,
		start_date,
		end_date,
		posting_date,
		batch_name,
		calculation_mode,
		manual_salary_basis,
		overtime_with_salary,
	)
	_upsert_additional_salary(
		row,
		company,
		_guess_component(structure_doc, "earnings", ("overtime", "ot")),
		"Earning",
		row.ot_amount,
		start_date,
		end_date,
		posting_date,
		batch_name,
	)
	_upsert_additional_salary(
		row,
		company,
		_guess_component(structure_doc, "deductions", ("advance",)),
		"Deduction",
		row.adv_deduct,
		start_date,
		end_date,
		posting_date,
		batch_name,
	)
	for component_row in _get_batch_component_entries(batch_name, row_name, row.employee):
		_upsert_additional_salary(
			row,
			company,
			component_row.salary_component,
			component_row.component_type or "Earning",
			component_row.amount,
			start_date,
			end_date,
			posting_date,
			batch_name,
		)
	return {
		"row_name": row_name,
		"employee": row.employee,
		"salary_structure": assignment.salary_structure,
	}


@frappe.whitelist()
def create_bulk_salary_slip(
	batch_name: str,
	row_name: str,
	company: str,
	payroll_frequency: str,
	start_date: str,
	end_date: str,
	posting_date: str,
	ctc: float | None = None,
	submit_slip: int | bool = 0,
	cancel_existing: int | bool = 0,
):
	if not batch_name or not row_name:
		frappe.throw(_("Batch and employee row are required."))

	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))

	if cancel_existing and row.salary_slip:
		_cancel_or_delete_existing_slip(row.salary_slip)

	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	_validate_employee_holiday_list(row.employee, start_date, end_date)
	sync_bulk_row_additional_salaries(
		batch_name=batch_name,
		row_name=row_name,
		company=company,
		start_date=start_date,
		end_date=end_date,
		posting_date=posting_date,
		payroll_frequency=payroll_frequency,
	)

	assignment = _get_salary_structure_assignment(row.employee, payroll_frequency, start_date, end_date)
	calculation_mode = batch.calculation_mode or "Manual"
	ctc = flt(ctc or row.get("ctc"))
	if calculation_mode != "Per Piece or Per Hour" and flt(assignment.base) <= 0 and ctc > 0:
		frappe.db.set_value(
			"Salary Structure Assignment", assignment.name, "base", ctc, update_modified=True
		)
		assignment.base = ctc

	make_salary_slip = frappe.get_attr(
		"hrms.payroll.doctype.salary_structure.salary_structure.make_salary_slip"
	)
	target_doc = frappe.get_doc(
		{
			"doctype": "Salary Slip",
			"employee": row.employee,
			"employee_name": row.employee_name,
			"company": company,
			"payroll_frequency": payroll_frequency,
			"start_date": start_date,
			"end_date": end_date,
			"posting_date": posting_date,
			"salary_structure": assignment.salary_structure,
			"bulk_salary_creation": batch_name,
			"bulk_salary_creation_employee": row_name,
		}
	)
	make_salary_slip_kwargs = {
		"target_doc": target_doc,
		"employee": row.employee,
		"posting_date": posting_date,
	}
	try:
		slip = make_salary_slip(
			assignment.salary_structure,
			**make_salary_slip_kwargs,
			ignore_permissions=True,
		)
	except TypeError as error:
		if "ignore_permissions" not in str(error):
			raise
		slip = make_salary_slip(assignment.salary_structure, **make_salary_slip_kwargs)
	preview_slip = frappe.copy_doc(slip)
	preview_earnings_count = len(preview_slip.get("earnings") or [])
	preview_deductions_count = len(preview_slip.get("deductions") or [])
	slip.insert(ignore_permissions=True)
	if len(slip.get("earnings") or []) != preview_earnings_count or len(
		slip.get("deductions") or []
	) != preview_deductions_count:
		_replace_salary_slip_rows(slip, preview_slip)

	if cint(submit_slip):
		try:
			slip.submit()
		except Exception:
			slip.reload()
			if slip.docstatus != 1:
				raise
			frappe.log_error(title=f"Bulk Salary Slip post-submit warning ({slip.name})")
	else:
		slip.reload()

	return {
		"name": slip.name,
		"docstatus": slip.docstatus,
		"status": slip.status,
		"salary_structure": slip.salary_structure,
		"salary_structure_assignment": assignment.name,
		"payroll_payable_account": assignment.payroll_payable_account,
		"gross_pay": slip.gross_pay,
		"net_pay": slip.net_pay,
		"payment_days": slip.payment_days,
		"absent_days": slip.absent_days,
		"total_working_days": slip.total_working_days,
		"earnings_count": len(slip.earnings or []),
		"deductions_count": len(slip.deductions or []),
	}


@frappe.whitelist()
def reprocess_bulk_salary_row(
	batch_name: str,
	row_name: str,
	submit_slip: int | bool = 0,
	cancel_existing: int | bool = 1,
):
	"""Cancel linked Additional Salary + slip, then recreate salary slip for one row."""
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))

	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	if cint(cancel_existing):
		if row.salary_slip:
			_cancel_or_delete_existing_slip(row.salary_slip)
		else:
			_cancel_batch_additional_salaries(batch_name, employee=row.employee)

	sync_bulk_row_additional_salaries(
		batch_name=batch_name,
		row_name=row_name,
		company=batch.company,
		start_date=batch.start_date,
		end_date=batch.end_date,
		posting_date=batch.posting_date,
		payroll_frequency=batch.payroll_frequency or "Monthly",
	)
	result = create_bulk_salary_slip(
		batch_name=batch_name,
		row_name=row_name,
		company=batch.company,
		payroll_frequency=batch.payroll_frequency or "Monthly",
		start_date=batch.start_date,
		end_date=batch.end_date,
		posting_date=batch.posting_date,
		ctc=row.ctc,
		submit_slip=cint(submit_slip),
		cancel_existing=0,
	)
	from payroll_bulk.events.salary_slip import _update_batch_summary

	_update_batch_summary(batch_name)
	return result


@frappe.whitelist()
def process_bulk_batch_rows(batch_name: str, submit_slip: int | bool = 0, replace_existing: int | bool = 0):
	"""Create salary slips for all pending rows in a batch (server-side helper)."""
	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	options = {
		"company": batch.company,
		"payroll_frequency": batch.payroll_frequency or "Monthly",
		"start_date": batch.start_date,
		"end_date": batch.end_date,
		"posting_date": batch.posting_date,
		"submit_slips": cint(submit_slip),
		"replace_existing_slips": cint(replace_existing),
		"create_missing_only": 0,
		"row_names": [row.name for row in batch.employees if row.employee],
	}
	return process_bulk_salary_batch(batch_name, options)


BULK_BACKGROUND_ROW_THRESHOLD = 20


def _parse_bulk_batch_options(options):
	if isinstance(options, str):
		options = frappe.parse_json(options)
	return options or {}


def _get_existing_period_salary_slip(employee: str, company: str, start_date: str, end_date: str) -> str | None:
	return frappe.db.get_value(
		"Salary Slip",
		{
			"employee": employee,
			"company": company,
			"start_date": start_date,
			"end_date": end_date,
			"docstatus": ["<", 2],
		},
		"name",
	)


def _set_bulk_job_progress(job_id: str, batch_name: str, processed: int, total: int, error: str | None = None):
	frappe.cache.set_value(
		f"bulk_salary_job:{job_id}",
		{
			"batch_name": batch_name,
			"processed_count": processed,
			"total_count": total,
			"error": error,
		},
		expires_in_sec=86400,
	)


def _process_batch_row(batch_name: str, row_name: str, options: dict):
	row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
	if row.parent != batch_name:
		frappe.throw(_("Employee row {0} does not belong to batch {1}.").format(row_name, batch_name))
	if not row.employee:
		frappe.throw(_("Employee is required."))
	if not flt(row.ctc):
		frappe.throw(_("CTC is missing."))
	if row.adv_deduct and row.advance_balance and flt(row.adv_deduct) > flt(row.advance_balance):
		frappe.throw(_("Advance deduction cannot exceed advance balance."))

	company = options["company"]
	start_date = options["start_date"]
	end_date = options["end_date"]
	posting_date = options["posting_date"]
	payroll_frequency = options.get("payroll_frequency") or "Monthly"
	batch = frappe.get_cached_doc("Bulk Salary Creation", batch_name)
	_validate_employee_holiday_list(row.employee, start_date, end_date)
	_ensure_row_attendance_loaded(row, batch, options)
	mode = batch.calculation_mode or "Manual"
	if mode in ("Attendance Based", "Checkin Based"):
		days = flt(row.payment_days) or flt(row.attendance_days)
		if not days:
			frappe.throw(
				_("No attendance/checkin days found for {0} in this period. Mark attendance or load source data first.").format(
					row.employee
				)
			)
	existing = _get_existing_period_salary_slip(row.employee, company, start_date, end_date)

	if existing and not cint(options.get("replace_existing_slips")):
		slip_docstatus = frappe.db.get_value("Salary Slip", existing, "docstatus")
		if slip_docstatus == 0 and cint(options.get("submit_slips")):
			slip = frappe.get_doc("Salary Slip", existing)
			try:
				slip.submit()
			except Exception:
				slip.reload()
				if slip.docstatus != 1:
					raise
				frappe.log_error(title=f"Bulk Salary Slip post-submit warning ({existing})")
			frappe.db.set_value(
				"Bulk Salary Creation Employee",
				row_name,
				{
					"salary_slip": existing,
					"status": "Submitted",
					"error_message": "",
					"salary_slip_status": "Submitted",
					"gross_pay": slip.gross_pay,
					"net_pay": slip.net_pay,
				},
				update_modified=False,
			)
			return {"submitted": True, "salary_slip": existing}

		salary_slip_status = "Submitted" if slip_docstatus == 1 else "Draft"
		status = "Skipped"
		message = (
			"Skipped because Salary Slip already exists."
			if cint(options.get("create_missing_only"))
			else "Linked existing Salary Slip for this period."
		)
		frappe.db.set_value(
			"Bulk Salary Creation Employee",
			row_name,
			{
				"salary_slip": existing,
				"status": status,
				"error_message": message,
				"salary_slip_status": salary_slip_status,
			},
			update_modified=False,
		)
		return {"skipped": True, "salary_slip": existing}

	sync_bulk_row_additional_salaries(
		batch_name=batch_name,
		row_name=row_name,
		company=company,
		start_date=start_date,
		end_date=end_date,
		posting_date=posting_date,
		payroll_frequency=payroll_frequency,
	)
	return create_bulk_salary_slip(
		batch_name=batch_name,
		row_name=row_name,
		company=company,
		payroll_frequency=payroll_frequency,
		start_date=start_date,
		end_date=end_date,
		posting_date=posting_date,
		ctc=row.ctc,
		submit_slip=cint(options.get("submit_slips")),
		cancel_existing=cint(options.get("replace_existing_slips")) and bool(existing),
	)


def process_bulk_salary_batch(batch_name: str, options=None, job_id: str | None = None):
	from payroll_bulk.events.salary_slip import _update_batch_summary

	options = _parse_bulk_batch_options(options)
	job_id = job_id or options.get("_job_id")
	frappe.db.set_value(
		"Bulk Salary Creation", batch_name, {"processing_status": "Processing"}, update_modified=False
	)
	frappe.db.commit()

	batch = frappe.get_doc("Bulk Salary Creation", batch_name)
	row_names = options.get("row_names") or [row.name for row in batch.employees if row.employee]
	total = len(row_names)
	results = {"success": [], "failed": [], "skipped": []}

	for index, row_name in enumerate(row_names, start=1):
		try:
			row_result = _process_batch_row(batch_name, row_name, options)
			if row_result and row_result.get("skipped"):
				results["skipped"].append(row_name)
			else:
				results["success"].append(row_name)
		except Exception as error:
			frappe.log_error(title=f"Bulk Salary Batch Row Failed ({batch_name})")
			row = frappe.get_doc("Bulk Salary Creation Employee", row_name)
			slip_docstatus = (
				frappe.db.get_value("Salary Slip", row.salary_slip, "docstatus") if row.salary_slip else None
			)
			if slip_docstatus == 1:
				results["success"].append(row_name)
				frappe.db.set_value(
					"Bulk Salary Creation Employee",
					row_name,
					{
						"status": "Submitted",
						"salary_slip_status": "Submitted",
						"error_message": str(error)[:200],
					},
					update_modified=False,
				)
			else:
				results["failed"].append(row_name)
				frappe.db.set_value(
					"Bulk Salary Creation Employee",
					row_name,
					{
						"status": "Failed",
						"error_message": str(error)[:500],
						"salary_slip_status": "",
					},
					update_modified=False,
				)
		if job_id:
			_set_bulk_job_progress(job_id, batch_name, index, total)
		frappe.db.commit()

	_update_batch_summary(batch_name)
	sync_bulk_batch_slip_status(batch_name)
	return results


@frappe.whitelist()
def enqueue_bulk_salary_batch(batch_name: str, options=None):
	if not batch_name or not frappe.db.exists("Bulk Salary Creation", batch_name):
		frappe.throw(_("Bulk Salary Creation {0} not found.").format(batch_name))

	options = _parse_bulk_batch_options(options)
	options["user"] = frappe.session.user
	row_names = options.get("row_names") or []
	if not row_names:
		batch = frappe.get_doc("Bulk Salary Creation", batch_name)
		row_names = [row.name for row in batch.employees if row.employee]
		options["row_names"] = row_names
	if not row_names:
		frappe.throw(_("No employee rows found to process."))

	queued_job_id = frappe.generate_hash(length=12)
	frappe.enqueue(
		method="payroll_bulk.api.process_bulk_salary_batch",
		queue="long",
		timeout=3600,
		job_name=f"bulk_salary_{batch_name}",
		batch_name=batch_name,
		options={**options, "_job_id": queued_job_id},
		job_id=queued_job_id,
	)
	_set_bulk_job_progress(queued_job_id, batch_name, 0, len(row_names))
	return {"job_id": queued_job_id, "enqueued": True, "row_count": len(row_names)}


@frappe.whitelist()
def get_bulk_salary_batch_job_status(job_id: str):
	from frappe.utils.background_jobs import get_job_status

	status = get_job_status(job_id) or "queued"
	progress = frappe.cache.get_value(f"bulk_salary_job:{job_id}") or {}
	return {
		"job_id": job_id,
		"status": status,
		"processed_count": progress.get("processed_count", 0),
		"total_count": progress.get("total_count", 0),
		"batch_name": progress.get("batch_name"),
		"error": progress.get("error"),
	}
