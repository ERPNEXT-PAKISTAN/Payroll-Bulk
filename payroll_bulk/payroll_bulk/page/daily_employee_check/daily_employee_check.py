from __future__ import annotations

import calendar
from datetime import date, datetime

import frappe
from frappe.utils import get_datetime, getdate
from hrms.utils.holiday_list import get_holiday_list_for_employee


def _to_time(value) -> str:
	if not value:
		return ""
	dt = get_datetime(value)
	return dt.strftime("%H:%M")


def _hours_to_hhmm(hours: float) -> str:
	if not hours or hours <= 0:
		return ""
	total_minutes = int(round(hours * 60))
	hh, mm = divmod(total_minutes, 60)
	return f"{hh}:{mm:02d}"


def _month_bounds(month: int, year: int) -> tuple[date, date, int]:
	last_day = calendar.monthrange(year, month)[1]
	return date(year, month, 1), date(year, month, last_day), last_day


def _get_holiday_map(
	employees: list[dict],
	start_date: date,
	end_date: date,
) -> dict[str, dict[str, str]]:
	holiday_map: dict[str, dict[str, str]] = {}
	company_lists: dict[str, str | None] = {}

	for emp in employees:
		employee = emp.name
		holiday_list = get_holiday_list_for_employee(employee, as_on=end_date, raise_exception=False)
		if isinstance(holiday_list, dict):
			holiday_list = holiday_list.get("holiday_list")
		if not holiday_list and emp.company:
			if emp.company not in company_lists:
				company_lists[emp.company] = frappe.db.get_value("Company", emp.company, "default_holiday_list")
			holiday_list = company_lists[emp.company]
		if not holiday_list:
			continue

		rows = frappe.get_all(
			"Holiday",
			filters={"parent": holiday_list, "holiday_date": ["between", [start_date, end_date]]},
			fields=["holiday_date", "weekly_off"],
		)
		day_map = {}
		for row in rows:
			day_key = str(getdate(row.holiday_date).day)
			day_map[day_key] = "S" if row.weekly_off else "H"
		holiday_map[employee] = day_map
	return holiday_map


def _time_to_minutes(value) -> int | None:
	if not value:
		return None
	dt = get_datetime(value)
	return dt.hour * 60 + dt.minute


def _build_day_buckets(checkins: list[dict]) -> dict[tuple[str, str], dict]:
	buckets: dict[tuple[str, str], dict] = {}
	for row in checkins:
		employee = row.get("employee")
		if not employee:
			continue
		day = str(getdate(row.get("time")).day)
		key = (employee, day)
		bucket = buckets.setdefault(
			key,
			{
				"in_time": "",
				"out_time": "",
				"_in_dt": None,
				"_out_dt": None,
				"shift_start": None,
				"shift_end": None,
			},
		)
		time_value = get_datetime(row.get("time"))
		log_type = (row.get("log_type") or "").upper()
		if log_type == "IN":
			if not bucket["_in_dt"] or time_value < bucket["_in_dt"]:
				bucket["_in_dt"] = time_value
				bucket["in_time"] = _to_time(time_value)
		elif log_type == "OUT":
			if not bucket["_out_dt"] or time_value > bucket["_out_dt"]:
				bucket["_out_dt"] = time_value
				bucket["out_time"] = _to_time(time_value)
		else:
			if not bucket["_in_dt"] or time_value < bucket["_in_dt"]:
				bucket["_in_dt"] = time_value
				bucket["in_time"] = _to_time(time_value)
			if not bucket["_out_dt"] or time_value > bucket["_out_dt"]:
				bucket["_out_dt"] = time_value
				bucket["out_time"] = _to_time(time_value)

		if row.get("shift_start"):
			shift_start = get_datetime(row.shift_start)
			if not bucket["shift_start"] or shift_start < bucket["shift_start"]:
				bucket["shift_start"] = shift_start
		if row.get("shift_end"):
			shift_end = get_datetime(row.shift_end)
			if not bucket["shift_end"] or shift_end > bucket["shift_end"]:
				bucket["shift_end"] = shift_end
	return buckets


def _cell_flags(bucket: dict) -> tuple[bool, bool]:
	in_late = False
	out_early = False
	in_minutes = _time_to_minutes(bucket.get("_in_dt"))
	out_minutes = _time_to_minutes(bucket.get("_out_dt"))
	shift_start = _time_to_minutes(bucket.get("shift_start"))
	shift_end = _time_to_minutes(bucket.get("shift_end"))
	if in_minutes is not None and shift_start is not None and in_minutes > shift_start + 5:
		in_late = True
	if out_minutes is not None and shift_end is not None and out_minutes < shift_end - 5:
		out_early = True
	return in_late, out_early


@frappe.whitelist()
def get_report_data(
	month: int | str | None = None,
	year: int | str | None = None,
	company: str | None = None,
	department: str | None = None,
	shift: str | None = None,
	employee: str | None = None,
):
	month = int(month or datetime.today().month)
	year = int(year or datetime.today().year)
	start_date, end_date, days_in_month = _month_bounds(month, year)

	employee_filters = {"status": "Active"}
	if company:
		employee_filters["company"] = company
	if department:
		employee_filters["department"] = department

	employees = frappe.get_all(
		"Employee",
		filters=employee_filters,
		fields=["name", "employee_name", "department", "company"],
		order_by="employee_name asc",
		limit_page_length=500,
	)
	if employee:
		search = employee.strip().lower()
		employees = [
			row
			for row in employees
			if search in (row.employee_name or "").lower() or search in (row.name or "").lower()
		]

	if not employees:
		return {
			"employees": [],
			"days_in_month": days_in_month,
			"month_label": start_date.strftime("%b %Y"),
			"start_date": str(start_date),
			"end_date": str(end_date),
		}

	employee_names = [row.name for row in employees]
	checkin_filters = [
		["employee", "in", employee_names],
		["time", ">=", f"{start_date} 00:00:00"],
		["time", "<=", f"{end_date} 23:59:59"],
	]
	if shift:
		checkin_filters.append(["shift", "=", shift])

	checkins = frappe.get_all(
		"Employee Checkin",
		filters=checkin_filters,
		fields=["employee", "employee_name", "time", "log_type", "shift", "shift_start", "shift_end"],
		order_by="employee asc, time asc",
		limit_page_length=20000,
	)
	buckets = _build_day_buckets(checkins)
	holiday_map = _get_holiday_map(employees, start_date, end_date)

	report_rows = []
	for emp in employees:
		emp_holidays = holiday_map.get(emp.name, {})
		day_cells = {}
		total_present = 0
		for day_num in range(1, days_in_month + 1):
			day_key = str(day_num)
			if day_key in emp_holidays:
				day_cells[day_key] = {"mark": emp_holidays[day_key]}
				continue
			bucket = buckets.get((emp.name, day_key), {})
			in_time = bucket.get("in_time") or ""
			out_time = bucket.get("out_time") or ""
			ot = ""
			in_late = False
			out_early = False
			if bucket.get("_in_dt") and bucket.get("_out_dt") and bucket["_out_dt"] > bucket["_in_dt"]:
				hours = (bucket["_out_dt"] - bucket["_in_dt"]).total_seconds() / 3600
				ot = _hours_to_hhmm(hours)
				in_late, out_early = _cell_flags(bucket)
				total_present += 1
			elif in_time or out_time:
				in_late, out_early = _cell_flags(bucket)
				total_present += 1
			if in_time or out_time or ot:
				day_cells[day_key] = {
					"in": in_time,
					"out": out_time,
					"ot": ot,
					"in_late": in_late,
					"out_early": out_early,
				}

		report_rows.append(
			{
				"employee": emp.name,
				"employee_name": emp.employee_name or emp.name,
				"department": emp.department or "",
				"total": total_present,
				"days": day_cells,
			}
		)

	return {
		"employees": report_rows,
		"days_in_month": days_in_month,
		"month_label": start_date.strftime("%b %Y"),
		"start_date": str(start_date),
		"end_date": str(end_date),
	}
