from __future__ import annotations

from frappe.utils import getdate


def pb_money(value):
	from frappe.utils import flt
	return round(flt(value))


def pb_col(label, fieldname, fieldtype, width=120, **kwargs):
	column = {
		"label": label,
		"fieldname": fieldname,
		"fieldtype": fieldtype,
		"width": width,
	}
	if fieldtype == "Currency":
		column["precision"] = 0
	column.update(kwargs)
	return column


TRAILING_STANDARD_FIELDS = frozenset(
	{
		"company",
		"department",
		"payroll_frequency",
	}
)


def pb_reorder_standard_columns(columns):
	leading = []
	trailing = []
	for column in columns or []:
		fieldname = column.get("fieldname")
		if fieldname == "employee":
			continue
		if fieldname in TRAILING_STANDARD_FIELDS:
			trailing.append(column)
		else:
			leading.append(column)
	return leading + trailing


def pb_format_columns(columns):
	filtered = []
	for column in columns or []:
		if column.get("fieldname") == "employee":
			continue
		if column.get("fieldtype") == "Currency" and column.get("precision") is None:
			column["precision"] = 0
		if not column.get("width"):
			column["width"] = 120
		filtered.append(column)
	return pb_reorder_standard_columns(filtered)


def pb_round_row_amounts(row: dict) -> dict:
	for field in (
		"ctc", "ot_amount", "gross_pay", "net_pay", "adv_deduct", "advance_balance",
		"total_additions", "total_deductions", "amount", "base_pay",
	):
		if field in row and row[field] is not None:
			row[field] = pb_money(row[field])
	return row


def pb_date(value):
	if not value:
		return None
	return getdate(value)


def pb_apply_date_filters(conditions: dict, filters, fieldname="posting_date"):
	if filters.get("batch"):
		return
	from_date = pb_date(filters.get("from_date"))
	to_date = pb_date(filters.get("to_date"))
	if from_date and to_date:
		conditions[fieldname] = ["between", [from_date, to_date]]
	elif from_date:
		conditions[fieldname] = [">=", from_date]
	elif to_date:
		conditions[fieldname] = ["<=", to_date]


def pb_date_range(filters, fieldname="posting_date"):
	from_date = pb_date(filters.get("from_date"))
	to_date = pb_date(filters.get("to_date"))
	if from_date and to_date:
		return fieldname, "between", [from_date, to_date]
	if from_date:
		return fieldname, ">=", from_date
	if to_date:
		return fieldname, "<=", to_date
	return None


def pb_in_date_range(value, filters) -> bool:
	if filters.get("batch"):
		return True
	date_value = pb_date(value)
	if not date_value:
		return True
	from_date = pb_date(filters.get("from_date"))
	to_date = pb_date(filters.get("to_date"))
	if from_date and date_value < from_date:
		return False
	if to_date and date_value > to_date:
		return False
	return True
