# Payroll Bulk

Bulk payroll batch management for [ERPNext HRMS](https://github.com/frappe/hrms). Create salary slips for many employees in one workflow, with support for attendance, check-ins, piece-rate/hourly pay, overtime, advance deductions, accrual journal entries, and salary payments.

## Requirements

- Frappe / ERPNext bench with **ERPNext** and **HRMS** installed
- Salary Structure Assignments for employees
- Payroll Payable accounts configured on assignments

## Installation

```bash
bench get-app https://github.com/your-org/payroll_bulk  # or local path
bench --site your-site install-app payroll_bulk
bench build --app payroll_bulk
```

## Main DocTypes

| DocType | Purpose |
|---------|---------|
| **Bulk Salary Creation** | Payroll batch header — period, company, employees, totals |
| **Bulk Salary Creation Employee** | Child row per employee (CTC, OT, deductions, slip link) |
| **Payroll Bulk Settings** | Defaults for filters, calculation mode, component rules |
| **Bulk Salary Component Entry** | Per-employee extra salary components |

## Workflow

1. Open **Payroll Bulk** workspace → **Bulk Salary Creation**
2. Select company, month/period, and calculation mode
3. Add employees via filters or manual picker
4. Review CTC, attendance/hours/qty, overtime, and advance deductions
5. **Process** — creates Additional Salary rows and Salary Slips (optional submit)
6. Create **Accrual Journal Entry** (batch-level, reuses Payroll Entry accounting logic)
7. Create **Payment Journal Entries** per employee or in bulk

## Calculation Modes

- **Manual** — enter values directly
- **Attendance Based** — payment days from Attendance records
- **Checkin Based** — hours/days from Employee Checkin
- **Per Piece or Per Hour** — qty/hours/rate from a custom DocType

Configure custom source DocType field mappings under **Payroll Bulk Settings**.

## Reports

- **Bulk Salary Creation Summary** — batch-level totals and status
- **Bulk Salary Employee Detail** — per-employee row detail across batches

## API (whitelisted)

Key methods in `payroll_bulk.api`:

- `create_bulk_salary_slip` — create (and optionally submit) a slip for one row
- `create_bulk_accrual_journal_entry` — batch accrual JE from submitted slips
- `get_bulk_attendance_values` / `get_bulk_checkin_overtime_values` — fetch attendance data
- `sync_payroll_bulk_component_rules` — sync component rules from salary structures

## Development

```bash
bench --site your-site run-tests --module payroll_bulk.payroll_bulk.doctype.payroll_bulk_settings.test_payroll_bulk_settings
```

Client UI lives in `payroll_bulk/public/js/bulk_salary_creation.js` (~4k lines). Server logic is in `payroll_bulk/api.py` and `payroll_bulk/events/salary_slip.py`.
