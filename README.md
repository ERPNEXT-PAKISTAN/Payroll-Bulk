# Payroll Bulk

Bulk payroll batch management for [ERPNext HRMS](https://github.com/frappe/hrms). Create salary slips for many employees in one workflow, with support for attendance, check-ins, piece-rate/hourly pay, overtime, advance deductions, accrual journal entries, and salary payments.

## Requirements

- Frappe / ERPNext bench with **ERPNext** and **HRMS** installed
- Salary Structure Assignments for employees
- Payroll Payable accounts configured on assignments (account type must be **Payable**)
- Company default holiday list (or Holiday List Assignment per employee)

## Installation

```bash
bench get-app https://github.com/ERPNEXT-PAKISTAN/Payroll-Bulk
bench --site your-site install-app payroll_bulk
bench --site your-site migrate
bench build --app payroll_bulk
sudo supervisorctl restart all   # reload Python workers after code updates
```

## Update Existing Installed Server

Use these commands after pulling new commits on a server where `payroll_bulk` is already installed:

```bash
cd /home/frappe/frappe-bench
bench --site your-site migrate
bench build --app payroll_bulk
bench restart
bench --site your-site clear-cache
```

For production, replace `bench restart` with your process manager restart (for example `sudo supervisorctl restart all`).

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
6. Create **Accrual Journal Entry** (batch-level, reuses Payroll Entry accounting)
7. **Pay** per employee or **Pay All** — Bank/Cash payment journal entry

## Calculation Modes

| Mode | Base amount |
|------|-------------|
| **Manual** | CTC ÷ 30 × days (see Manual Salary Basis below) |
| **Attendance Based** | CTC ÷ 30 × payment days from Attendance |
| **Checkin Based** | CTC ÷ 30 × payment days from Employee Checkin |
| **Per Piece or Per Hour** | Hours × hourly rate + qty × piece rate (or CTC basis when overtime-with-salary is enabled) |

### Manual Salary Basis (Pakistan)

When calculation mode is **Manual**, choose:

- **Full Month** — full CTC
- **By Payment Days** — CTC ÷ 30 × payment days
- **Deduct Absent Days** — CTC ÷ 30 × (30 − absent days)

Attendance is auto-loaded for Manual/Attendance/Checkin modes when payment or absent days are needed.

Configure custom source DocType field mappings under **Payroll Bulk Settings**.

## Journal Entry Remarks

Accrual and payment JEs use a standard remark:

`Salary F/O January-2026, Dated:31-1-2026`

## Reports

- **Bulk Salary Creation Summary** — batch-level totals and status
- **Bulk Salary Employee Detail** — per-employee row detail across batches

## Client UI (modular JS)

| File | Role |
|------|------|
| `bulk_salary_creation.js` | Form entry, `before_save`, module loader |
| `bulk_salary/utils.js` | Shared state, helpers, styles |
| `bulk_salary/ui.js` | Desk UI, employee table, completed view |
| `bulk_salary/process.js` | Batch processing, slip creation |
| `bulk_salary/payment.js` | Per-employee and bulk payment, PDF export |

## API (whitelisted)

Key methods in `payroll_bulk.api`:

| Method | Purpose |
|--------|---------|
| `create_bulk_salary_slip` | Create (and optionally submit) a slip for one row |
| `process_bulk_batch_rows` | Process all pending rows in a batch |
| `enqueue_bulk_salary_batch` | Background processing for large batches |
| `reprocess_bulk_salary_row` | Cancel/replace slip and reprocess one row |
| `sync_bulk_batch_slip_status` | Reconcile batch rows with Salary Slip docstatus |
| `create_bulk_accrual_journal_entry` | Batch accrual JE from submitted slips |
| `create_bulk_payment_journal_entry` | One Bank/Cash JE for all unpaid submitted rows |
| `get_salary_payable_account` | Resolve Payroll Payable for payment |
| `get_batch_completed_summary` | Totals, components, JV refs for completed view |
| `get_bulk_attendance_values` | Fetch attendance/check-in days |
| `sync_payroll_bulk_component_rules` | Sync component rules from salary structures |
| `get_payroll_bulk_settings` | Safe settings fetch with multi-company permission fallback |

## Utility scripts

Run via `bench --site your-site execute …`:

```bash
# Sync batch row status from salary slips
payroll_bulk.scripts.sync_batch_rows.run --kwargs '{"batch_name":"BSC-2026-00020"}'

# One-time site setup (holiday list, payable account type)
payroll_bulk.scripts.setup_site_payroll.run --kwargs '{"company":"Your Company","payable_account":"Payroll Payable - CO"}'

# Dev/demo: process, submit, accrue a batch
payroll_bulk.scripts.process_batch_demo.run --kwargs '{"batch_name":"BSC-2026-00020"}'
```

See `payroll_bulk/scripts/` for details.

## Development

```bash
bench --site your-site run-tests --module payroll_bulk.payroll_bulk.doctype.payroll_bulk_settings.test_payroll_bulk_settings
```

Server logic: `payroll_bulk/api.py`, `payroll_bulk/events/salary_slip.py`.

After pulling updates:

```bash
bench build --app payroll_bulk
sudo supervisorctl restart all
bench --site your-site clear-cache
```
