from __future__ import annotations

from datetime import date

import frappe
from frappe.utils import add_days, get_datetime, getdate
from hrms.utils.holiday_list import get_holiday_list_for_employee


def _to_time(value) -> str:
	if not value:
		return ""
	return get_datetime(value).strftime("%H:%M")


def build_checkin_day_buckets(checkins: list[dict]) -> dict[tuple[str, str], dict]:
	buckets: dict[tuple[str, str], dict] = {}
	for row in checkins or []:
		employee = row.get("employee")
		if not employee:
			continue
		day = str(getdate(row.get("time")))
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
				"hours": 0.0,
			},
		)
		time_value = get_datetime(row.time)
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

		if row.get("shift_actual_start") and row.get("shift_actual_end"):
			start = get_datetime(row.shift_actual_start)
			end = get_datetime(row.shift_actual_end)
			if end > start:
				bucket["hours"] = max(bucket["hours"], (end - start).total_seconds() / 3600)
		if row.get("shift_start"):
			shift_start = get_datetime(row.shift_start)
			bucket["shift_start"] = (
				shift_start if not bucket["shift_start"] or shift_start < bucket["shift_start"] else bucket["shift_start"]
			)
		if row.get("shift_end"):
			shift_end = get_datetime(row.shift_end)
			bucket["shift_end"] = (
				shift_end if not bucket["shift_end"] or shift_end > bucket["shift_end"] else bucket["shift_end"]
			)
	return buckets


def get_employee_holiday_day_map(
	employees: list[dict] | list[str],
	start_date: date,
	end_date: date,
) -> dict[str, dict[str, str]]:
	holiday_map: dict[str, dict[str, str]] = {}
	company_lists: dict[str, str | None] = {}

	for emp in employees or []:
		if isinstance(emp, str):
			employee = emp
			company = frappe.db.get_value("Employee", employee, "company")
		else:
			employee = emp.get("name") or emp.get("employee")
			company = emp.get("company")
		if not employee:
			continue

		holiday_list = get_holiday_list_for_employee(employee, as_on=end_date, raise_exception=False)
		if isinstance(holiday_list, dict):
			holiday_list = holiday_list.get("holiday_list")
		if not holiday_list and company:
			if company not in company_lists:
				company_lists[company] = frappe.db.get_value("Company", company, "default_holiday_list")
			holiday_list = company_lists[company]
		if not holiday_list:
			continue

		rows = frappe.get_all(
			"Holiday",
			filters={"parent": holiday_list, "holiday_date": ["between", [start_date, end_date]]},
			fields=["holiday_date", "weekly_off"],
		)
		day_map = {}
		for row in rows:
			day_key = str(getdate(row.holiday_date))
			day_map[day_key] = "S" if row.weekly_off else "H"
		holiday_map[employee] = day_map
	return holiday_map


def is_countable_checkin_day(bucket: dict | None) -> bool:
	if not bucket:
		return False
	in_time = bucket.get("in_time") or ""
	out_time = bucket.get("out_time") or ""
	if bucket.get("_in_dt") and bucket.get("_out_dt") and bucket["_out_dt"] > bucket["_in_dt"]:
		return True
	return bool(in_time or out_time)


def bucket_worked_hours(bucket: dict | None) -> float:
	if not bucket:
		return 0.0
	if bucket.get("hours"):
		return float(bucket["hours"])
	if bucket.get("_in_dt") and bucket.get("_out_dt") and bucket["_out_dt"] > bucket["_in_dt"]:
		return (bucket["_out_dt"] - bucket["_in_dt"]).total_seconds() / 3600
	return 0.0


def aggregate_checkin_attendance(
	employees: list[str],
	start_date: str | date,
	end_date: str | date,
) -> dict[str, dict[str, float]]:
	start = getdate(start_date)
	end = getdate(end_date)
	result = {
		employee: {"attendance_days": 0.0, "absent_days": 0.0, "attendance_hours": 0.0, "payment_days": 0.0}
		for employee in employees
	}
	if not employees:
		return result

	employee_rows = frappe.get_all(
		"Employee",
		filters={"name": ["in", employees]},
		fields=["name", "company"],
	)
	employee_map = {row.name: row for row in employee_rows}

	checkins = frappe.get_all(
		"Employee Checkin",
		filters=[
			["employee", "in", employees],
			["time", ">=", f"{start} 00:00:00"],
			["time", "<=", f"{end} 23:59:59"],
		],
		fields=[
			"employee",
			"time",
			"log_type",
			"shift_start",
			"shift_end",
			"shift_actual_start",
			"shift_actual_end",
		],
		order_by="employee asc, time asc",
		limit_page_length=20000,
	)
	buckets = build_checkin_day_buckets(checkins)
	holiday_map = get_employee_holiday_day_map(list(employee_map.values()), start, end)

	for employee in employees:
		item = result[employee]
		emp_holidays = holiday_map.get(employee, {})
		current = start
		while current <= end:
			day_key = str(current)
			if day_key in emp_holidays:
				current = add_days(current, 1)
				continue
			bucket = buckets.get((employee, day_key))
			if not is_countable_checkin_day(bucket):
				current = add_days(current, 1)
				continue
			item["attendance_days"] += 1
			item["payment_days"] += 1
			item["attendance_hours"] += bucket_worked_hours(bucket)
			current = add_days(current, 1)
	return result
