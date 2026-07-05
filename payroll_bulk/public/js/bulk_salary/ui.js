// Payroll Bulk — desk UI, table rendering, employee rows
// ─── 3. MAIN UI ───────────────────────────────────────────────────────────────
async function bs_bootstrap_main_ui(frm) {
  window._bs.settings = await bs_get_settings();
  await render_main_ui(frm);
}

function bs_default_settings() {
  return {
    default_calculation_mode: "Manual",
    default_manual_salary_basis: "Full Month",
    default_overtime_source: "Manual",
    default_per_piece_basis: "Total Hours",
    auto_load_structure_components: 1,
    component_rules: [],
    overtime_doctype: "",
    overtime_employee_field: "",
    overtime_date_field: "",
    overtime_hours_field: "",
    overtime_qty_field: "",
    overtime_rate_field: "",
    hours_component: "",
    qty_component: "",
    default_use_hours: 1,
    default_use_qty: 1,
    default_overtime_with_salary: 0,
    show_department_filter: 1,
    show_branch_filter: 1,
    show_designation_filter: 1,
    show_employee_filter: 1,
    auto_hide_filters: 1,
    enable_filter_fetch: 1,
    enable_manual_add: 1,
    enable_component_configuration: 1,
    default_submit_slips: 1,
  };
}

function bs_auto_hide_filters_enabled() {
  return bs_to_int(window._bs.settings?.auto_hide_filters, 1) === 1;
}

const BS_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function bs_to_int(value, fallback = 0) {
  const num = parseInt(value ?? fallback, 10);
  return Number.isNaN(num) ? fallback : num;
}

function bs_get_mode_attendance_source(mode) {
  if (mode === "Attendance Based") return "Attendance";
  if (mode === "Checkin Based") return "Employee Checkin";
  return "Manual";
}

function bs_is_piece_mode(mode) {
  return mode === "Per Piece or Per Hour";
}

function bs_manual_base_pay(row, daily, basis) {
  basis = basis || "Full Month";
  if (basis === "By Payment Days") {
    const days = parseFloat(row.payment_days || 0);
    return days > 0 ? daily * days : parseFloat(row.ctc || 0);
  }
  if (basis === "Deduct Absent Days") {
    const absent = parseFloat(row.absent_days || 0);
    return absent > 0 ? daily * Math.max(0, 30 - absent) : parseFloat(row.ctc || 0);
  }
  const days = parseFloat(row.payment_days || 0) || 30;
  return daily * days;
}

function bs_effective_salary_days(row, frm) {
  const basis = frm?.doc?.manual_salary_basis || "Full Month";
  if (basis === "By Payment Days") return parseFloat(row.payment_days || 0);
  if (basis === "Deduct Absent Days") return Math.max(0, 30 - parseFloat(row.absent_days || 0));
  return parseFloat(row.payment_days || 0) || 30;
}

function bs_calculate_base_pay(row, frm) {
  const mode = frm?.doc?.calculation_mode || "Manual";
  const daily = parseFloat(row.ctc || 0) / 30;
  const basis = frm?.doc?.manual_salary_basis || "Full Month";

  if (mode === "Attendance Based" || mode === "Checkin Based") {
    const days = parseFloat(row.payment_days || row.attendance_days || 0);
    return daily * days;
  }

  if (bs_is_piece_mode(mode)) {
    const basis = frm?.doc?.per_piece_basis || "Total Hours";
    if (basis === "Total Qty") {
      return parseFloat(row.qty_amount || 0) || 0;
    }
    return parseFloat(row.hours_amount || 0) || 0;
  }

  return bs_manual_base_pay(row, daily, basis);
}

function bs_get_active_company() {
  const selected = window._bs.ctrls?.company_ctrl?.get_value?.();
  return selected || window._bs.frm?.doc?.company || window._bs.settings?.company || frappe.defaults.get_default("company") || "";
}

function bs_get_component_rules() {
  return (window._bs.settings?.component_rules || []).filter((row) => row && row.salary_component);
}

function bs_get_enabled_component_rules() {
  return bs_get_component_rules().filter((row) => bs_to_int(row.enabled, 1) === 1);
}

function bs_should_load_any_components() {
  return (
    bs_to_int(window._bs.settings?.auto_load_structure_components, 1) === 1
    || bs_get_enabled_component_rules().length > 0
  );
}

function bs_get_saved_components_map(frm) {
  const grouped = {};
  (frm.doc.component_entries || []).forEach((entry) => {
    const key = entry.employee_row || entry.employee;
    if (!key) return;
    grouped[key] = grouped[key] || [];
    grouped[key].push({
      employee_row: entry.employee_row || "",
      employee: entry.employee || "",
      salary_component: entry.salary_component || "",
      component_type: entry.component_type || "Earning",
      amount: parseFloat(entry.amount || 0),
    });
  });
  return grouped;
}

function bs_month_from_date(date_str) {
  if (!date_str) return "";
  const month_index = parseInt(String(date_str).split("-")[1] || "0", 10);
  return BS_MONTHS[month_index - 1] || "";
}

function bs_period_bounds_for_month(month_name, reference_date) {
  if (!month_name || !BS_MONTHS.includes(month_name)) {
    return { month: "", start_date: "", end_date: "" };
  }
  const ref = reference_date || frappe.datetime.get_today();
  const year = parseInt(String(ref).split("-")[0] || frappe.datetime.get_today().split("-")[0], 10);
  const month_index = BS_MONTHS.indexOf(month_name) + 1;
  const mm = String(month_index).padStart(2, "0");
  const start_date = `${year}-${mm}-01`;
  const end_day = new Date(year, month_index, 0).getDate();
  const end_date = `${year}-${mm}-${String(end_day).padStart(2, "0")}`;
  return { month: month_name, start_date, end_date };
}

function bs_period_bounds_for_frequency(frequency, posting_date) {
  const posting = posting_date || frappe.datetime.get_today();
  const base_date = frappe.datetime.str_to_obj(posting);
  if (!base_date) {
    return { start_date: posting, end_date: posting };
  }

  let start_date = posting;
  let end_date = posting;

  if (frequency === "Monthly") {
    start_date = frappe.datetime.month_start(posting);
    end_date = frappe.datetime.month_end(posting);
  } else if (frequency === "Weekly") {
    const day = base_date.getDay();
    const monday = new Date(base_date);
    monday.setDate(base_date.getDate() - ((day + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    start_date = frappe.datetime.obj_to_str(monday);
    end_date = frappe.datetime.obj_to_str(sunday);
  } else if (frequency === "Fortnightly") {
    start_date = frappe.datetime.month_start(posting);
    end_date = frappe.datetime.obj_to_str(new Date(base_date.getFullYear(), base_date.getMonth(), 15));
  } else if (frequency === "Bimonthly") {
    const is_first_half = base_date.getDate() <= 15;
    start_date = is_first_half
      ? frappe.datetime.month_start(posting)
      : frappe.datetime.obj_to_str(new Date(base_date.getFullYear(), base_date.getMonth(), 16));
    end_date = is_first_half
      ? frappe.datetime.obj_to_str(new Date(base_date.getFullYear(), base_date.getMonth(), 15))
      : frappe.datetime.month_end(posting);
  }

  return { start_date, end_date };
}

function bs_same_calendar_month(date_a, date_b) {
  if (!date_a || !date_b) return true;
  const a = frappe.datetime.str_to_obj(date_a);
  const b = frappe.datetime.str_to_obj(date_b);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function bs_period_is_consistent(period) {
  if (!period?.start_date || !period?.end_date || !period?.posting_date) return false;
  if (period.start_date > period.end_date) return false;
  if (period.posting_date < period.start_date || period.posting_date > period.end_date) return false;
  if (!bs_same_calendar_month(period.start_date, period.end_date)) return false;
  if (!bs_same_calendar_month(period.start_date, period.posting_date)) return false;
  if (period.month && bs_month_from_date(period.start_date) && bs_month_from_date(period.start_date) !== period.month) {
    return false;
  }
  return true;
}

function bs_normalize_period(period, trigger = "dates") {
  const next = {
    month: period?.month || "",
    payroll_frequency: period?.payroll_frequency || "Monthly",
    start_date: period?.start_date || "",
    end_date: period?.end_date || "",
    posting_date: period?.posting_date || "",
  };
  const ref = next.posting_date || next.end_date || next.start_date || frappe.datetime.get_today();

  if (trigger === "month" && next.month) {
    const bounds = bs_period_bounds_for_month(next.month, ref);
    next.month = bounds.month;
    next.start_date = bounds.start_date;
    next.end_date = bounds.end_date;
    next.posting_date = bounds.end_date;
    next.payroll_frequency = "Monthly";
    return next;
  }

  if (trigger === "frequency") {
    const bounds = bs_period_bounds_for_frequency(next.payroll_frequency, ref);
    next.start_date = bounds.start_date;
    next.end_date = bounds.end_date;
    next.month = bs_month_from_date(next.start_date) || next.month;
    next.posting_date = next.end_date;
    return next;
  }

  if (trigger === "posting") {
    if (next.payroll_frequency === "Monthly" && next.posting_date) {
      const month = bs_month_from_date(next.posting_date);
      const bounds = bs_period_bounds_for_month(month, next.posting_date);
      next.month = bounds.month;
      next.start_date = bounds.start_date;
      next.end_date = bounds.end_date;
      next.posting_date = bounds.end_date;
      return next;
    }
    const bounds = bs_period_bounds_for_frequency(next.payroll_frequency, next.posting_date || ref);
    next.start_date = bounds.start_date;
    next.end_date = bounds.end_date;
    next.month = bs_month_from_date(next.start_date) || next.month;
    if (!next.posting_date || next.posting_date < next.start_date || next.posting_date > next.end_date) {
      next.posting_date = next.end_date;
    }
    return next;
  }

  if (next.start_date && next.end_date && next.start_date > next.end_date) {
    next.end_date = next.start_date;
  }

  if (next.payroll_frequency === "Monthly") {
    const month = next.month || bs_month_from_date(next.start_date || next.end_date || ref);
    if (month) {
      const bounds = bs_period_bounds_for_month(month, next.start_date || next.end_date || ref);
      next.month = bounds.month;
      next.start_date = bounds.start_date;
      next.end_date = bounds.end_date;
      next.posting_date = bounds.end_date;
      return next;
    }
  }

  if (next.start_date) next.month = bs_month_from_date(next.start_date) || next.month;
  if (!next.posting_date || next.posting_date < next.start_date || next.posting_date > next.end_date) {
    next.posting_date = next.end_date || next.start_date;
  }
  return next;
}

function bs_apply_month_period(frm, month_name) {
  if (!month_name || !BS_MONTHS.includes(month_name)) return Promise.resolve();
  const period = bs_normalize_period(
    {
      month: month_name,
      payroll_frequency: frm.doc.payroll_frequency || "Monthly",
      start_date: frm.doc.start_date,
      end_date: frm.doc.end_date,
      posting_date: frm.doc.posting_date,
    },
    "month",
  );
  return bs_set_doc_values(frm, period).then(() => {
    Object.assign(frm.doc, period);
    bs_update_header_period(frm);
  });
}

async function bs_repair_period_from_doc(frm) {
  if (!frm?.doc) return;
  const current = {
    month: frm.doc.month || "",
    payroll_frequency: frm.doc.payroll_frequency || "Monthly",
    start_date: frm.doc.start_date || "",
    end_date: frm.doc.end_date || "",
    posting_date: frm.doc.posting_date || "",
  };
  if (!current.start_date && !current.end_date && current.month) {
    await bs_apply_month_period(frm, current.month);
    return;
  }
  if (bs_period_is_consistent(current)) return;
  const trigger = current.month ? "month" : "dates";
  const period = bs_normalize_period(current, trigger);
  await bs_set_doc_values(frm, period);
  Object.assign(frm.doc, period);
  bs_update_header_period(frm);
}

async function bs_get_settings() {
  const defaults = bs_default_settings();
  try {
    const res = await bs_call("frappe.client.get", {
      doctype: "Payroll Bulk Settings",
      name: "Payroll Bulk Settings",
    });
    return Object.assign({}, defaults, res.message || {});
  } catch (error) {
    console.warn("Payroll Bulk Settings load failed, using defaults.", error);
    return defaults;
  }
}

function bs_apply_source_defaults(frm, settings) {
  frm.doc.company = frm.doc.company || settings.company || frappe.defaults.get_default("company") || "";
  frm.doc.calculation_mode = frm.doc.calculation_mode || settings.default_calculation_mode || "Manual";
  frm.doc.manual_salary_basis = frm.doc.manual_salary_basis || settings.default_manual_salary_basis || "Full Month";
  frm.doc.attendance_source = bs_get_mode_attendance_source(frm.doc.calculation_mode);
  if (!frm.doc.overtime_source) {
    frm.doc.overtime_source = settings.default_overtime_source || bs_get_default_overtime_source(frm.doc.calculation_mode || "Manual", settings);
  }
  frm.doc.per_piece_basis = frm.doc.per_piece_basis || settings.default_per_piece_basis || "Total Hours";
  frm.doc.overtime_doctype = frm.doc.overtime_doctype || settings.overtime_doctype || "";
  frm.doc.overtime_employee_field = frm.doc.overtime_employee_field || settings.overtime_employee_field || "";
  frm.doc.overtime_date_field = frm.doc.overtime_date_field || settings.overtime_date_field || "";
  frm.doc.overtime_hours_field = frm.doc.overtime_hours_field || settings.overtime_hours_field || "";
  frm.doc.overtime_qty_field = frm.doc.overtime_qty_field || settings.overtime_qty_field || "";
  frm.doc.overtime_rate_field = frm.doc.overtime_rate_field || settings.overtime_rate_field || "";
  frm.doc.use_hours = bs_to_int(frm.doc.use_hours ?? settings.default_use_hours, 1);
  frm.doc.use_qty = bs_to_int(frm.doc.use_qty ?? settings.default_use_qty, 1);
  frm.doc.overtime_with_salary = bs_to_int(frm.doc.overtime_with_salary ?? settings.default_overtime_with_salary, 0);
  Object.assign(frm.doc, bs_normalize_source_values(frm.doc));
  if (frm.doc.month && (!frm.doc.start_date || !frm.doc.end_date || !bs_period_is_consistent(frm.doc))) {
    const period = bs_normalize_period(
      {
        month: frm.doc.month,
        payroll_frequency: frm.doc.payroll_frequency || "Monthly",
        start_date: frm.doc.start_date,
        end_date: frm.doc.end_date,
        posting_date: frm.doc.posting_date,
      },
      "month",
    );
    Object.assign(frm.doc, period);
  }
}

function bs_control_get_value(control) {
  if (!control) return "";
  if (typeof control.get_value === "function") return control.get_value() || "";
  if (typeof control.val === "function") return control.val() || "";
  return "";
}

function bs_control_set_value(control, value) {
  const next = value || "";
  if (!control) return;
  if (typeof control.set_value === "function") {
    control.set_value(next);
    return;
  }
  if (typeof control.val === "function") control.val(next);
}

function bs_update_header_period(frm) {
  const month = frm?.doc?.month || "Month not selected";
  const period = frm?.doc?.start_date && frm?.doc?.end_date
    ? `${frm.doc.start_date} → ${frm.doc.end_date}`
    : "Period not selected";
  $("#bs-head-month").text(month);
  $("#bs-head-period").text(period);
  $("#bs-head-month-select").val(frm?.doc?.month || "");
  $("#bs-head-frequency").val(frm?.doc?.payroll_frequency || "Monthly");
  $("#bs-head-start-date").val(frm?.doc?.start_date || "");
  $("#bs-head-end-date").val(frm?.doc?.end_date || "");
  $("#bs-head-posting-date").val(frm?.doc?.posting_date || "");
}

function bs_get_global_piece_flags() {
  return {
    use_hours: $("#bs-global-use-hours").is(":checked") ? 1 : 0,
    use_qty: $("#bs-global-use-qty").is(":checked") ? 1 : 0,
    overtime_with_salary: $("#bs-global-overtime-with-salary").is(":checked") ? 1 : 0,
  };
}

function bs_apply_global_piece_flags_to_rows() {
  const flags = bs_get_global_piece_flags();
  window._bs.global_piece_flags = flags;
  (window._bs.rows || []).forEach((row) => {
    row.use_hours = flags.overtime_with_salary ? 1 : flags.use_hours;
    row.use_qty = flags.use_qty;
    row.overtime_with_salary = flags.overtime_with_salary;
    recalc_row(row);
  });
  if (window._bs.frm) {
    window._bs.frm.doc.use_hours = flags.overtime_with_salary ? 1 : flags.use_hours;
    window._bs.frm.doc.use_qty = flags.use_qty;
    window._bs.frm.doc.overtime_with_salary = flags.overtime_with_salary;
  }
  bs_render_table();
}

function bs_collapse_panel(target) {
  const $panel = $(`#${target}`);
  if (!$panel.length) return;
  $panel.addClass("is-collapsed");
}

function bs_hide_filters() {
  const $area = $("#bs-filters-area");
  if (!$area.length) return;
  $area.addClass("is-hidden");
  $("#bs-toggle-filters-btn").text("☰ Field Mapping");
}

function bs_update_source_mapping_header(frm) {
  const mode = frm?.doc?.calculation_mode || "Manual";
  const use_piece = bs_is_piece_mode(mode);
  const overtime_source = bs_get_active_overtime_source(frm);
  const show_field_mapping = overtime_source === "Custom DocType" || use_piece;
  $(".bs-source-mapping-panel").toggleClass("is-hidden", !show_field_mapping);
  if (!show_field_mapping && !$("#bs-filters-area").hasClass("is-hidden")) {
    bs_hide_filters();
  }
  $("#bs-toggle-filters-btn").toggle(show_field_mapping);
}

function bs_normalize_rows() {
  const seen = new Set();
  window._bs.rows = (window._bs.rows || []).filter((row) => {
    if (!row || !String(row.employee || "").trim()) return false;
    const employee = String(row.employee || "").trim();
    if (seen.has(employee)) return false;
    seen.add(employee);
    row.employee = employee;
    return true;
  });
}

function bs_focus_pending_editable() {
  const next_index = window._bs.next_focus_index;
  if (next_index == null) return;
  window._bs.next_focus_index = null;
  const items = [...document.querySelectorAll("#bs-table-container .bs-editable")];
  const target = items[next_index];
  if (target) {
    target.focus();
    if (typeof target.select === "function") target.select();
  }
}

async function bs_apply_period_controls(frm, trigger = "dates") {
  const period = bs_normalize_period(bs_read_period_from_header(frm), trigger);
  await bs_set_doc_values(frm, period);
  Object.assign(frm.doc, period);
  bs_update_header_period(frm);
  return period;
}

function bs_read_period_from_header(frm) {
  frm = frm || window._bs?.frm;
  const doc = frm?.doc || {};
  const from_dom = {
    month: $("#bs-head-month-select").val() || "",
    payroll_frequency: $("#bs-head-frequency").val() || "",
    start_date: $("#bs-head-start-date").val() || "",
    end_date: $("#bs-head-end-date").val() || "",
    posting_date: $("#bs-head-posting-date").val() || "",
  };
  return {
    month: from_dom.month || doc.month || "",
    payroll_frequency: from_dom.payroll_frequency || doc.payroll_frequency || "Monthly",
    start_date: from_dom.start_date || doc.start_date || "",
    end_date: from_dom.end_date || doc.end_date || "",
    posting_date: from_dom.posting_date || doc.posting_date || "",
  };
}

function bs_sync_period_from_header(frm, trigger = "dates") {
  if (window._bs?._lock_batch_period) {
    return {
      month: frm.doc.month || "",
      payroll_frequency: frm.doc.payroll_frequency || "Monthly",
      start_date: frm.doc.start_date || "",
      end_date: frm.doc.end_date || "",
      posting_date: frm.doc.posting_date || "",
    };
  }
  const current = bs_read_period_from_header(frm);
  if (current.start_date && current.end_date && bs_period_is_consistent(current)) {
    Object.assign(frm.doc, current);
    if (current.start_date) frm.doc.month = bs_month_from_date(current.start_date) || frm.doc.month;
    return current;
  }
  const period = bs_normalize_period(current, trigger);
  Object.assign(frm.doc, period);
  return period;
}

function bs_snapshot_batch_state(frm) {
  return {
    period: {
      month: frm.doc.month || "",
      payroll_frequency: frm.doc.payroll_frequency || "Monthly",
      start_date: frm.doc.start_date || "",
      end_date: frm.doc.end_date || "",
      posting_date: frm.doc.posting_date || "",
      company: frm.doc.company || "",
    },
    rows: JSON.parse(JSON.stringify(window._bs.rows || [])),
  };
}

async function bs_restore_batch_snapshot(frm, snapshot) {
  if (!frm || !snapshot) return;
  Object.assign(frm.doc, snapshot.period);
  window._bs.rows = JSON.parse(JSON.stringify(snapshot.rows || []));
  if (typeof bs_sync_to_frm === "function") bs_sync_to_frm(frm);
  try {
    await new Promise((res, rej) => frm.save("Save", (r) => (r.exc ? rej(new Error(r.exc)) : res(r))));
    await frm.reload_doc();
  } catch (error) {
    console.warn("Batch restore save failed:", error);
  }
  if (typeof bs_bootstrap_main_ui === "function") await bs_bootstrap_main_ui(frm);
}
window.bs_snapshot_batch_state = bs_snapshot_batch_state;
window.bs_restore_batch_snapshot = bs_restore_batch_snapshot;

function bs_period_key(start_date, end_date) {
  return `${start_date || ""}|${end_date || ""}`;
}

function bs_needs_days_load(frm) {
  const mode = frm?.doc?.calculation_mode || "Manual";
  if (["Checkin Based", "Attendance Based"].includes(mode)) return true;
  if (mode === "Manual" && ["By Payment Days", "Deduct Absent Days"].includes(frm.doc.manual_salary_basis || "")) {
    return true;
  }
  return false;
}

function bs_needs_overtime_load(frm) {
  const ot = bs_get_active_overtime_source(frm);
  if (ot === "Manual") return false;
  if (ot === "Employee Checkin Difference") return true;
  if (ot === "Custom DocType") {
    return !!(frm.doc.overtime_doctype || bs_control_get_value(window._bs?.source_ctrls?.overtime_doctype));
  }
  return false;
}

function bs_needs_piece_salary_load(frm) {
  if (!bs_is_piece_mode(frm?.doc?.calculation_mode)) return false;
  return !!(frm.doc.overtime_doctype || bs_control_get_value(window._bs?.source_ctrls?.overtime_doctype));
}

function bs_is_source_driven_mode(frm) {
  return bs_needs_days_load(frm) || bs_needs_overtime_load(frm) || bs_needs_piece_salary_load(frm);
}

function bs_get_days_attendance_source(frm) {
  const mode = frm?.doc?.calculation_mode || "Manual";
  if (mode === "Checkin Based") return "Employee Checkin";
  if (mode === "Attendance Based") return "Attendance";
  if (mode === "Manual") return "Attendance";
  return null;
}

function bs_should_merge_saved_source_metrics(frm) {
  if (bs_get_active_overtime_source(frm) === "Manual") return true;
  if (bs_is_source_driven_mode(frm)) return false;
  return true;
}

function bs_should_restore_saved_ot(frm) {
  return bs_get_active_overtime_source(frm) === "Manual";
}

function bs_clear_row_days(row) {
  row.payment_days = 0;
  row.attendance_days = 0;
  row.absent_days = 0;
  row.attendance_hours = 0;
}

function bs_clear_row_overtime_fields(row) {
  row.ot_input = 0;
  row.ot_amount = 0;
  row.overtime_hours = 0;
  row.worked_hours = 0;
  row.shift_hours = 0;
}

function bs_clear_row_imported_overtime_hours(row) {
  row.worked_hours = 0;
  row.shift_hours = 0;
}

function bs_clear_row_piece_salary(row) {
  row.source_hours = 0;
  row.source_qty = 0;
  row.piece_rate = 0;
  row.source_row_names = [];
  row.hours_amount = 0;
  row.qty_amount = 0;
}

function bs_clear_row_source_metrics(row) {
  bs_clear_row_days(row);
  bs_clear_row_overtime_fields(row);
  bs_clear_row_piece_salary(row);
}

function bs_clear_all_row_days() {
  (window._bs.rows || []).forEach(bs_clear_row_days);
}

function bs_clear_all_row_overtime() {
  (window._bs.rows || []).forEach(bs_clear_row_overtime_fields);
}

function bs_clear_all_row_piece_salary() {
  (window._bs.rows || []).forEach(bs_clear_row_piece_salary);
}

function bs_clear_all_row_source_metrics() {
  (window._bs.rows || []).forEach(bs_clear_row_source_metrics);
}

function bs_bind_control_change(control, handler) {
  if (!control) return;
  if (control.$input) {
    control.$input.on("change blur awesomplete-selectcomplete", handler);
    return;
  }
  control.on("change blur", handler);
}

async function bs_set_doc_values(frm, values) {
  const changed = {};
  Object.entries(values || {}).forEach(([fieldname, value]) => {
    const next = value ?? "";
    if ((frm.doc[fieldname] || "") !== next) changed[fieldname] = next;
  });
  if (!Object.keys(changed).length) return;
  await frm.set_value(changed);
}

function bs_get_active_overtime_source(frm) {
  const mode = frm?.doc?.calculation_mode || "Manual";
  const controls = window._bs?.source_ctrls || {};
  const from_ui = bs_control_get_value(controls.overtime_source);
  if (from_ui) return from_ui;
  if (frm?.doc?.overtime_source) return frm.doc.overtime_source;
  return bs_get_default_overtime_source(mode, window._bs?.settings);
}

function bs_apply_source_metrics_from_doc(frm) {
  if (!frm?.doc?.employees?.length || !window._bs?.rows?.length) return;
  const saved_map = Object.fromEntries(
    frm.doc.employees.filter((row) => row.employee).map((row) => [row.employee, row]),
  );
  window._bs.rows.forEach((row) => {
    const saved = saved_map[row.employee];
    if (!saved) return;
    row.payment_days = parseFloat(saved.payment_days || 0);
    row.attendance_days = parseFloat(saved.attendance_days || 0);
    row.absent_days = parseFloat(saved.absent_days || 0);
    row.attendance_hours = parseFloat(saved.attendance_hours || 0);
    row.worked_hours = parseFloat(saved.worked_hours || 0);
    row.shift_hours = parseFloat(saved.shift_hours || 0);
    row.overtime_hours = parseFloat(saved.overtime_hours || 0);
    row.ot_input = parseFloat(saved.ot_input || 0);
    row.ot_amount = parseFloat(saved.ot_amount || 0);
    recalc_row(row);
  });
  window._bs.loaded_source_period = bs_period_key(frm.doc.start_date, frm.doc.end_date);
}
window.bs_apply_source_metrics_from_doc = bs_apply_source_metrics_from_doc;

function bs_merge_saved_rows_from_frm(frm) {
  if (!frm?.doc?.employees?.length || !window._bs?.rows?.length) return;
  const merge_all = bs_should_merge_saved_source_metrics(frm);
  const merge_ot_only = !merge_all && bs_should_restore_saved_ot(frm);
  const saved_map = Object.fromEntries(
    frm.doc.employees.filter((row) => row.employee).map((row) => [row.employee, row]),
  );
  window._bs.rows.forEach((row) => {
    const saved = saved_map[row.employee];
    if (!saved) return;
    if (merge_all || merge_ot_only) {
      if (merge_all) {
        row.payment_days = parseFloat(saved.payment_days ?? row.payment_days ?? 0);
        row.attendance_days = parseFloat(saved.attendance_days ?? row.attendance_days ?? 0);
        row.absent_days = parseFloat(saved.absent_days ?? row.absent_days ?? 0);
        row.attendance_hours = parseFloat(saved.attendance_hours ?? row.attendance_hours ?? 0);
        row.worked_hours = parseFloat(saved.worked_hours ?? row.worked_hours ?? 0);
        row.shift_hours = parseFloat(saved.shift_hours ?? row.shift_hours ?? 0);
      }
      row.overtime_hours = parseFloat(saved.overtime_hours ?? row.overtime_hours ?? 0);
      row.ot_input = parseFloat(saved.ot_input ?? row.ot_input ?? 0);
      row.ot_amount = parseFloat(saved.ot_amount ?? row.ot_amount ?? 0);
    }
  });
}

function bs_clear_row_imported_overtime(row) {
  row.ot_input = 0;
  row.ot_amount = 0;
  row.overtime_hours = 0;
  row.worked_hours = 0;
  row.shift_hours = 0;
  row.source_hours = 0;
  row.source_qty = 0;
  row.source_row_names = [];
}

function bs_apply_overtime_source_to_rows(frm) {
  const overtime_source = bs_get_active_overtime_source(frm);
  (window._bs.rows || []).forEach((row) => {
    if (overtime_source === "Manual") {
      // Manual OT is user-entered — never wipe ot_input / ot_amount on reload or save.
      bs_clear_row_imported_overtime_hours(row);
    } else {
      bs_clear_row_overtime_fields(row);
    }
    recalc_row(row);
  });
}

async function bs_trigger_source_reload(options = {}) {
  const force = !!options.force;
  const scope = options.scope || "all";
  const frm = window._bs.frm;
  if (!frm || !window._bs.rows.length) return;
  bs_sync_period_from_header(frm);
  await bs_sync_source_doc(frm);
  if (!frm.doc.start_date || !frm.doc.end_date) return;

  const load_days = (force || scope === "all" || scope === "days") && bs_needs_days_load(frm);
  const load_ot = (force || scope === "all" || scope === "overtime") && bs_needs_overtime_load(frm);
  const load_piece = (force || scope === "all" || scope === "piece") && bs_needs_piece_salary_load(frm);

  if (bs_get_active_overtime_source(frm) === "Manual" && (force || scope === "all" || scope === "overtime")) {
    (window._bs.rows || []).forEach((row) => bs_clear_row_imported_overtime_hours(row));
  }

  if (!load_days && !load_ot && !load_piece) {
    bs_render_table();
    bs_render_live_summary(frm);
    return;
  }

  if (force && scope === "all") {
    bs_clear_all_row_days();
    if (load_ot) bs_clear_all_row_overtime();
    if (load_piece) bs_clear_all_row_piece_salary();
  } else if (force && scope === "days") {
    bs_clear_all_row_days();
  } else if (force && scope === "overtime") {
    bs_clear_all_row_overtime();
  } else if (force && scope === "piece") {
    bs_clear_all_row_piece_salary();
  }

  if (load_days) await bs_load_days_data({ silent: true });
  if (load_piece) await bs_load_piece_salary_data({ silent: true });
  if (load_ot) await bs_load_overtime_data({ silent: true });

  bs_render_table();
  bs_render_live_summary(frm);
}
window.bs_trigger_source_reload = bs_trigger_source_reload;

function bs_collect_source_values(frm) {
  const controls = window._bs.source_ctrls || {};
  const calculation_mode = bs_control_get_value(controls.calculation_mode) || frm.doc.calculation_mode || "Manual";
  const raw = {
    month: bs_control_get_value(controls.month) || frm.doc.month || "",
    calculation_mode,
    manual_salary_basis: bs_control_get_value(controls.manual_salary_basis) || frm.doc.manual_salary_basis || "Full Month",
    attendance_source: bs_get_mode_attendance_source(calculation_mode),
    overtime_source: bs_control_get_value(controls.overtime_source) || frm.doc.overtime_source || bs_get_default_overtime_source(calculation_mode, window._bs?.settings),
  per_piece_basis: bs_control_get_value(controls.per_piece_basis) || frm.doc.per_piece_basis || "Total Hours",
    use_hours: (bs_control_get_value(controls.per_piece_basis) || frm.doc.per_piece_basis || "Total Hours") === "Total Hours" ? 1 : 0,
    use_qty: (bs_control_get_value(controls.per_piece_basis) || frm.doc.per_piece_basis || "Total Hours") === "Total Qty" ? 1 : 0,
    overtime_with_salary: 0,
    overtime_doctype: bs_control_get_value(controls.overtime_doctype).trim(),
    overtime_employee_field: bs_control_get_value(controls.overtime_employee_field).trim(),
    overtime_date_field: bs_control_get_value(controls.overtime_date_field).trim(),
    overtime_hours_field: bs_control_get_value(controls.overtime_hours_field).trim(),
    overtime_qty_field: bs_control_get_value(controls.overtime_qty_field).trim(),
    overtime_rate_field: bs_control_get_value(controls.overtime_rate_field).trim(),
  };
  return bs_normalize_source_values(raw);
}

function bs_get_default_overtime_source(mode, settings) {
  const configured = settings?.default_overtime_source;
  if (configured) return configured;
  if (mode === "Checkin Based") return "Employee Checkin Difference";
  return "Manual";
}

function bs_normalize_source_values(values) {
  const next = Object.assign({}, values || {});
  const mode = next.calculation_mode || "Manual";
  if (mode === "Attendance Based" && next.overtime_source === "Employee Checkin Difference") {
    // allowed — overtime source is independent from days mode
  } else if (!next.overtime_source) {
    next.overtime_source = bs_get_default_overtime_source(mode, window._bs?.settings);
  }
  if (bs_is_piece_mode(mode)) {
    next.per_piece_basis = next.per_piece_basis || "Total Hours";
    next.use_hours = next.per_piece_basis === "Total Hours" ? 1 : 0;
    next.use_qty = next.per_piece_basis === "Total Qty" ? 1 : 0;
    next.overtime_with_salary = 0;
  } else {
    next.per_piece_basis = next.per_piece_basis || "Total Hours";
    next.use_hours = bs_to_int(next.use_hours, 1);
    next.use_qty = bs_to_int(next.use_qty, 1);
  }
  if (next.overtime_source === "Custom DocType") {
    // keep mapping fields
  } else if (!bs_is_piece_mode(mode)) {
    next.overtime_qty_field = "";
    next.overtime_rate_field = "";
    next.overtime_doctype = "";
    next.overtime_employee_field = "";
    next.overtime_date_field = "";
    next.overtime_hours_field = "";
  }
  return next;
}

async function bs_sync_source_doc(frm) {
  const values = bs_collect_source_values(frm);
  Object.assign(frm.doc, values);
  await bs_set_doc_values(frm, values);
}

function bs_refresh_source_ui() {
  const frm = window._bs.frm;
  const controls = window._bs.source_ctrls || {};
  if (!frm || !controls.calculation_mode) return;

  const mode = bs_control_get_value(controls.calculation_mode) || "Manual";
  const use_piece = bs_is_piece_mode(mode);
  $(".bs-manual-basis-field").toggle(mode === "Manual");

  const overtime_source = bs_control_get_value(controls.overtime_source) || frm.doc.overtime_source || "Manual";
  $(".bs-overtime-source-field").toggle(true);
  const show_custom_map = overtime_source === "Custom DocType" || use_piece;
  $(".bs-source-map-field").toggle(show_custom_map);
  bs_refresh_overtime_source_options(mode, overtime_source);
  $(".bs-source-hours-field").toggle(show_custom_map);
  $(".bs-source-map-piece").toggle(show_custom_map && use_piece);
  $(".bs-per-piece-basis-field").toggle(use_piece);
  $("#bs-load-source-btn").toggle(
    bs_needs_days_load(frm) || bs_needs_overtime_load(frm) || bs_needs_piece_salary_load(frm),
  );
  bs_update_source_mapping_header(frm);

  let note = "Calculation Mode controls Days / Salary only. Overtime Source controls Overtime column only.";
  if (mode === "Manual") {
    const basis = frm.doc.manual_salary_basis || "Full Month";
    if (basis === "Full Month") note = "Days: manual entry (default 30). Overtime: separate — use Overtime Source filter.";
    if (basis === "By Payment Days") note = "Days: load from Attendance or enter manually. Overtime: separate filter.";
    if (basis === "Deduct Absent Days") note = "Days: from absent count. Overtime: separate filter.";
  }
  if (mode === "Attendance Based") note = "Days: from Attendance doctype. Overtime: Manual, Checkin OUT−IN, or Custom — independent.";
  if (mode === "Checkin Based") note = "Days: from Employee Checkin. Overtime: separate Overtime Source (not mixed with days).";
  if (bs_is_piece_mode(mode)) {
    const basis = frm.doc.per_piece_basis || "Total Hours";
    note = basis === "Total Hours"
      ? "Salary: Hours × hourly rate from custom source. Overtime: separate Overtime Source only."
      : "Salary: Qty × rate from custom source. Overtime: separate Overtime Source only.";
  }
  $("#bs-source-note").text(note);
}

function bs_refresh_overtime_source_options(mode, current_value) {
  const controls = window._bs.source_ctrls || {};
  const $select = controls.overtime_source;
  if (!$select?.length) return;
  const options = [
    { value: "Manual", label: "Manual Entry" },
    { value: "Employee Checkin Difference", label: "Checkin OUT − IN" },
    { value: "Custom DocType", label: "Custom DocType" },
  ];
  const selected = current_value || $select.val() || options[0].value;
  $select.empty();
  options.forEach((opt) => {
    $select.append(`<option value="${opt.value}">${opt.label}</option>`);
  });
  const allowed = options.some((opt) => opt.value === selected);
  $select.val(allowed ? selected : options[0].value);
}

async function bs_get_doctype_field_options(doctype_name) {
  if (!doctype_name) return [];
  window._bs.doctype_field_cache = window._bs.doctype_field_cache || {};
  if (window._bs.doctype_field_cache[doctype_name]) return window._bs.doctype_field_cache[doctype_name];
  const res = await bs_call("payroll_bulk.api.get_doctype_field_options", { doctype_name });
  const fields = res.message || [];
  window._bs.doctype_field_cache[doctype_name] = fields;
  return fields;
}

function bs_filter_source_fields(fields, kind) {
  const is_rate_field = (df) => {
    if (["Float", "Currency", "Int", "Percent", "Duration"].includes(df.fieldtype)) return true;
    const name = String(df.fieldname || "").toLowerCase();
    return df.fieldtype === "Data" && /rate|piece|amount|price|target|qty|hour/.test(name);
  };
  const by_kind = {
    employee: (df) => (df.fieldtype === "Link" && df.options === "Employee") || ["Data", "Dynamic Link", "Select"].includes(df.fieldtype),
    date: (df) => ["Date", "Datetime"].includes(df.fieldtype) || String(df.fieldname || "").startsWith("@parent."),
    number: (df) => ["Float", "Currency", "Int", "Percent", "Duration"].includes(df.fieldtype),
    rate: is_rate_field,
  };
  const matcher = by_kind[kind] || (() => true);
  return (fields || []).filter(matcher);
}

function bs_fill_field_select($select, fields, current_value, placeholder) {
  const ph = placeholder || "Select field";
  const options = [`<option value="" disabled hidden>${frappe.utils.escape_html(ph)}</option>`]
    .concat((fields || []).map((df) => `<option value="${frappe.utils.escape_html(df.fieldname)}">${frappe.utils.escape_html(df.label || df.fieldname)} (${frappe.utils.escape_html(df.fieldname)})</option>`));
  $select.html(options.join(""));
  $select.val(current_value || "");
  if ($select.val() !== (current_value || "")) $select.val("");
}

function bs_guess_source_field(fields, kind) {
  const list = fields || [];
  const picks = {
    employee: ["employee", "employee_id", "employee_code"],
    date: ["date", "posting_date", "attendance_date", "checkin_date", "@parent.date"],
    hours: ["hours", "total_hours", "working_hours", "overtime_hours", "total_overtime_hours"],
    qty: ["qty", "quantity", "total_qty", "piece_qty", "production_qty"],
    rate: ["hourly_rate", "rate", "piece_rate", "per_piece_rate", "rate_per_piece"],
  };
  const wanted = picks[kind] || [];
  const hit = list.find((df) => wanted.includes(String(df.fieldname || "").toLowerCase()));
  return hit?.fieldname || "";
}

async function bs_restore_source_controls_from_doc(frm) {
  const controls = window._bs?.source_ctrls || {};
  if (!frm || !controls.calculation_mode) return;
  const settings = window._bs.settings || {};
  const mode = frm.doc.calculation_mode || settings.default_calculation_mode || "Manual";
  let overtime_source = frm.doc.overtime_source || "";
  if (!overtime_source) {
    overtime_source = bs_get_default_overtime_source(mode, window._bs?.settings);
  }
  if (mode === "Attendance Based" && overtime_source === "Employee Checkin Difference") {
    overtime_source = "Manual";
  }
  bs_control_set_value(controls.calculation_mode, mode);
  bs_control_set_value(controls.manual_salary_basis, frm.doc.manual_salary_basis || settings.default_manual_salary_basis || "Full Month");
  bs_refresh_overtime_source_options(mode, overtime_source);
  bs_control_set_value(controls.overtime_source, overtime_source);
  frm.doc.overtime_source = overtime_source;
  bs_control_set_value(controls.per_piece_basis, frm.doc.per_piece_basis || "Total Hours");
  if (controls.global_use_hours) {
    controls.global_use_hours.prop("checked", bs_to_int(frm.doc.use_hours ?? settings.default_use_hours, 1));
  }
  if (controls.global_use_qty) {
    controls.global_use_qty.prop("checked", bs_to_int(frm.doc.use_qty ?? settings.default_use_qty, 1));
  }
  if (controls.global_overtime_with_salary) {
    controls.global_overtime_with_salary.prop("checked", bs_to_int(frm.doc.overtime_with_salary ?? settings.default_overtime_with_salary, 0));
  }
  window._bs.global_piece_flags = bs_get_global_piece_flags();
  const doctype = frm.doc.overtime_doctype || settings.overtime_doctype || "";
  bs_control_set_value(controls.overtime_doctype, doctype);
  if (doctype) frm.doc.overtime_doctype = doctype;
  await bs_refresh_source_field_options(frm);
  bs_refresh_source_ui();
}
window.bs_restore_source_controls_from_doc = bs_restore_source_controls_from_doc;

async function bs_refresh_source_field_options(frm) {
  const controls = window._bs.source_ctrls || {};
  const doctype_name = bs_control_get_value(controls.overtime_doctype) || frm.doc.overtime_doctype || "";
  if (!doctype_name) {
    ["overtime_employee_field", "overtime_date_field", "overtime_hours_field", "overtime_qty_field", "overtime_rate_field"].forEach((key) => {
      if (controls[key]) bs_fill_field_select(controls[key], [], "", "Select field");
    });
    return;
  }
  const fields = await bs_get_doctype_field_options(doctype_name);
  const employee_fields = bs_filter_source_fields(fields, "employee");
  const date_fields = bs_filter_source_fields(fields, "date");
  const number_fields = bs_filter_source_fields(fields, "number");
  const rate_fields = bs_filter_source_fields(fields, "rate");
  const settings = window._bs.settings || {};
  const pick = (doc_key, control_key, guess_kind, field_list) => {
    const saved = (frm.doc[doc_key] || bs_control_get_value(controls[control_key]) || "").trim();
    if (saved && (field_list || []).some((df) => df.fieldname === saved)) return saved;
    return saved || settings[doc_key] || bs_guess_source_field(field_list, guess_kind);
  };
  frm.doc.overtime_employee_field = pick("overtime_employee_field", "overtime_employee_field", "employee", employee_fields);
  frm.doc.overtime_date_field = pick("overtime_date_field", "overtime_date_field", "date", date_fields);
  frm.doc.overtime_hours_field = pick("overtime_hours_field", "overtime_hours_field", "hours", number_fields);
  frm.doc.overtime_qty_field = pick("overtime_qty_field", "overtime_qty_field", "qty", number_fields);
  frm.doc.overtime_rate_field = pick("overtime_rate_field", "overtime_rate_field", "rate", rate_fields);
  bs_fill_field_select(controls.overtime_employee_field, employee_fields, frm.doc.overtime_employee_field, "Employee Field");
  bs_fill_field_select(controls.overtime_date_field, date_fields, frm.doc.overtime_date_field, "Date Field");
  bs_fill_field_select(controls.overtime_hours_field, number_fields, frm.doc.overtime_hours_field, "Hours Field");
  bs_fill_field_select(controls.overtime_qty_field, number_fields, frm.doc.overtime_qty_field, "Qty Field");
  bs_fill_field_select(controls.overtime_rate_field, rate_fields, frm.doc.overtime_rate_field, "Rate Field");
}

async function bs_bind_source_controls(frm, settings, $wrap) {
  const make_link = (selector, fieldname, options) => {
    const parent = $wrap.find(selector).empty()[0];
    const ctrl = frappe.ui.form.make_control({
      parent,
      df: {
        fieldname,
        fieldtype: "Link",
        label: "",
        options,
        placeholder: "Source DocType",
      },
      render_input: true,
    });
    ctrl.get_query = () => ({
      filters: {
        issingle: 0,
      },
    });
    ctrl.refresh();
    return ctrl;
  };

  const source_ctrls = {
    calculation_mode: $wrap.find("#bs-calculation-mode"),
    manual_salary_basis: $wrap.find("#bs-manual-salary-basis"),
    overtime_source: $wrap.find("#bs-overtime-source"),
    per_piece_basis: $wrap.find("#bs-per-piece-basis"),
    global_use_hours: $wrap.find("#bs-global-use-hours"),
    global_use_qty: $wrap.find("#bs-global-use-qty"),
    global_overtime_with_salary: $wrap.find("#bs-global-overtime-with-salary"),
    overtime_doctype: make_link("#bs-overtime-doctype-wrap", "overtime_doctype_picker", "DocType"),
    overtime_employee_field: $wrap.find("#bs-overtime-employee-field"),
    overtime_date_field: $wrap.find("#bs-overtime-date-field"),
    overtime_hours_field: $wrap.find("#bs-overtime-hours-field"),
    overtime_qty_field: $wrap.find("#bs-overtime-qty-field"),
    overtime_rate_field: $wrap.find("#bs-overtime-rate-field"),
  };
  window._bs.source_ctrls = source_ctrls;

  bs_control_set_value(source_ctrls.calculation_mode, frm.doc.calculation_mode || "Manual");
  bs_control_set_value(source_ctrls.manual_salary_basis, frm.doc.manual_salary_basis || settings.default_manual_salary_basis || "Full Month");
  const bind_mode = frm.doc.calculation_mode || "Manual";
  let overtime_source = frm.doc.overtime_source || "";
  if (!overtime_source) {
    overtime_source = bs_get_default_overtime_source(bind_mode, settings);
  }
  if (bind_mode === "Attendance Based" && overtime_source === "Employee Checkin Difference") {
    overtime_source = "Manual";
  }
  bs_refresh_overtime_source_options(bind_mode, overtime_source);
  bs_control_set_value(source_ctrls.overtime_source, overtime_source);
  frm.doc.overtime_source = overtime_source;
  bs_control_set_value(source_ctrls.per_piece_basis, frm.doc.per_piece_basis || "Total Hours");
  source_ctrls.global_use_hours.prop("checked", bs_to_int(settings.default_use_hours, 1));
  source_ctrls.global_use_qty.prop("checked", bs_to_int(settings.default_use_qty, 1));
  source_ctrls.global_overtime_with_salary.prop("checked", bs_to_int(settings.default_overtime_with_salary, 0));
  window._bs.global_piece_flags = bs_get_global_piece_flags();
  bs_control_set_value(source_ctrls.overtime_doctype, frm.doc.overtime_doctype || settings.overtime_doctype || "");
  await bs_refresh_source_field_options(frm);

  Object.entries(source_ctrls).forEach(([key, control]) => {
    if (["global_use_hours", "global_use_qty", "global_overtime_with_salary"].includes(key)) return;
    bs_bind_control_change(control, async () => {
      if (["calculation_mode", "manual_salary_basis", "overtime_source", "per_piece_basis"].includes(key)) {
        const normalized = bs_normalize_source_values(bs_collect_source_values(frm));
        Object.assign(frm.doc, normalized);
        if (key === "calculation_mode") {
          const settings = window._bs.settings || {};
          if (normalized.overtime_source === "Custom DocType") {
            if (!normalized.overtime_doctype) {
              normalized.overtime_doctype = frm.doc.overtime_doctype || settings.overtime_doctype || "";
            }
            if (normalized.overtime_doctype) {
              bs_control_set_value(source_ctrls.overtime_doctype, normalized.overtime_doctype);
            }
          }
          bs_control_set_value(source_ctrls.overtime_source, normalized.overtime_source);
          bs_refresh_overtime_source_options(normalized.calculation_mode, normalized.overtime_source);
        }
        bs_control_set_value(source_ctrls.per_piece_basis, normalized.per_piece_basis || "Total Hours");
      }
      await bs_sync_source_doc(frm);
      if (["overtime_doctype", "calculation_mode", "manual_salary_basis", "overtime_source", "per_piece_basis"].includes(key)) {
        await bs_refresh_source_field_options(frm);
      }
      if (["calculation_mode", "manual_salary_basis"].includes(key) && window._bs.rows.length) {
        await bs_trigger_source_reload({ force: true, scope: "days" });
        if (bs_is_piece_mode(frm.doc.calculation_mode)) {
          await bs_trigger_source_reload({ force: true, scope: "piece" });
        }
        return;
      }
      if (["per_piece_basis"].includes(key) && window._bs.rows.length) {
        await bs_trigger_source_reload({ force: true, scope: "piece" });
        return;
      }
      if ([
        "overtime_doctype", "overtime_employee_field", "overtime_date_field",
        "overtime_hours_field", "overtime_qty_field", "overtime_rate_field",
      ].includes(key) && window._bs.rows.length) {
        if (bs_is_piece_mode(frm.doc.calculation_mode)) {
          await bs_trigger_source_reload({ force: true, scope: "piece" });
        }
        if (bs_get_active_overtime_source(frm) === "Custom DocType") {
          await bs_trigger_source_reload({ force: true, scope: "overtime" });
        }
        return;
      }
      if (["overtime_source"].includes(key) && window._bs.rows.length) {
        await bs_trigger_source_reload({ force: true, scope: "overtime" });
        return;
      }
      bs_update_header_period(frm);
      bs_refresh_source_ui();
      window._bs.rows.forEach(recalc_row);
      bs_render_table();
    });
  });

  source_ctrls.per_piece_basis.on("change", () => {
    const basis = bs_control_get_value(source_ctrls.per_piece_basis) || "Total Hours";
    source_ctrls.global_use_hours.prop("checked", basis === "Total Hours");
    source_ctrls.global_use_qty.prop("checked", basis === "Total Qty");
  });

  await bs_sync_source_doc(frm);
  bs_refresh_source_ui();
}

async function render_main_ui(frm) {
  window._bs.frm     = frm;
  window._bs.rows    = [];
  window._bs.counter = 0;
  window._bs.global_piece_flags = null;
  const settings = window._bs.settings || bs_default_settings();
  bs_apply_source_defaults(frm, settings);
  const saved_components_map = bs_get_saved_components_map(frm);
  const show_fetch_filters = !!(settings.enable_filter_fetch && (bs_to_int(settings.show_department_filter, 1) || bs_to_int(settings.show_branch_filter, 1) || bs_to_int(settings.show_designation_filter, 1)));
  const show_manual_employee = !!(settings.enable_manual_add && bs_to_int(settings.show_employee_filter, 1));
  const show_filter_row = true;

  const source_driven_days = bs_needs_days_load(frm) || bs_needs_piece_salary_load(frm);
  const source_driven_ot = bs_needs_overtime_load(frm);

  // Restore from saved draft
  if (frm.doc.employees && frm.doc.employees.length) {
    frm.doc.employees.forEach((r) => {
      if (!r.employee) return;
      window._bs.rows.push({
        _id:            ++window._bs.counter,
        row_name:       r.name || "",
        employee:       r.employee      || "",
        employee_name:  r.employee_name || "",
        department:     r.department    || "",
        designation:    r.designation   || "",
        ctc:            parseFloat(r.ctc || 0),
        ot_type:        "hours",
        ot_input:       source_driven_ot ? 0 : parseFloat(r.ot_input || 0),
        ot_amount:      source_driven_ot ? 0 : parseFloat(r.ot_amount || 0),
        bonus_amount:   parseFloat(r.bonus_amount || 0),
        other_allowance:parseFloat(r.other_allowance || 0),
        source_hours:   parseFloat(r.source_hours || 0),
        source_qty:     parseFloat(r.source_qty || 0),
        piece_rate:     parseFloat(r.piece_rate || 0),
        use_hours:      ("use_hours" in r) ? parseInt(r.use_hours || 0, 10) : 1,
        use_qty:        ("use_qty" in r) ? parseInt(r.use_qty || 0, 10) : 1,
        overtime_with_salary: ("overtime_with_salary" in frm.doc) ? parseInt(frm.doc.overtime_with_salary || 0, 10) : bs_to_int(settings.default_overtime_with_salary, 0),
        source_row_names: [],
        attendance_days: source_driven_days ? 0 : parseFloat(r.attendance_days || 0),
        absent_days:    source_driven_days ? 0 : parseFloat(r.absent_days || 0),
        attendance_hours: source_driven_days ? 0 : parseFloat(r.attendance_hours || 0),
        payment_days:   source_driven_days ? 0 : (parseFloat(r.payment_days || 0) || (frm.doc.calculation_mode === "Manual" ? 30 : 0)),
        worked_hours:   source_driven_ot ? 0 : parseFloat(r.worked_hours || 0),
        shift_hours:    source_driven_ot ? 0 : parseFloat(r.shift_hours || 0),
        overtime_hours: source_driven_ot ? 0 : parseFloat(r.overtime_hours || 0),
        gross:          parseFloat(r.gross_pay || r.gross || 0),
        advances:       [],
        advance_balance:parseFloat(r.advance_balance || 0),
        adv_fetched:    parseFloat(r.advance_balance || 0) > 0 || parseFloat(r.adv_deduct || 0) > 0,
        adv_deduct:     parseFloat(r.adv_deduct || 0),
        late_deduction: parseFloat(r.late_deduction || 0),
        other_deduction:parseFloat(r.other_deduction || 0),
        total_additions:parseFloat(r.total_additions || 0),
        total_deductions:parseFloat(r.total_deductions || 0),
        net:            parseFloat(r.net_pay || r.net || 0),
        status:         r.status || "Pending",
        salary_slip_status: r.salary_slip_status || "",
        payment_status: r.payment_status || "Not Paid",
        salary_structure: r.salary_structure || "",
        salary_structure_assignment: r.salary_structure_assignment || "",
        payroll_payable_account: r.payroll_payable_account || "",
        structure_base: parseFloat(r.structure_base || 0),
        structure_warning: r.structure_warning || "",
        salary_slip:    r.salary_slip || "",
        payment_entry:  r.payment_entry || "",
        slip_cancelled_on: r.slip_cancelled_on || "",
        error_message:  r.error_message || "",
        _saved_component_map: bs_saved_components_to_map(saved_components_map[r.name] || saved_components_map[r.employee] || []),
        components: (saved_components_map[r.name] || saved_components_map[r.employee] || []).map((item) => ({
          key: bs_normalize_component_key(item.component_type, item.salary_component),
          component: item.salary_component,
          label: item.salary_component,
          type: item.component_type || "Earning",
          amount: parseFloat(item.amount || 0),
          auto_calculated: false,
        })),
        piece_basis: r.piece_basis || frm.doc.per_piece_basis || settings.default_per_piece_basis || "Total Hours",
      });
      recalc_row(window._bs.rows[window._bs.rows.length - 1]);
      bs_hydrate_row_advances(window._bs.rows[window._bs.rows.length - 1]);
      bs_apply_saved_component_map(window._bs.rows[window._bs.rows.length - 1]);
      recalc_row(window._bs.rows[window._bs.rows.length - 1]);
    });
  }
  bs_normalize_rows();

  const $body = frm.layout.wrapper.find(".form-page");
  $body.find("#bs-main-wrap").remove();

  const $wrap = $(`
    <div id="bs-main-wrap"><div class="bs-wrap">

      <div class="bs-title-container">
        <div class="bs-header-top">
          <div class="bs-header-main">
            <div class="bs-header-icon">SAL</div>
            <div>
              <div class="bs-header-title">Bulk Salary Creation</div>
              <div class="bs-header-period-bar">
                <select id="bs-head-month-select" class="bs-select-sm">
                  <option value="" disabled hidden>Month</option>
                  ${BS_MONTHS.map((month) => `<option value="${month}" ${frm.doc.month === month ? "selected" : ""}>${month}</option>`).join("")}
                </select>
                <select id="bs-head-frequency" class="bs-select-sm">
                  ${["Monthly","Bimonthly","Fortnightly","Weekly","Daily"].map((freq) => `<option value="${freq}" ${(frm.doc.payroll_frequency || "Monthly") === freq ? "selected" : ""}>${freq}</option>`).join("")}
                </select>
                <input id="bs-head-start-date" class="bs-select-sm bs-date-sm" type="date" value="${frm.doc.start_date || ""}" />
                <input id="bs-head-end-date" class="bs-select-sm bs-date-sm" type="date" value="${frm.doc.end_date || ""}" />
                <span class="bs-head-inline-label">Posting Date</span><input id="bs-head-posting-date" class="bs-select-sm bs-date-sm" type="date" value="${frm.doc.posting_date || ""}" />
              </div>
            </div>
          </div>
          <div class="bs-header-tools">
            <div class="bs-header-meta">
              <span class="bs-head-pill" id="bs-head-month">${frm.doc.month || "Month not selected"}</span>
              <span class="bs-head-pill" id="bs-head-period">${frm.doc.start_date && frm.doc.end_date ? `${frm.doc.start_date} → ${frm.doc.end_date}` : "Period not selected"}</span>
            </div>
            <button class="bs-btn-secondary" id="bs-toggle-filters-btn">☰ Field Mapping</button>
          </div>
        </div>

        ${show_filter_row ? `
        <div class="bs-title-section bs-filter-stack">
          <div class="bs-inline-filter-row bs-find-employees-bar">
            <div class="bs-row-title">Find Employees</div>
            <div class="bs-inline-filter-fields">
              <div class="bs-filter-field bs-filter-field-inline"><div id="bs-company-wrap"></div></div>
              ${bs_to_int(settings.show_department_filter, 1) ? `<div class="bs-filter-field bs-filter-field-inline"><div id="bs-dept-wrap"></div></div>` : ``}
              ${bs_to_int(settings.show_branch_filter, 1) ? `<div class="bs-filter-field bs-filter-field-inline"><div id="bs-branch-wrap"></div></div>` : ``}
              ${bs_to_int(settings.show_designation_filter, 1) ? `<div class="bs-filter-field bs-filter-field-inline"><div id="bs-desig-wrap"></div></div>` : ``}
              ${show_manual_employee ? `<div class="bs-filter-field bs-filter-field-inline"><div id="bs-emp-link-wrap"></div></div>` : ``}
            </div>
          </div>

          <div class="bs-inline-filter-row bs-calculation-bar">
            <div class="bs-row-title">Calculation</div>
            <div class="bs-inline-filter-fields">
              <div class="bs-filter-field bs-filter-field-inline">
                <select id="bs-calculation-mode" class="bs-select-sm bs-select-full" title="Mode">
                  <option value="" disabled hidden>Mode</option>
                  <option value="Manual">Manual</option>
                  <option value="Attendance Based">Attendance Based</option>
                  <option value="Checkin Based">Checkin Based</option>
                  <option value="Per Piece or Per Hour">Per Piece or Per Hour</option>
                </select>
              </div>
              <div class="bs-filter-field bs-filter-field-inline bs-overtime-source-field">
                <select id="bs-overtime-source" class="bs-select-sm bs-select-full" title="Overtime Source">
                  <option value="" disabled hidden>Overtime Source</option>
                  <option value="Manual">Manual Entry</option>
                  <option value="Employee Checkin Difference">Checkin OUT − IN</option>
                  <option value="Custom DocType">Custom DocType</option>
                </select>
              </div>
              <div class="bs-filter-field bs-filter-field-inline bs-manual-basis-field">
                <select id="bs-manual-salary-basis" class="bs-select-sm bs-select-full" title="Salary Basis">
                  <option value="" disabled hidden>Salary Basis</option>
                  <option value="Full Month">Full Month</option>
                  <option value="By Payment Days">By Payment Days</option>
                  <option value="Deduct Absent Days">Deduct Absent Days</option>
                </select>
              </div>
              <div class="bs-filter-field bs-filter-field-inline bs-per-piece-basis-field">
                <select id="bs-per-piece-basis" class="bs-select-sm bs-select-full" title="Piece Basis">
                  <option value="" disabled hidden>Piece Basis</option>
                  <option value="Total Hours">Total Hours</option>
                  <option value="Total Qty">Total Qty</option>
                </select>
              </div>
              <input id="bs-global-use-hours" type="checkbox" hidden />
              <input id="bs-global-use-qty" type="checkbox" hidden />
              <input id="bs-global-overtime-with-salary" type="checkbox" hidden />
            </div>
          </div>

          <div class="bs-inline-filter-row bs-employee-actions-row">
            <div class="bs-row-title bs-row-title-spacer"></div>
            <div class="bs-inline-filter-actions">
              ${show_fetch_filters ? `<button class="bs-btn-primary bs-filter-action-btn" id="bs-fetch-btn">Fetch Employees</button>` : ``}
              ${show_manual_employee ? `<button class="bs-btn-secondary bs-filter-action-btn" id="bs-add-btn">Add Selected</button>` : ``}
            </div>
          </div>
        </div>
        ` : `
        <div class="bs-title-section bs-inline-filter-row bs-calculation-bar">
          <div class="bs-row-title">Calculation</div>
          <div class="bs-inline-filter-fields">
            <div class="bs-filter-field bs-filter-field-inline">
              <select id="bs-calculation-mode" class="bs-select-sm bs-select-full" title="Mode">
                <option value="" disabled hidden>Mode</option>
                <option value="Manual">Manual</option>
                <option value="Attendance Based">Attendance Based</option>
                <option value="Checkin Based">Checkin Based</option>
                <option value="Per Piece or Per Hour">Per Piece or Per Hour</option>
              </select>
            </div>
            <div class="bs-filter-field bs-filter-field-inline bs-overtime-source-field">
              <select id="bs-overtime-source" class="bs-select-sm bs-select-full" title="Overtime Source">
                <option value="" disabled hidden>Overtime Source</option>
                <option value="Manual">Manual Entry</option>
                <option value="Employee Checkin Difference">Checkin OUT − IN</option>
                <option value="Custom DocType">Custom DocType</option>
              </select>
            </div>
            <div class="bs-filter-field bs-filter-field-inline bs-manual-basis-field">
              <select id="bs-manual-salary-basis" class="bs-select-sm bs-select-full" title="Salary Basis">
                <option value="" disabled hidden>Salary Basis</option>
                <option value="Full Month">Full Month</option>
                <option value="By Payment Days">By Payment Days</option>
                <option value="Deduct Absent Days">Deduct Absent Days</option>
              </select>
            </div>
            <div class="bs-filter-field bs-filter-field-inline bs-per-piece-basis-field">
              <select id="bs-per-piece-basis" class="bs-select-sm bs-select-full" title="Piece Basis">
                <option value="" disabled hidden>Piece Basis</option>
                <option value="Total Hours">Total Hours</option>
                <option value="Total Qty">Total Qty</option>
              </select>
            </div>
            <input id="bs-global-use-hours" type="checkbox" hidden />
            <input id="bs-global-use-qty" type="checkbox" hidden />
            <input id="bs-global-overtime-with-salary" type="checkbox" hidden />
          </div>
        </div>
        `}
      </div>

      <div id="bs-filters-area" class="bs-filters-area is-hidden">
      <div class="bs-filter-card" id="bs-filter-panel">
        <div class="bs-source-mapping-panel bs-source-section">
          <div class="bs-source-mapping-row">
            <div class="bs-row-title bs-row-title-source">Source Mapping</div>
            <div class="bs-source-mapping-fields">
              <div class="bs-source-map-field bs-source-doctype-cell"><div id="bs-overtime-doctype-wrap"></div></div>
              <div class="bs-source-map-field"><select id="bs-overtime-employee-field" class="bs-select-sm bs-select-full" title="Employee Field"><option value="" disabled hidden>Employee Field</option></select></div>
              <div class="bs-source-map-field"><select id="bs-overtime-date-field" class="bs-select-sm bs-select-full" title="Date Field"><option value="" disabled hidden>Date Field</option></select></div>
              <div class="bs-source-map-field bs-source-hours-field"><select id="bs-overtime-hours-field" class="bs-select-sm bs-select-full" title="Hours Field"><option value="" disabled hidden>Hours Field</option></select></div>
              <div class="bs-source-map-field bs-source-map-piece"><select id="bs-overtime-qty-field" class="bs-select-sm bs-select-full" title="Qty Field"><option value="" disabled hidden>Qty Field</option></select></div>
              <div class="bs-source-map-field bs-source-map-piece"><select id="bs-overtime-rate-field" class="bs-select-sm bs-select-full" title="Rate Field"><option value="" disabled hidden>Rate Field</option></select></div>
              <div class="bs-source-mapping-actions">
                <button class="bs-btn-secondary bs-filter-action-btn" id="bs-load-source-btn" style="display:none">Load Source Data</button>
              </div>
            </div>
          </div>
        </div>
        <div id="bs-fetch-notice" style="display:none" class="bs-notice bs-notice-info"></div>
        <div id="bs-add-notice" style="display:none" class="bs-notice bs-notice-warn"></div>
        <div id="bs-source-note" class="bs-source-note"></div>
      </div>
      ${settings.enable_component_configuration ? `
      <div class="bs-panel bs-mb" id="bs-component-panel" style="display:none">
        <div class="bs-config-grid">
          <div class="bs-field-wrap"><label class="bs-label">Overtime Component</label><div id="bs-ot-component-wrap"></div></div>
          <div class="bs-field-wrap"><label class="bs-label">Bonus Component</label><div id="bs-bonus-component-wrap"></div></div>
          <div class="bs-field-wrap"><label class="bs-label">Allowance Component</label><div id="bs-allowance-component-wrap"></div></div>
          <div class="bs-field-wrap"><label class="bs-label">Late Deduction Component</label><div id="bs-late-component-wrap"></div></div>
          <div class="bs-field-wrap"><label class="bs-label">Other Deduction Component</label><div id="bs-deduction-component-wrap"></div></div>
        </div>
      </div>` : ``}
      </div>

      <!-- Employee table -->
      <div class="bs-section-label" style="display:flex;justify-content:space-between;align-items:center">
        <span>Employee Salary Inputs</span>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="bs-row-count" class="bs-pill">0 employees</span>
          <button class="bs-btn-ghost" id="bs-fetch-advances-btn" style="display:none">
            🔄 Fetch All Advances
          </button>
        </div>
      </div>
      <div class="bs-search-filter-row">
        <div class="bs-search-row">
          <input id="bs-search-input" class="bs-search-input" type="text" placeholder="Search employee, name, department, slip no..." />
        </div>
        <div class="bs-filter-bar" id="bs-filter-bar">
          <button class="bs-filter-btn is-active" data-filter="all">All</button>
          <button class="bs-filter-btn" data-filter="pending">Pending</button>
          <button class="bs-filter-btn" data-filter="submitted">Submitted</button>
          <button class="bs-filter-btn" data-filter="failed">Failed</button>
          <button class="bs-filter-btn" data-filter="cancelled">Cancelled</button>
          <button class="bs-filter-btn" data-filter="paid">Paid</button>
        </div>
      </div>
      <div class="bs-table-wrap" id="bs-table-container">
        <div class="bs-empty">No employees added yet.</div>
      </div>

      <div class="bs-footer-row">
        <span class="bs-footer-hint">Expand a row for components, structure, and advances. Use ⋮ menu for slip actions.</span>
        <span id="bs-total-display" class="bs-total-badge" style="display:none"></span>
      </div>

      <div class="bs-summary-totals bs-live-summary" id="bs-live-summary">
        <div class="bs-total-card">
          <div class="bs-total-label">Employees</div>
          <div class="bs-total-value" id="bs-card-employees">0</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Gross</div>
          <div class="bs-total-value" id="bs-card-gross">0.00</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Deductions</div>
          <div class="bs-total-value" id="bs-card-deductions">0.00</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Net</div>
          <div class="bs-total-value" id="bs-card-net">0.00</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Submitted</div>
          <div class="bs-total-value" id="bs-card-submitted">0</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Cancelled</div>
          <div class="bs-total-value" id="bs-card-cancelled">0</div>
        </div>
      </div>
      <div id="bs-structure-summary" style="display:none" class="bs-notice bs-notice-error bs-mb"></div>

      <!-- Action bar -->
      <div class="bs-action-bar">
        <div class="bs-action-groups">
          <div class="bs-action-group">
            <button class="bs-btn-secondary" id="bs-refresh-all-btn">Refresh Status</button>
            <button class="bs-btn-secondary" id="bs-open-submitted-btn">Open Slips</button>
            <button class="bs-btn-secondary" id="bs-submit-drafts-btn">Submit Drafts</button>
          </div>
          <div class="bs-action-group">
            <button class="bs-btn-secondary" id="bs-create-accrual-btn">Accrual JE</button>
            <button class="bs-btn-secondary" id="bs-create-missing-btn">Create Missing</button>
          </div>
          <button class="bs-btn-secondary" id="bs-save-draft-btn">Save Draft</button>
          <button class="bs-btn-secondary bs-btn-danger-outline" id="bs-reset-batch-btn">Reset / Cancel All</button>
        </div>
        <button class="bs-btn-primary bs-btn-lg" id="bs-review-btn">Review &amp; Create Draft Slips →</button>
      </div>

    </div></div>
  `);

  $body.prepend($wrap);
  if (typeof bs_tidy_form_after_ui === "function") bs_tidy_form_after_ui(frm);

  // ── Link controls ────────────────────────────────────────────────────────
  const make_link = (parent_id, fieldname, options, placeholder) => {
    const ctrl = frappe.ui.form.make_control({
      parent: $wrap.find(parent_id)[0],
      df: { fieldtype: "Link", fieldname, options, placeholder, reqd: 0 },
      render_input: true,
    });
    ctrl.refresh();
    return ctrl;
  };

  const company_ctrl = make_link("#bs-company-wrap", "bs_company", "Company", "Company");
  const dept_ctrl   = settings.enable_filter_fetch && bs_to_int(settings.show_department_filter, 1) ? make_link("#bs-dept-wrap",   "bs_dept",   "Department",  "Department") : null;
  const branch_ctrl = settings.enable_filter_fetch && bs_to_int(settings.show_branch_filter, 1) ? make_link("#bs-branch-wrap",  "bs_branch", "Branch",      "Branch") : null;
  const desig_ctrl  = settings.enable_filter_fetch && bs_to_int(settings.show_designation_filter, 1) ? make_link("#bs-desig-wrap",   "bs_desig",  "Designation", "Designation") : null;
  const emp_ctrl    = settings.enable_manual_add && bs_to_int(settings.show_employee_filter, 1) ? make_link("#bs-emp-link-wrap", "bs_emp",    "Employee",    "Employee") : null;
  company_ctrl && company_ctrl.set_value(frm.doc.company || settings.company || frappe.defaults.get_default("company") || "");

  window._bs.ctrls = {
    company_ctrl, dept_ctrl, branch_ctrl, desig_ctrl, emp_ctrl,
  };
  window._bs._sel  = { emp: "", name: "", dept: "", desig: "" };

  if (emp_ctrl) {
    emp_ctrl.get_query = () => {
      const filters = { status: "Active" };
      const company = bs_get_active_company();
      if (company) filters.company = company;
      return { filters };
    };
  }

  company_ctrl && company_ctrl.$input.on("change blur awesomplete-selectcomplete", async () => {
    const company = company_ctrl.get_value() || settings.company || frappe.defaults.get_default("company") || "";
    await bs_set_doc_values(frm, { company });
    window._bs._sel = { emp: "", name: "", dept: "", desig: "", ctc: 0 };
    if (emp_ctrl) {
      emp_ctrl.set_value("");
      emp_ctrl.$input.val("");
    }
    if (window._bs.rows.length) {
      await bs_refresh_structure_assignments(window._bs.rows);
      window._bs.rows.forEach(recalc_row);
      bs_render_table();
    }
  });

  emp_ctrl && emp_ctrl.$input.on("awesomplete-selectcomplete", function () {
    const v = emp_ctrl.$input.val().trim();
    window._bs._sel.emp = v;
    frappe.call({
      method: "frappe.client.get_value",
      args: { doctype: "Employee", filters: { name: v },
              fieldname: ["employee_name","department","designation","ctc","company"] },
      callback(r) {
        if (r.message) {
          window._bs._sel.name  = r.message.employee_name || v;
          window._bs._sel.dept  = r.message.department    || "";
          window._bs._sel.desig = r.message.designation   || "";
          window._bs._sel.ctc   = parseFloat(r.message.ctc || 0);
          window._bs._sel.company = r.message.company || "";
        }
      },
    });
  });
  emp_ctrl && emp_ctrl.$input.on("change blur", () => {
    const v = emp_ctrl.$input.val().trim();
    if (v) window._bs._sel.emp = v;
  });

  // ── Events ───────────────────────────────────────────────────────────────
  (dept_ctrl || branch_ctrl || desig_ctrl) && $wrap.find("#bs-fetch-btn").on("click", () => bs_fetch_employees());
  emp_ctrl && $wrap.find("#bs-add-btn").on("click", () => bs_quick_add());
  emp_ctrl && $wrap.find("#bs-emp-link-wrap input").on("keydown", (e) => { if (e.key==="Enter") bs_quick_add(); });
  $wrap.find("#bs-refresh-all-btn").on("click",    () => bs_refresh_all_statuses());
  $wrap.find("#bs-open-submitted-btn").on("click", () => bs_open_submitted_slips());
  $wrap.find("#bs-submit-drafts-btn").on("click",  () => bs_submit_draft_slips());
  $wrap.find("#bs-create-accrual-btn").on("click", () => bs_create_accrual_journal_entry());
  $wrap.find("#bs-create-missing-btn").on("click", () => open_payroll_dialog({ create_missing_only: true }));
  $wrap.find("#bs-save-draft-btn").on("click",     () => bs_save_draft());
  $wrap.find("#bs-reset-batch-btn").on("click",   () => bs_reset_bulk_batch({ delete_batch: 0 }));
  $wrap.find("#bs-review-btn").on("click",         () => open_payroll_dialog());
  $wrap.find("#bs-fetch-advances-btn").on("click", () => bs_fetch_all_advances());
  $wrap.find("#bs-load-source-btn").on("click",    () => bs_load_source_data());
  $wrap.find("#bs-toggle-filters-btn").on("click", function () {
    $wrap.find("#bs-filters-area").toggleClass("is-hidden");
    $(this).text($wrap.find("#bs-filters-area").hasClass("is-hidden") ? "☰ Field Mapping" : "✕ Close Mapping");
  });
  $wrap.find("#bs-head-month-select").on("change", async function () {
    const month = $(this).val() || "";
    if (!month) {
      await bs_apply_period_controls(frm, "dates");
    } else {
      await bs_apply_period_controls(frm, "month");
    }
    if (window._bs.rows.length) {
      bs_clear_all_row_source_metrics();
      window._bs.loaded_source_period = "";
      await bs_refresh_structure_assignments(window._bs.rows);
      await bs_trigger_source_reload({ force: true });
    }
  });
  $wrap.find("#bs-head-frequency").on("change", async function () {
    await bs_apply_period_controls(frm, "frequency");
    if (window._bs.rows.length) {
      bs_clear_all_row_source_metrics();
      window._bs.loaded_source_period = "";
      await bs_trigger_source_reload({ force: true });
    }
  });
  $wrap.find("#bs-head-start-date, #bs-head-end-date").on("change", async function () {
    await bs_apply_period_controls(frm, "dates");
    if (window._bs.rows.length) {
      bs_clear_all_row_source_metrics();
      window._bs.loaded_source_period = "";
      await bs_trigger_source_reload({ force: true });
    }
  });
  $wrap.find("#bs-head-posting-date").on("change", async function () {
    await bs_apply_period_controls(frm, "posting");
    if (window._bs.rows.length) {
      bs_clear_all_row_source_metrics();
      window._bs.loaded_source_period = "";
      await bs_trigger_source_reload({ force: true });
    }
  });
  $wrap.find("#bs-search-input").on("input", function () {
    window._bs.search_query = ($(this).val() || "").trim().toLowerCase();
    bs_render_table();
  });
  $wrap.find(".bs-filter-btn").on("click", function () {
    window._bs.active_filter = $(this).data("filter") || "all";
    $wrap.find(".bs-filter-btn").removeClass("is-active");
    $(this).addClass("is-active");
    bs_render_table();
  });

  await bs_bind_source_controls(frm, settings, $wrap);
  await bs_restore_source_controls_from_doc(frm);
  await bs_repair_period_from_doc(frm);
  bs_update_header_period(frm);
  $(document).off("mousedown.bsfilters").on("mousedown.bsfilters", function (e) {
    const $target = $(e.target);
    if (
      $target.closest("#bs-filters-area").length ||
      $target.closest("#bs-toggle-filters-btn").length ||
      $target.closest(".awesomplete").length ||
      $target.closest(".ui-datepicker").length
    ) {
      return;
    }
    if (bs_auto_hide_filters_enabled()) bs_hide_filters();
  });

  const finish_init = async () => {
    bs_merge_saved_rows_from_frm(frm);
    await bs_restore_source_controls_from_doc(frm);
    await bs_hydrate_batch_additional_salaries(frm);
    await bs_hydrate_batch_period_artifacts(frm);
    window._bs.rows.forEach(recalc_row);
    bs_render_table();
    bs_render_live_summary(frm);
    if (typeof bs_tidy_form_after_ui === "function") bs_tidy_form_after_ui(frm);
    bs_auto_fetch_pending_advances().catch((e) => console.warn("Advance auto-fetch:", e));
    await bs_trigger_source_reload({ force: true });
  };

  if (window._bs.rows.length) {
    bs_refresh_rows_from_employee(window._bs.rows).finally(() => {
      bs_refresh_structure_assignments(window._bs.rows).finally(finish_init);
    });
  } else {
    finish_init();
  }
}

async function bs_refresh_rows_from_employee(rows) {
  const employees = [...new Set((rows || []).map((row) => row.employee).filter(Boolean))];
  if (!employees.length) return;
  const res = await bs_call("frappe.client.get_list", {
    doctype: "Employee",
    filters: { name: ["in", employees] },
    fields: ["name", "employee_name", "department", "designation", "ctc"],
    limit_page_length: 500,
  });
  const employee_map = Object.fromEntries((res.message || []).map((emp) => [emp.name, emp]));
  rows.forEach((row) => {
    const emp = employee_map[row.employee];
    if (!emp) return;
    row.ctc = parseFloat(emp.ctc || row.ctc || 0);
    row.employee_name = emp.employee_name || row.employee_name || row.employee;
    row.department = emp.department || row.department || "";
    row.designation = emp.designation || row.designation || "";
    recalc_row(row);
  });
}

// ─── 4. FETCH EMPLOYEES BY FILTER ─────────────────────────────────────────────
function bs_fetch_employees() {
  const { dept_ctrl, branch_ctrl, desig_ctrl } = window._bs.ctrls;
  const dept   = dept_ctrl?.get_value?.()   || "";
  const branch = branch_ctrl?.get_value?.() || "";
  const desig  = desig_ctrl?.get_value?.()  || "";

  const notice = (msg, type="info") => bs_notice("bs-fetch-notice", msg, type);
  notice("⏳ Fetching…");

  const filters = [["status","=","Active"]];
  const company = bs_get_active_company();
  if (company) filters.push(["company", "=", company]);
  if (dept)   filters.push(["department",  "=", dept]);
  if (branch) filters.push(["branch",      "=", branch]);
  if (desig)  filters.push(["designation", "=", desig]);

  frappe.call({
    method: "frappe.client.get_list",
    args: { doctype:"Employee", filters, limit:500,
            fields:["name","employee_name","department","designation","ctc"] },
    async callback(r) {
      bs_normalize_rows();
      const list = r.message || [];
      if (!list.length) { notice("⚠ No active employees found.", "warn"); return; }
      const added_rows = [];
      let added = 0;
      list.forEach((e) => {
        if (!window._bs.rows.find((row) => row.employee === e.name)) {
          const row = make_row(e.name, e.employee_name, e.department, e.designation, parseFloat(e.ctc||0));
          window._bs.rows.push(row);
          added_rows.push(row);
          added++;
        }
      });
      try {
        if (added_rows.length) await bs_refresh_structure_assignments(added_rows);
        bs_normalize_rows();
        bs_render_table();
        notice(`✓ ${added} added${list.length-added ? ` (${list.length-added} already in list)`:""}.`, "success");
        if (bs_auto_hide_filters_enabled()) bs_hide_filters();
        await bs_maybe_auto_load_source(true);
      } catch (error) {
        console.error("Fetch render failed:", error);
        notice(`Added ${added} employee(s) but table failed to render: ${error.message}`, "error");
      }
    },
  });
}

// ─── 5. QUICK ADD ─────────────────────────────────────────────────────────────
function bs_quick_add() {
  const { emp_ctrl } = window._bs.ctrls;
  if (!emp_ctrl) return;
  const emp_id = (window._bs._sel.emp || emp_ctrl.$input.val() || "").trim();
  const notice = (msg, type="warn") => bs_notice("bs-add-notice", msg, type);

  if (!emp_id) { notice("⚠ Please select an employee."); return; }
  if (window._bs.rows.find((r) => r.employee === emp_id)) {
    notice(`⚠ <b>${emp_id}</b> already in list.`); return;
  }

  const do_add = async (name, dept, desig, ctc) => {
    const active_company = bs_get_active_company();
    if (window._bs._sel.company && active_company && window._bs._sel.company !== active_company) {
      notice(`⚠ ${emp_id} belongs to ${window._bs._sel.company}, not ${active_company}.`);
      return;
    }
    const row = make_row(emp_id, name, dept, desig, parseFloat(ctc||0));
    window._bs.rows.push(row);
    bs_normalize_rows();
    await bs_refresh_structure_assignments([row]);
    bs_render_table();
    notice(`✓ <b>${name||emp_id}</b> added.`, "success");
    if (bs_auto_hide_filters_enabled()) bs_hide_filters();
    window._bs._sel = { emp:"", name:"", dept:"", desig:"", ctc:0 };
    emp_ctrl.set_value(""); emp_ctrl.$input.val("");
    setTimeout(() => emp_ctrl.$input.focus(), 80);
  };

  if (window._bs._sel.name && window._bs._sel.name !== emp_id) {
    do_add(window._bs._sel.name, window._bs._sel.dept, window._bs._sel.desig, window._bs._sel.ctc);
  } else {
    frappe.call({
      method: "frappe.client.get_value",
      args: { doctype:"Employee", filters:{ name:emp_id },
              fieldname:["employee_name","department","designation","ctc","company"] },
      async callback(r) {
        const m = r.message || {};
        const active_company = bs_get_active_company();
        if (active_company && m.company && m.company !== active_company) {
          notice(`⚠ ${emp_id} belongs to ${m.company}, not ${active_company}.`);
          return;
        }
        await do_add(m.employee_name||emp_id, m.department, m.designation, m.ctc);
      },
      async error() { await do_add(emp_id); },
    });
  }
}

function make_row(employee, employee_name, department, designation, ctc) {
  const mode = window._bs.frm?.doc?.calculation_mode || "Manual";
  const default_days = mode === "Manual" ? 30 : 0;
  return {
    _id: ++window._bs.counter,
    row_name: "",
    employee, employee_name: employee_name||employee,
    department: department||"", designation: designation||"",
    ctc, ot_type:"hours", ot_input:0, ot_amount:0,
    source_hours:0, source_qty:0, piece_rate:0,
    use_hours: window._bs.global_piece_flags?.use_hours ?? 1,
    use_qty: window._bs.global_piece_flags?.use_qty ?? 1,
    overtime_with_salary: window._bs.global_piece_flags?.overtime_with_salary ?? bs_to_int(window._bs.frm?.doc?.overtime_with_salary, 0),
    piece_basis: window._bs.frm?.doc?.per_piece_basis || window._bs.settings?.default_per_piece_basis || "Total Hours",
    attendance_days:0, absent_days:0, attendance_hours:0, payment_days:default_days,
    worked_hours:0, shift_hours:0, overtime_hours:0,
    bonus_amount:0, other_allowance:0,
    gross: ctc, advances:[], adv_fetched:false, source_row_names: [],
    adv_deduct:0, late_deduction:0, other_deduction:0,
    components: [],
    total_additions:0, total_deductions:0, net: ctc,
    status:"Pending", salary_slip_status:"", payment_status:"Not Paid",
    salary_structure:"", salary_structure_assignment:"",
    payroll_payable_account:"",
    structure_base:0, structure_warning:"",
    salary_slip:"", payment_entry:"", slip_cancelled_on:"",
    error_message:"",
  };
}

function bs_get_component_totals(row) {
  const items = row.components || [];
  const earnings = items
    .filter((item) => item.type === "Earning" && !item.auto_calculated)
    .reduce((sum, item) => sum + (parseFloat(item.amount || 0) || 0), 0);
  const deductions = items
    .filter((item) => item.type === "Deduction" && !item.auto_calculated)
    .reduce((sum, item) => sum + (parseFloat(item.amount || 0) || 0), 0);
  return { earnings, deductions };
}

function bs_normalize_component_name(component_name = "") {
  return String(component_name || "").trim().toLowerCase();
}

function bs_is_base_component_name(component_name = "") {
  return /(basic|base salary|bs salary|ctc|gross)/.test(bs_normalize_component_name(component_name));
}

function bs_is_overtime_component_name(component_name = "") {
  return /(overtime|\bot\b|hour|hourly)/.test(bs_normalize_component_name(component_name));
}

function bs_is_qty_component_name(component_name = "") {
  return /(qty|quantity|piece|per piece|production)/.test(bs_normalize_component_name(component_name));
}

function bs_get_component_role(component_name = "", component_type = "") {
  const value = bs_normalize_component_name(component_name);
  if (!value) return "skip";
  if (component_type === "Deduction" && /(advance)/.test(value)) return "advance";
  if (component_type === "Earning" && bs_is_base_component_name(value)) return "base";
  if (component_type === "Earning" && bs_is_overtime_component_name(value)) return "overtime";
  if (component_type === "Earning" && bs_is_qty_component_name(value)) return "qty";
  return "manual";
}

async function bs_get_salary_structure_doc(structure_name) {
  if (!structure_name) return null;
  window._bs.structure_doc_cache = window._bs.structure_doc_cache || {};
  if (window._bs.structure_doc_cache[structure_name]) return window._bs.structure_doc_cache[structure_name];
  const res = await bs_call("frappe.client.get", { doctype: "Salary Structure", name: structure_name });
  window._bs.structure_doc_cache[structure_name] = res.message || null;
  return window._bs.structure_doc_cache[structure_name];
}

function bs_component_rule_map() {
  const rules = bs_get_component_rules();
  const has_rules = rules.length > 0;
  const map = {};
  rules.forEach((row) => {
    map[row.salary_component] = {
      enabled: bs_to_int(row.enabled, 1) === 1,
      type: row.component_type || "",
    };
  });
  return { has_rules, map };
}

function bs_find_enabled_rule_component(matcher, component_type = "Earning") {
  return bs_find_enabled_rule_components(matcher, component_type)[0] || "";
}

function bs_find_enabled_rule_components(matcher, component_type = "Earning") {
  return bs_get_enabled_component_rules().filter((rule) => {
    const type_match = !component_type || (rule.component_type || "Earning") === component_type;
    return type_match && matcher(rule.salary_component || "");
  }).map((rule) => rule.salary_component || "");
}

function bs_find_structure_component(structure_doc, matcher, fieldname = "earnings") {
  return (structure_doc?.[fieldname] || []).find((row) => matcher(row.salary_component || ""))?.salary_component || "";
}

function bs_get_cached_structure_doc(structure_name) {
  return (window._bs.structure_doc_cache || {})[structure_name] || null;
}

function bs_get_piece_component_targets(structure_doc) {
  const settings = window._bs.settings || {};
  const hours_component = (
    settings.hours_component
    || settings.overtime_component
    || bs_find_enabled_rule_component(bs_is_overtime_component_name, "Earning")
    || bs_find_structure_component(structure_doc, bs_is_overtime_component_name, "earnings")
    || ""
  );
  const qty_component = (
    settings.qty_component
    || settings.piece_qty_component
    || bs_find_enabled_rule_component(bs_is_qty_component_name, "Earning")
    || bs_find_structure_component(structure_doc, bs_is_qty_component_name, "earnings")
    || "Bulk Piece Qty"
  );
  return { hours_component, qty_component };
}

function bs_should_merge_piece_qty_into_hours(structure_doc) {
  const settings = window._bs.settings || {};
  const { hours_component, qty_component } = bs_get_piece_component_targets(structure_doc);
  if (!hours_component) return true;
  if (!qty_component || qty_component === hours_component) return true;
  if (settings.qty_component || settings.piece_qty_component) return false;
  return qty_component === "Bulk Piece Qty";
}

function bs_get_piece_overtime_amount(row, structure_doc) {
  const hours = row.use_hours ? (parseFloat(row.hours_amount || 0) || 0) : 0;
  const qty = row.use_qty ? (parseFloat(row.qty_amount || 0) || 0) : 0;
  if (bs_should_merge_piece_qty_into_hours(structure_doc)) return hours + qty;
  return hours;
}

function bs_get_piece_qty_component_amount(row, structure_doc) {
  if (!row.use_qty) return 0;
  if (bs_should_merge_piece_qty_into_hours(structure_doc)) return 0;
  return parseFloat(row.qty_amount || 0) || 0;
}

function bs_get_standard_component_targets(structure_doc) {
  const base_component = (
    bs_find_structure_component(structure_doc, bs_is_base_component_name, "earnings")
    || bs_find_enabled_rule_component(bs_is_base_component_name, "Earning")
    || ""
  );
  const overtime_component = (
    bs_find_structure_component(structure_doc, bs_is_overtime_component_name, "earnings")
    || bs_find_enabled_rule_component(bs_is_overtime_component_name, "Earning")
    || ""
  );
  return { base_component, overtime_component };
}

function bs_get_auto_component_meta(row, mode) {
  const structure_doc = bs_get_cached_structure_doc(row.salary_structure || "");
  const { base_component } = bs_get_standard_component_targets(structure_doc);
  const { hours_component, qty_component } = bs_get_piece_component_targets(structure_doc);
  const { overtime_component } = bs_get_standard_component_targets(structure_doc);

  if (bs_is_piece_mode(mode)) {
    return [
      row.overtime_with_salary && base_component ? { label: "Base", component: base_component, amount: parseFloat(row.ctc || 0) || 0 } : null,
      row.use_hours && hours_component ? { label: "Hours", component: hours_component, amount: bs_get_piece_overtime_amount(row, structure_doc) } : null,
      row.use_qty && qty_component && !bs_should_merge_piece_qty_into_hours(structure_doc)
        ? { label: "Qty", component: qty_component, amount: bs_get_piece_qty_component_amount(row, structure_doc) } : null,
    ].filter(Boolean);
  }

  return [
    base_component ? { label: "Base", component: base_component, amount: parseFloat(row.base_pay || 0) || 0 } : null,
    overtime_component ? { label: "OT", component: overtime_component, amount: parseFloat(row.ot_amount || 0) || 0 } : null,
  ].filter(Boolean);
}

async function bs_resolve_special_component(row, vals, kind) {
  const structure_doc = await bs_get_salary_structure_doc(row.salary_structure || "");
  const settings = window._bs.settings || {};
  if (kind === "overtime") {
    return (
      vals.overtime_component
      || bs_find_enabled_rule_component(bs_is_overtime_component_name, "Earning")
      || bs_find_structure_component(structure_doc, bs_is_overtime_component_name, "earnings")
      || await bs_ensure_salary_component("Bulk Overtime", "Earning")
    );
  }
  if (kind === "hours") {
    return (
      settings.hours_component
      ||
      vals.overtime_component
      || bs_find_enabled_rule_component(bs_is_overtime_component_name, "Earning")
      || bs_find_structure_component(structure_doc, bs_is_overtime_component_name, "earnings")
      || await bs_ensure_salary_component("Bulk Hour Amount", "Earning")
    );
  }
  if (kind === "qty") {
    return (
      settings.qty_component
      ||
      bs_find_enabled_rule_component(bs_is_qty_component_name, "Earning")
      || bs_find_structure_component(structure_doc, bs_is_qty_component_name, "earnings")
      || await bs_ensure_salary_component("Bulk Piece Qty", "Earning")
    );
  }
  return "";
}

function bs_build_row_components(row, structure_doc, options = {}) {
  const include_structure = options.include_structure !== false;
  const current_mode = window._bs.frm?.doc?.calculation_mode || "Manual";
  const { base_component, overtime_component } = bs_get_standard_component_targets(structure_doc);
  const existing = {};
  (row.components || []).forEach((item) => {
    if (!item?.component) return;
    const amount = parseFloat(item.amount || 0) || 0;
    const type = item.type || "Earning";
    const component = item.component;
    const key = item.key || bs_normalize_component_key(type, component);
    existing[key] = amount;
    existing[bs_normalize_component_key(type, component)] = amount;
    existing[component] = amount;
  });
  if (row._saved_component_map) {
    Object.assign(existing, row._saved_component_map);
  }

  const { has_rules, map: rule_map } = bs_component_rule_map();
  const items = [];
  const seen = new Set();
  const push_component = (component, type) => {
    const role = bs_get_component_role(component, type);
    if (!component || role === "skip" || role === "advance") return;
    const rule = rule_map[component];
    if (rule && !rule.enabled) return;
    const item_type = rule?.type || type;
    const key = `${item_type}::${component}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      key,
      component,
      label: component,
      type: item_type,
      role,
      auto_calculated: ["base", "overtime", "qty"].includes(role),
      amount: existing[key] || existing[component] || 0,
    });
  };
  const push_items = (component_rows, type) => {
    (component_rows || []).forEach((item) => {
      push_component(item.salary_component, type);
    });
  };
  if (include_structure) {
    push_items(structure_doc?.earnings, "Earning");
    push_items(structure_doc?.deductions, "Deduction");
  }
  bs_get_enabled_component_rules().forEach((rule) => {
    push_component(rule.salary_component, rule.component_type || "Earning");
  });
  if (!Object.keys(existing).length) {
    const legacy_map = [
      { amount: parseFloat(row.other_allowance || 0), type: "Earning", keywords: ["allowance"] },
      { amount: parseFloat(row.bonus_amount || 0), type: "Earning", keywords: ["bonus"] },
      { amount: parseFloat(row.late_deduction || 0), type: "Deduction", keywords: ["late", "absent"] },
      { amount: parseFloat(row.other_deduction || 0), type: "Deduction", keywords: ["other"] },
    ];
    legacy_map.forEach((legacy) => {
      if (!legacy.amount) return;
      const target = items.find((item) =>
        item.type === legacy.type && legacy.keywords.some((keyword) => item.component.toLowerCase().includes(keyword))
      );
      if (target) target.amount = legacy.amount;
    });
  }
  if (bs_is_piece_mode(current_mode)) {
    const manual_items = items.filter((item) => !item.auto_calculated);
    const { hours_component, qty_component } = bs_get_piece_component_targets(structure_doc);
    const { base_component } = bs_get_standard_component_targets(structure_doc);
    const auto_items = [];

    if (row.overtime_with_salary && base_component) {
      const key = `Earning::base::${base_component}`;
      auto_items.push({
        key,
        component: base_component,
        label: base_component,
        type: "Earning",
        role: "base",
        auto_calculated: true,
        amount: existing[key] || (parseFloat(row.ctc || 0) || 0),
      });
    }

    if (row.use_hours && hours_component) {
      const merge_qty = row.use_qty && bs_should_merge_piece_qty_into_hours(structure_doc);
      const key = `Earning::hours::${hours_component}`;
      auto_items.push({
        key,
        component: hours_component,
        label: hours_component,
        type: "Earning",
        role: "overtime",
        auto_calculated: true,
        amount: existing[key] || bs_get_piece_overtime_amount(row, structure_doc),
      });
    }

    if (row.use_qty && qty_component && !bs_should_merge_piece_qty_into_hours(structure_doc)) {
      const key = `Earning::qty::${qty_component}`;
      auto_items.push({
        key,
        component: qty_component,
        label: qty_component,
        type: "Earning",
        role: "qty",
        auto_calculated: true,
        amount: existing[key] || bs_get_piece_qty_component_amount(row, structure_doc),
      });
    }

    row.components = manual_items.concat(auto_items);
    bs_apply_saved_component_map(row);
    return;
  }

  const filtered_items = items.filter((item) => {
    if (!item.auto_calculated) return true;
    if (item.role === "base") return !!base_component && item.component === base_component;
    if (item.role === "overtime") return !!overtime_component && item.component === overtime_component;
    return false;
  });

  filtered_items.forEach((item) => {
    if (!item.auto_calculated) return;
    if (item.role === "base") {
      item.amount = parseFloat(row.base_pay || 0) || 0;
    } else if (item.role === "overtime") {
      item.amount = parseFloat(row.ot_amount || 0) || 0;
    } else if (item.role === "qty") {
      item.amount = parseFloat(row.qty_amount || 0) || 0;
    }
  });
  row.components = filtered_items;
  bs_apply_saved_component_map(row);
}

// ─── 6. RENDER TABLE ──────────────────────────────────────────────────────────

window.bs_toggle_row_menu = (row_id, event) => {
  event?.stopPropagation?.();
  document.querySelectorAll(".bs-menu-wrap.is-open").forEach((el) => {
    if (el.dataset.rowId !== String(row_id)) el.classList.remove("is-open");
  });
  const wrap = document.querySelector(`.bs-menu-wrap[data-row-id="${row_id}"]`);
  if (wrap) wrap.classList.toggle("is-open");
};

document.addEventListener("click", () => {
  document.querySelectorAll(".bs-menu-wrap.is-open").forEach((el) => el.classList.remove("is-open"));
});

function bs_build_piece_mini_table(r, hourly, hours_amount, qty_amount) {
  const rows = [];
  if (r.use_hours || r.overtime_with_salary) {
    rows.push(`
      <div class="bs-piece-inline-row">
        <label><input class="bs-piece-check" type="checkbox" ${r.use_hours ? "checked" : ""} ${r.overtime_with_salary ? "disabled" : ""} onchange="bs_toggle_piece_part(${r._id},'use_hours',this.checked)"/> Hrs</label>
        <input class="bs-input-sm bs-editable" type="number" min="0" step="0.01" value="${bs_input_value(r.source_hours)}" onchange="bs_update_amount(${r._id},'source_hours',this.value)"/>
        <span class="bs-piece-inline-sep">×</span>
        <input class="bs-input-sm bs-piece-readonly" type="text" readonly tabindex="-1" value="${fmt_rate(hourly)}"/>
        <span class="bs-piece-inline-sep">=</span>
        <span class="bs-piece-inline-amt">${fmt_total(hours_amount)}</span>
      </div>`);
  }
  if (r.use_qty) {
    rows.push(`
      <div class="bs-piece-inline-row">
        <label><input class="bs-piece-check" type="checkbox" ${r.use_qty ? "checked" : ""} onchange="bs_toggle_piece_part(${r._id},'use_qty',this.checked)"/> Qty</label>
        <input class="bs-input-sm bs-editable" type="number" min="0" step="0.01" value="${bs_input_value(r.source_qty)}" onchange="bs_update_amount(${r._id},'source_qty',this.value)"/>
        <span class="bs-piece-inline-sep">×</span>
        <input class="bs-input-sm bs-editable" type="number" min="0" step="0.01" value="${bs_input_value(r.piece_rate)}" onchange="bs_update_amount(${r._id},'piece_rate',this.value)"/>
        <span class="bs-piece-inline-sep">=</span>
        <span class="bs-piece-inline-amt">${fmt_total(qty_amount)}</span>
      </div>`);
  }
  if (!rows.length) return `<div class="bs-work-sub">Enable hours or qty in settings.</div>`;
  return `<div class="bs-piece-inline-rows">${rows.join("")}<div class="bs-piece-inline-total">Total ${fmt_total(hours_amount + qty_amount)}</div></div>`;
}

function bs_build_row_menu_items(r) {
  const can_pay_row = r.salary_slip && r.salary_slip_status === "Submitted" && !r.payment_entry;
  const can_delete_draft = r.salary_slip && r.salary_slip_status === "Draft";
  const can_cancel_unlink = r.salary_slip && r.salary_slip_status === "Submitted";
  const can_unlink_existing = r.salary_slip && !r.salary_slip_status && r.status === "Skipped";
  const items = [];
  if (r.salary_slip) items.push(`<button type="button" class="bs-menu-item" onclick="bs_open_doc('Salary Slip','${r.salary_slip}')">Open Salary Slip</button>`);
  (r._linked_additional_salaries || []).slice(0, 5).forEach((ads) => {
    items.push(`<button type="button" class="bs-menu-item" onclick="bs_open_doc('Additional Salary','${ads.name}')">ADS: ${frappe.utils.escape_html(ads.salary_component || ads.name)}</button>`);
  });
  if (r.salary_structure_assignment) items.push(`<button type="button" class="bs-menu-item" onclick="bs_open_doc('Salary Structure Assignment','${r.salary_structure_assignment}')">Open Assignment</button>`);
  else items.push(`<button type="button" class="bs-menu-item" onclick="bs_new_assignment('${r.employee}','${r.salary_structure || ""}')">New Assignment</button>`);
  items.push(`<button type="button" class="bs-menu-item" onclick="bs_reprocess_row(${r._id},0)">Recreate Draft</button>`);
  if (r.salary_slip) items.push(`<button type="button" class="bs-menu-item" onclick="bs_reprocess_row(${r._id},1)">Recreate & Submit</button>`);
  if (can_pay_row) items.push(`<button type="button" class="bs-menu-item" onclick="bs_create_single_payment('${r.employee}')">Pay Employee</button>`);
  if (r.payment_entry) items.push(`<button type="button" class="bs-menu-item" onclick="bs_open_doc('Journal Entry','${r.payment_entry}')">Open Payment JE</button>`);
  if (can_delete_draft) items.push(`<button type="button" class="bs-menu-item" onclick="bs_manage_salary_slip(${r._id},'delete_draft')">Delete Draft Slip</button>`);
  if (can_cancel_unlink) items.push(`<button type="button" class="bs-menu-item" onclick="bs_manage_salary_slip(${r._id},'cancel_unlink')">Cancel Slip</button>`);
  if (can_unlink_existing) items.push(`<button type="button" class="bs-menu-item" onclick="bs_manage_salary_slip(${r._id},'unlink')">Unlink Slip</button>`);
  if (r.salary_slip || r.payment_entry) items.push(`<button type="button" class="bs-menu-item" onclick="bs_refresh_row_status(${r._id})">Refresh Status</button>`);
  if (!r.adv_fetched) items.push(`<button type="button" class="bs-menu-item" onclick="fetch_advances_for_row(window._bs.rows.find(x=>x._id===${r._id})).then(()=>bs_render_table())">Load Advances</button>`);
  items.push(`<button type="button" class="bs-menu-item bs-menu-item-danger" onclick="bs_remove_row(${r._id})">Remove Employee</button>`);
  return items.join("");
}

function bs_build_expanded_panel(r, mode, hourly, hours_amount, qty_amount) {
  const manual_basis = window._bs.frm?.doc?.manual_salary_basis || "Full Month";
  const show_manual_days = mode === "Manual" && manual_basis !== "Full Month";
  const show_salary_days = mode === "Manual" && manual_basis === "Full Month";
  const structure_doc = bs_get_cached_structure_doc(r.salary_structure || "");
  const merge_piece_qty = bs_is_piece_mode(mode) && bs_should_merge_piece_qty_into_hours(structure_doc);

  const render_component_cards = (type) => (r.components || [])
    .filter((item) => item.type === type && bs_should_show_component(item))
    .map((item) => {
      const piece_breakdown = (
        bs_is_piece_mode(mode)
        && item.role === "overtime"
        && merge_piece_qty
        && r.use_hours
        && r.use_qty
        && (hours_amount || qty_amount)
      )
        ? `<div class="bs-comp-card-sub">${fmt_total(hours_amount)} + ${fmt_total(qty_amount)}</div>`
        : "";
      return `
      <div class="bs-comp-card bs-comp-card-${type === "Earning" ? "earn" : "ded"}${item.auto_calculated ? " bs-comp-card-auto" : ""}" title="${frappe.utils.escape_html(item.label)}">
        <div class="bs-comp-card-label">${frappe.utils.escape_html(item.label)}</div>
        ${piece_breakdown}
        <input class="${item.auto_calculated ? "bs-comp-card-auto" : "bs-editable"}" type="number" min="0" step="1"
          value="${bs_component_input_value(item)}" onfocus="this.select()"
          ${item.auto_calculated ? "readonly tabindex='-1'" : `onchange="bs_update_component_amount(${r._id},'${encodeURIComponent(item.key)}',this.value)"`}/>
      </div>`;
    }).join("");

  const earning_cards = render_component_cards("Earning");
  const deduction_cards = render_component_cards("Deduction");

  let work_body = "";
  const daily = r.ctc / 30;
  const salary_days = bs_effective_salary_days(r, window._bs.frm);
  const rates_footer = `<div class="bs-work-rates-footer">Daily ${fmt_rate(daily)} · Hourly ${fmt_rate(hourly)} · Basic ${fmt_total(r.base_pay || 0)}</div>`;

  if (bs_is_piece_mode(mode)) {
    work_body = bs_build_piece_mini_table(r, hourly, hours_amount, qty_amount) + rates_footer;
  } else {
    if (["Attendance Based", "Checkin Based"].includes(mode) || show_manual_days || show_salary_days) {
      const days_input = (show_manual_days || manual_basis === "By Payment Days" || show_salary_days)
        ? `<input class="bs-input-sm bs-editable" type="number" min="0" max="31" step="1" value="${bs_input_value(salary_days)}" onchange="bs_update_amount(${r._id},'payment_days',this.value)"/>`
        : `<span class="bs-comp-pill">${fmt_num(salary_days, 0)}</span>`;
      work_body += bs_build_work_input_row(
        "Days",
        days_input,
        `<span class="bs-comp-pill">Basic ${fmt_total(r.base_pay || 0)}</span>`,
      );
      if (show_manual_days && manual_basis === "Deduct Absent Days") {
        work_body += bs_build_work_input_row(
          "Abs",
          `<input class="bs-input-sm bs-editable" type="number" min="0" max="31" step="1" value="${bs_input_value(r.absent_days)}" onchange="bs_update_amount(${r._id},'absent_days',this.value)"/>`,
          "",
        );
      }
    }
    work_body += bs_build_work_input_row(
      "Hours",
      `<input class="bs-input-sm bs-editable" type="number" min="0" step="0.5" value="${bs_input_value(r.ot_input)}" onchange="bs_update_ot(${r._id},this.value)"/>`,
      `<span class="bs-comp-pill">OT ${fmt_total(r.ot_amount)}</span>`,
    );
    work_body += rates_footer;
  }

  const components_body = (earning_cards || deduction_cards)
    ? `<div class="bs-comp-split">
        <div class="bs-comp-col">
          <div class="bs-comp-col-title bs-comp-col-title-earn">Earnings</div>
          <div class="bs-comp-grid">${earning_cards || `<div class="bs-adv-summary">—</div>`}</div>
        </div>
        <div class="bs-comp-col">
          <div class="bs-comp-col-title bs-comp-col-title-ded">Deductions</div>
          <div class="bs-comp-grid">${deduction_cards || `<div class="bs-adv-summary">—</div>`}</div>
        </div>
      </div>`
    : `<div class="bs-adv-summary">No components configured</div>`;

  const adv_lines = bs_build_advances_panel_html(r);

  return `<div class="bs-row-detail-wrap">
    <div class="bs-expand-columns">
      <div class="bs-expand-panel bs-expand-panel-compact bs-expand-panel-side bs-expand-panel-piece">
        <div class="bs-expand-panel-head">
          <div class="bs-expand-panel-title">${bs_is_piece_mode(mode) ? "Piece / Hour" : "Work & OT"}</div>
        </div>
        ${work_body}
      </div>
      <div class="bs-expand-panel bs-expand-panel-compact bs-expand-panel-main">
        <div class="bs-expand-panel-head"><div class="bs-expand-panel-title">Salary Components</div></div>
        ${components_body}
      </div>
      <div class="bs-expand-panel bs-expand-panel-compact bs-expand-panel-side">
        <div class="bs-expand-panel-head"><div class="bs-expand-panel-title">Advances & Structure</div></div>
        <div class="bs-meta-compact">
          <div style="display:flex;flex-wrap:wrap;gap:4px">${adv_lines}</div>
          <span class="bs-meta-chip"><b>Structure</b> ${frappe.utils.escape_html(r.salary_structure || "—")}</span>
          ${r.salary_slip ? `<span class="bs-meta-chip"><b>Slip</b> <a href="/app/salary-slip/${r.salary_slip}" target="_blank" class="bs-mono">${r.salary_slip.split("/").pop()}</a></span>` : ""}
          ${r.structure_warning ? `<span class="bs-meta-chip bs-meta-chip-warn">${frappe.utils.escape_html(r.structure_warning)}</span>` : ""}
        </div>
      </div>
    </div>
  </div>`;
}

function bs_build_work_summary(r, mode) {
  if (bs_is_piece_mode(mode)) {
    return `<div class="bs-work-summary bs-money-ot">${fmt_total(r.ot_amount || 0)}</div>`;
  }
  return `<div class="bs-work-summary bs-money-ot">${fmt_total(r.ot_amount || 0)}</div>`;
}

function bs_build_salary_summary(r, frm) {
  return `<div class="bs-work-summary">${fmt_total(bs_row_base_pay(r, frm))}</div>`;
}

function bs_render_table() {
  bs_normalize_rows();
  const container = document.getElementById("bs-table-container");
  if (!container) return;
  const rows = window._bs.rows;
  const filter = window._bs.active_filter || "all";
  const query = window._bs.search_query || "";
  const settings = window._bs.settings || bs_default_settings();
  const filtered_rows = rows.filter((row) => bs_match_row_filter(row, filter, query));

  const count_el = document.getElementById("bs-row-count");
  if (count_el) count_el.textContent = `${filtered_rows.length} / ${rows.length} employee${rows.length!==1?"s":""}`;

  const adv_btn = document.getElementById("bs-fetch-advances-btn");
  if (adv_btn) adv_btn.style.display = rows.length ? "" : "none";

  const tot_el = document.getElementById("bs-total-display");
  if (tot_el) {
    if (rows.length) {
      tot_el.style.display = "";
      const total_net = rows.reduce((s,r)=>s+r.net,0);
      tot_el.textContent = `Est. Total Net: ${fmt_total(total_net)}`;
    } else { tot_el.style.display = "none"; }
  }

  bs_render_live_summary(window._bs.frm);

  if (!rows.length) {
    container.innerHTML = '<div class="bs-empty">No employees added yet.</div>';
    bs_render_live_summary(window._bs.frm);
    return;
  }

  if (!filtered_rows.length) {
    container.innerHTML = '<div class="bs-empty">No rows match the current filter.</div>';
    bs_render_live_summary(window._bs.frm);
    return;
  }

  const mode = window._bs.frm?.doc?.calculation_mode || "Manual";
  const col_count = 11;

  const trs = filtered_rows.map((r) => {
    const hourly = r.ctc / 30 / 8;
    const hours_amount = (parseFloat(r.source_hours || 0) || 0) * hourly;
    const qty_amount = (parseFloat(r.source_qty || 0) || 0) * (parseFloat(r.piece_rate || 0) || 0);
    const expanded = bs_is_row_expanded(r._id);
    const component_totals = bs_get_component_totals(r);
    const display_status = bs_get_row_display_status(r);
    const issue_class = bs_row_has_validation_issue(r) ? " has-issue" : "";
    const base_pay = bs_row_base_pay(r, window._bs.frm);
    const earn_count = (r.components || []).filter((c) => c.type === "Earning" && bs_should_show_component(c)).length;
    const ded_count = (r.components || []).filter((c) => c.type === "Deduction" && bs_should_show_component(c)).length;
    const comp_summary = (earn_count || ded_count || component_totals.earnings || component_totals.deductions)
      ? `<div class="bs-comp-col-summary">
          <div class="bs-comp-total-line bs-comp-total-earn">${fmt_total(component_totals.earnings)}</div>
          <div class="bs-comp-total-line bs-comp-total-ded">${fmt_total(component_totals.deductions)}</div>
        </div>`
      : `<span class="bs-comp-pill">—</span>`;

    const closing_balance = bs_get_advance_closing_balance(r);
    const adv_summary = r.adv_loading
      ? `<span class="bs-adv-summary">…</span>`
      : (r.adv_fetched || closing_balance > 0)
      ? (parseFloat(r.adv_deduct || 0) > 0
        ? `<span class="bs-comp-pill bs-comp-pill-ded">${fmt_total(r.adv_deduct)}</span>`
        : closing_balance > 0
          ? `<span class="bs-comp-pill">${fmt_total(closing_balance)}</span>`
          : `<span class="bs-adv-summary">—</span>`)
      : `<button type="button" class="bs-btn-ghost bs-btn-sm bs-adv-summary-btn" onclick="fetch_advances_for_row(window._bs.rows.find(x=>x._id===${r._id})).then(()=>bs_render_table())">Load</button>`;

    const structure_hint = r.salary_structure
      ? `<span class="bs-structure-compact ${r.structure_warning ? "bs-structure-compact-warn" : ""}" title="${frappe.utils.escape_html(r.salary_structure_assignment || r.salary_structure || "")}">${frappe.utils.escape_html(r.salary_structure.split(" ").slice(0, 2).join(" "))}${r.structure_warning ? " ⚠" : ""}</span>`
      : "";

    const main_row = `
      <tr class="bs-row${expanded ? " is-expanded" : ""}${issue_class}" id="bs-row-${r._id}">
        <td class="bs-td bs-td-sticky bs-col-emp">${bs_build_emp_cell_html(r, {
          compact: true,
          expand_btn: `<button type="button" class="bs-expand-btn" onclick="bs_toggle_row_expand(${r._id})" title="${expanded ? "Collapse" : "Expand"}">${expanded ? "▼" : "▶"}</button>`,
        })}</td>
        <td class="bs-td bs-col-dept"><div class="bs-dept-cell" title="${frappe.utils.escape_html(r.department || "")}">${frappe.utils.escape_html(r.department || "—")}</div></td>
        <td class="bs-td bs-td-num bs-col-ctc"><div class="bs-ctc-val">${fmt_total(r.ctc)}</div></td>
        <td class="bs-td bs-td-num bs-col-salary">${bs_build_salary_summary(r, window._bs.frm)}</td>
        <td class="bs-td bs-td-num bs-col-work">${bs_build_work_summary(r, mode)}</td>
        <td class="bs-td bs-td-num bs-col-comp">${comp_summary}</td>
        <td class="bs-td bs-td-num bs-col-gross"><div class="bs-money-main bs-money-gross">${fmt_total(r.gross)}</div></td>
        <td class="bs-td bs-td-num bs-col-adv">${adv_summary}</td>
        <td class="bs-td bs-td-num bs-col-net"><div class="bs-money-main bs-money-net">${fmt_total(r.net)}</div></td>
        <td class="bs-td bs-col-status"><span class="bs-status-badge bs-status-${display_status.cls}">${display_status.label}</span>${bs_build_linked_docs_hint(r)}${structure_hint ? `<div class="bs-work-sub">${structure_hint}</div>` : ""}</td>
        <td class="bs-td bs-col-menu">
          <div class="bs-menu-wrap" data-row-id="${r._id}">
            <button type="button" class="bs-menu-btn" onclick="bs_toggle_row_menu(${r._id}, event)">⋮</button>
            <div class="bs-menu-list">${bs_build_row_menu_items(r)}</div>
          </div>
        </td>
      </tr>`;

    const detail_row = expanded
      ? `<tr class="bs-row-detail"><td class="bs-td-detail" colspan="${col_count}">${bs_build_expanded_panel(r, mode, hourly, hours_amount, qty_amount)}</td></tr>`
      : "";

    return main_row + detail_row;
  }).join("");

  const total_ctc = filtered_rows.reduce((s, r) => s + parseFloat(r.ctc || 0), 0);
  const total_salary = filtered_rows.reduce((s, r) => s + bs_row_base_pay(r, window._bs.frm), 0);
  const total_ot = filtered_rows.reduce((s, r) => s + parseFloat(r.ot_amount || 0), 0);
  const total_gross = filtered_rows.reduce((s, r) => s + parseFloat(r.gross || 0), 0);
  const total_net = filtered_rows.reduce((s, r) => s + parseFloat(r.net || 0), 0);
  const total_adv = filtered_rows.reduce((s, r) => s + parseFloat(r.adv_deduct || 0), 0);
  const total_earn = filtered_rows.reduce((s, r) => s + (bs_get_component_totals(r).earnings || 0), 0);
  const total_ded = filtered_rows.reduce((s, r) => s + (bs_get_component_totals(r).deductions || 0), 0);
  const totals_row = `
    <tr class="bs-row bs-total-row">
      <td class="bs-td bs-td-sticky bs-col-emp">TOTAL (${filtered_rows.length})</td>
      <td class="bs-td bs-col-dept"></td>
      <td class="bs-td bs-td-num bs-col-ctc">${fmt_total(total_ctc)}</td>
      <td class="bs-td bs-td-num bs-col-salary">${fmt_total(total_salary)}</td>
      <td class="bs-td bs-td-num bs-col-work">${fmt_total(total_ot)}</td>
      <td class="bs-td bs-td-num bs-col-comp"><div class="bs-comp-col-summary"><div class="bs-comp-total-line bs-comp-total-earn">${fmt_total(total_earn)}</div><div class="bs-comp-total-line bs-comp-total-ded">${fmt_total(total_ded)}</div></div></td>
      <td class="bs-td bs-td-num bs-col-gross">${fmt_total(total_gross)}</td>
      <td class="bs-td bs-td-num bs-col-adv">${total_adv ? fmt_total(total_adv) : "—"}</td>
      <td class="bs-td bs-td-num bs-col-net" style="color:var(--bs-green)">${fmt_total(total_net)}</td>
      <td class="bs-td bs-col-status" colspan="2"></td>
    </tr>`;

  const toolbar = `
    <div class="bs-table-toolbar">
      <div class="bs-table-tools">
        <button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_expand_all_rows(true)">Expand All</button>
        <button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_expand_all_rows(false)">Collapse All</button>
        <button type="button" class="bs-btn-ghost bs-btn-sm ${window._bs.show_empty_components ? "is-active" : ""}" id="bs-toggle-empty-comp" onclick="bs_toggle_empty_components()">Empty Components</button>
        <button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_export_batch_csv(window._bs.rows, (window._bs.frm?.doc?.name || 'bulk_salary') + '.csv')">Export CSV</button>
      </div>
      <span class="bs-footer-hint">Expand row for days, hours, components · Salary = CTC ÷ 30 × days</span>
    </div>`;

  container.innerHTML = `
    <div class="bs-table-scroll">
      ${toolbar}
      <table class="bs-table">
        <colgroup>
          <col class="bs-col-emp"><col class="bs-col-dept"><col class="bs-col-ctc"><col class="bs-col-salary"><col class="bs-col-work"><col class="bs-col-comp">
          <col class="bs-col-gross"><col class="bs-col-adv"><col class="bs-col-net"><col class="bs-col-status"><col class="bs-col-menu">
        </colgroup>
        <thead><tr>
          <th class="bs-th bs-th-sticky bs-col-emp">Employee</th>
          <th class="bs-th bs-col-dept">Department</th>
          <th class="bs-th bs-th-num bs-col-ctc">CTC</th>
          <th class="bs-th bs-th-num bs-col-salary">Salary</th>
          <th class="bs-th bs-th-num bs-col-work">Overtime</th>
          <th class="bs-th bs-th-num bs-col-comp">Components</th>
          <th class="bs-th bs-th-num bs-col-gross">Gross</th>
          <th class="bs-th bs-th-num bs-col-adv">Advances</th>
          <th class="bs-th bs-th-num bs-col-net">Net Pay</th>
          <th class="bs-th bs-col-status">Status</th>
          <th class="bs-th bs-col-menu"></th>
        </tr></thead>
        <tbody>${trs}${totals_row}</tbody>
      </table>
    </div>`;
  bs_focus_pending_editable();
}

function bs_match_row_filter(row, filter, query="") {
  let matches_filter = true;
  if (filter && filter !== "all") {
    if (filter === "pending") matches_filter = ["Pending", "Validated", "Slip Created", "Skipped"].includes(row.status || "") || !row.salary_slip;
    else if (filter === "submitted") matches_filter = (row.salary_slip_status || "") === "Submitted";
    else if (filter === "failed") matches_filter = (row.status || "") === "Failed";
    else if (filter === "cancelled") matches_filter = (row.salary_slip_status || "") === "Cancelled" || (row.status || "") === "Cancelled";
    else if (filter === "paid") matches_filter = ["Paid", "Payment Created"].includes(row.payment_status || "");
  }
  if (!matches_filter) return false;
  if (!query) return true;
  const haystack = [
    row.employee,
    row.employee_name,
    row.department,
    row.designation,
    row.salary_slip,
    row.payment_entry,
    row.salary_structure,
    row.status,
    row.salary_slip_status,
    row.payment_status,
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

// ─── 7. OT & ADVANCE UPDATERS (global, called from inline HTML) ───────────────
window.bs_remove_row = (id) => {
  window._bs.rows = window._bs.rows.filter((r) => r._id !== id);
  bs_render_table();
};

window.bs_reprocess_row = async (id, submit_slip = 0) => {
  const frm = window._bs.frm;
  const row = (window._bs.rows || []).find((r) => r._id === id);
  if (!frm || !row || !row.row_name) {
    frappe.show_alert({ message: "Save the batch first, then reprocess.", indicator: "orange" }, 4);
    return;
  }
  frappe.confirm(
    `Recreate salary slip for ${row.employee}? Linked Additional Salary rows for this batch will be cancelled first.`,
    async () => {
      frappe.dom.freeze("Reprocessing salary slip…");
      try {
        bs_sync_to_frm(frm);
        await new Promise((res, rej) => frm.save("Save", (r) => (r.exc ? rej(new Error(r.exc)) : res(r))));
        const result = await bs_call("payroll_bulk.api.reprocess_bulk_salary_row", {
          batch_name: frm.doc.name,
          row_name: row.row_name,
          submit_slip: submit_slip ? 1 : 0,
          cancel_existing: 1,
        });
        const slip = result.message || result || {};
        row.salary_slip = slip.name || "";
        row.salary_slip_status = parseInt(slip.docstatus || 0, 10) === 1 ? "Submitted" : "Draft";
        row.status = parseInt(slip.docstatus || 0, 10) === 1 ? "Submitted" : "Slip Created";
        row.gross = parseFloat(slip.gross_pay || row.gross || 0);
        row.net = parseFloat(slip.net_pay || row.net || 0);
        row.error_message = "";
        await bs_refresh_row_status(id, { silent: true });
        bs_sync_to_frm(frm);
        await new Promise((res, rej) => frm.save("Save", (r) => (r.exc ? rej(new Error(r.exc)) : res(r))));
        if (typeof bs_show_batch_report_view === "function") {
          await bs_show_batch_report_view(frm);
        } else {
          bs_render_table();
          bs_render_live_summary(frm);
        }
        frappe.show_alert({ message: `Salary Slip ${slip.name || ""} recreated.`, indicator: "green" }, 5);
      } catch (error) {
        frappe.msgprint({ title: "Reprocess Error", message: error.message || String(error), indicator: "red" });
      } finally {
        frappe.dom.unfreeze();
      }
    },
  );
};

async function bs_reset_bulk_batch(options = {}) {
  const frm = window._bs.frm;
  if (!frm?.doc?.name) return;
  const delete_batch = !!options.delete_batch;
  const batch_name = frm.doc.name;
  const has_slips = (frm.doc.employees || []).some((r) => r.salary_slip);
  const has_accrual = !!frm.doc.accrual_journal_entry;
  const has_payment = !!frm.doc.bulk_payment_entry || (frm.doc.employees || []).some((r) => r.payment_entry);

  const lines = [
    delete_batch
      ? `<b>Delete batch ${batch_name}</b> and cancel/unlink all documents created from it.`
      : `<b>Reset batch ${batch_name}</b> — cancel owned salary slips, additional salaries, and journal entries; clear row links.`,
    "Slips owned by another batch will only be unlinked from this batch (not cancelled).",
  ];
  if (has_accrual) lines.push(`Accrual JE: <b>${frm.doc.accrual_journal_entry}</b> (cancelled only if this batch owns it).`);
  if (has_payment) lines.push("Payment journal entries linked to this batch will be cancelled.");
  if (!has_slips && !has_accrual && !has_payment && delete_batch) {
    lines.push("No linked payroll documents found — the empty batch record will be deleted.");
  }

  frappe.confirm(
    `${lines.join("<br>")}<br><br>Continue?`,
    async () => {
      try {
        frappe.dom.freeze(delete_batch ? "Deleting batch and cleaning links…" : "Resetting batch…");
        const method = delete_batch
          ? "payroll_bulk.api.delete_bulk_salary_batch"
          : "payroll_bulk.api.reset_bulk_salary_batch";
        const res = await bs_call(method, { batch_name });
        const msg = res.message || res || {};
        frappe.dom.unfreeze();
        const summary = [
          msg.cancelled_slips?.length ? `${msg.cancelled_slips.length} slip(s) cancelled` : "",
          msg.unlinked_slips?.length ? `${msg.unlinked_slips.length} stale link(s) cleared` : "",
          msg.cancelled_additional_salaries ? `${msg.cancelled_additional_salaries} Additional Salary row(s) cancelled` : "",
          msg.cancelled_journal_entries?.length ? `${msg.cancelled_journal_entries.length} JE(s) cancelled` : "",
          msg.cleared_accrual_reference ? "Accrual reference cleared (JE kept — owned by another batch)" : "",
          msg.deleted_batch ? "Batch deleted" : "Batch reset to Draft",
        ].filter(Boolean).join(" · ");
        frappe.show_alert({ message: summary || "Done", indicator: "green" }, 8);
        if (delete_batch) {
          frappe.set_route("List", "Bulk Salary Creation");
          return;
        }
        await frm.reload_doc();
        if (typeof bs_bootstrap_main_ui === "function") {
          await bs_bootstrap_main_ui(frm);
        }
      } catch (e) {
        frappe.dom.unfreeze();
        frappe.msgprint({ title: "Reset failed", message: e.message || String(e), indicator: "red" });
      }
    },
    () => {},
  );
}
window.bs_reset_bulk_batch = bs_reset_bulk_batch;

window.bs_manage_salary_slip = async (id, action) => {
  const frm = window._bs.frm;
  const row = (window._bs.rows || []).find((r) => r._id === id);
  if (!row || !row.row_name || !row.salary_slip) return;

  const labels = {
    delete_draft: "Delete Draft Slip",
    cancel_unlink: "Cancel & Unlink Slip",
    unlink: "Unlink Existing Slip",
  };
  const prompts = {
    delete_draft: `Delete draft Salary Slip ${row.salary_slip}?`,
    cancel_unlink: `Cancel and unlink Salary Slip ${row.salary_slip}?`,
    unlink: `Unlink Salary Slip ${row.salary_slip} from this batch row?`,
  };

  frappe.confirm(prompts[action] || "Continue?", async () => {
    frappe.dom.freeze(labels[action] || "Updating Salary Slip...");
    try {
      await bs_call("payroll_bulk.api.unlink_bulk_salary_slip", {
        batch_name: frm.doc.name,
        row_name: row.row_name,
        action,
      });
      row.salary_slip = "";
      row.salary_slip_status = "";
      row.status = "Pending";
      row.payment_entry = "";
      row.error_message = "";
      row.slip_cancelled_on = "";
      const child = bs_find_child_row(frm, row);
      if (child) {
        child.salary_slip = "";
        child.salary_slip_status = "";
        child.status = "Pending";
        child.payment_entry = "";
        child.error_message = "";
        child.slip_cancelled_on = "";
      }
      bs_sync_to_frm(frm);
      await new Promise((res, rej) => frm.save("Save", (r) => r.exc ? rej(new Error(r.exc)) : res(r)));
      await bs_refresh_all_statuses();
      bs_render_table();
      bs_render_live_summary(frm);
      frappe.show_alert({ message: labels[action] || "Salary Slip updated.", indicator: "green" }, 4);
    } catch (error) {
      frappe.msgprint({ title: "Salary Slip Action Error", message: error.message || String(error), indicator: "red" });
    } finally {
      frappe.dom.unfreeze();
    }
  });
};

window.bs_handle_edit_keydown = (event, element) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const items = [...document.querySelectorAll("#bs-table-container .bs-editable")];
  const index = items.indexOf(element);
  window._bs.next_focus_index = index >= 0 ? index + 1 : null;
  if (typeof element.blur === "function") element.blur();
};

window.bs_update_ot_type = (id, val) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  row.ot_type = "hours";
  recalc_row(row);
  bs_render_table();
};

window.bs_update_ot = (id, val) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  row.ot_input = parseFloat(val) || 0;
  row.overtime_hours = row.ot_input;
  recalc_row(row);
  bs_render_table();
};

window.bs_update_amount = (id, fieldname, val) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  const parsed = parseFloat(val) || 0;
  if (fieldname === "payment_days" || fieldname === "absent_days") {
    row[fieldname] = Math.max(0, Math.round(parsed));
  } else if (fieldname === "piece_rate") {
    row[fieldname] = Math.max(0, parsed);
  } else {
    row[fieldname] = Math.max(0, bs_round_money(parsed));
  }
  recalc_row(row);
  bs_render_table();
};

window.bs_toggle_piece_part = (id, fieldname, checked) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  if (fieldname === "use_hours" && row.overtime_with_salary) {
    row.use_hours = 1;
    bs_render_table();
    return;
  }
  row[fieldname] = checked ? 1 : 0;
  recalc_row(row);
  bs_render_table();
};

window.bs_update_piece_basis = (id, val) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  row.piece_basis = val || "Total Hours";
  recalc_row(row);
  bs_render_table();
};

window.bs_update_component_amount = (id, encoded_key, val) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  const key = decodeURIComponent(encoded_key || "");
  const item = (row.components || []).find(
    (component) => component.key === key
      || component.component === key
      || bs_normalize_component_key(component.type, component.component) === key,
  );
  if (!item || item.auto_calculated) return;
  item.amount = bs_round_money(Math.max(0, parseFloat(val) || 0));
  item.key = item.key || bs_normalize_component_key(item.type, item.component);
  bs_capture_row_saved_components(row);
  recalc_row(row);
  bs_render_table();
};

window.bs_set_advance_deduct = (row_id, val) => {
  const row = window._bs.rows.find((r) => r._id === row_id);
  if (!row) return;
  const balance = bs_get_advance_closing_balance(row);
  row.adv_deduct = Math.min(bs_round_money(Math.max(0, parseFloat(val) || 0)), balance);
  if (row.advances?.[0]) row.advances[0].deduct = row.adv_deduct;
  recalc_row(row);
  bs_render_table();
};

window.bs_update_adv_deduct = (row_id, adv_idx, val) => {
  bs_set_advance_deduct(row_id, val);
};

window.bs_fetch_advances_for = (row_id) => {
  const row = window._bs.rows.find((r) => r._id === row_id);
  if (!row) return;
  fetch_advances_for_row(row).then(() => bs_render_table());
};

window.bs_open_doc = (doctype, name) => {
  if (!doctype || !name) return;
  window.open(`/app/${frappe.router.slug(doctype)}/${name}`, "_blank");
};

window.bs_create_accrual_journal_entry = async () => {
  const frm = window._bs.frm;
  if (!frm || !frm.doc.name) {
    frappe.show_alert({ message: "Save the batch first.", indicator: "orange" }, 4);
    return;
  }
  const invalid_rows = bs_get_invalid_structure_rows();
  if (invalid_rows.length) {
    frappe.show_alert({ message: "Fix Salary Structure issues before accrual.", indicator: "red" }, 5);
    return;
  }

  const pw = bs_create_process_window({
    title: "Creating Accrual Journal Entry",
    subtitle: frm.doc.name,
    modal: true,
  });
  pw.log("Validating batch and salary slips…");

  try {
    pw.log("Creating accrual journal entry on server…");
    const res = await bs_call("payroll_bulk.api.create_bulk_accrual_journal_entry", {
      batch_name: frm.doc.name,
    });
    const journal_entry = res.message?.journal_entry || res.journal_entry || res.message;
    const linked = res.message?.linked || res.linked;
    if (!journal_entry) {
      pw.fail("Accrual processed but no Journal Entry was returned.", "Close");
      return;
    }
    pw.log(
      linked
        ? `Linked existing Journal Entry <b>${journal_entry}</b> to this batch ✓`
        : `Journal Entry <b>${journal_entry}</b> created ✓`,
      "success",
    );
    pw.complete({
      indicator: "success",
      html: `<div class="bs-notice bs-notice-info">Accrual Journal Entry <b>${journal_entry}</b> is ${linked ? "linked" : "ready"}.</div>`,
      button_label: "Done",
    });
    pw.on_done(async () => {
      await frm.set_value("accrual_journal_entry", journal_entry);
      if (typeof render_submitted_view === "function" && bs_should_show_report_view(frm.doc)) {
        window._bs._completed_view_batch = null;
        render_submitted_view(frm);
      } else if (typeof bs_render_table === "function") {
        bs_render_table();
      }
      frappe.show_alert({ message: `Accrual Journal Entry ${journal_entry} ready.`, indicator: "green" }, 5);
    });
  } catch (error) {
    pw.fail(error.message || String(error), "Close");
  }
};

window.bs_new_assignment = (employee, salary_structure = "") => {
  if (!employee) return;
  frappe.route_options = {
    employee,
    salary_structure: salary_structure || undefined,
    from_date: window._bs.frm?.doc?.start_date || frappe.datetime.get_today(),
    company: window._bs.frm?.doc?.company || frappe.defaults.get_default("company"),
  };
  frappe.new_doc("Salary Structure Assignment");
};

window.bs_refresh_row_status = async (row_id, options = {}) => {
  const row = window._bs.rows.find((r) => r._id === row_id);
  if (!row) return;

  try {
    if (row.salary_slip) {
      const slip = await bs_call("frappe.client.get_value", {
        doctype: "Salary Slip",
        filters: { name: row.salary_slip },
        fieldname: ["docstatus", "gross_pay", "net_pay", "salary_structure", "bulk_salary_creation", "bulk_salary_creation_employee", "payment_days", "absent_days", "total_working_days"],
      });
      const m = slip.message || {};
      row.salary_slip_status = parseInt(m.docstatus || 0, 10) === 1 ? "Submitted" : (parseInt(m.docstatus || 0, 10) === 2 ? "Cancelled" : "Draft");
      row.salary_structure = m.salary_structure || row.salary_structure || "";
      row.gross = parseFloat(m.gross_pay || row.gross || 0);
      row.net = parseFloat(m.net_pay || row.net || 0);
      row.payment_days = parseFloat(m.payment_days || row.payment_days || 0);
      row.absent_days = parseFloat(m.absent_days || row.absent_days || 0);
      row.attendance_days = parseFloat(m.total_working_days || row.attendance_days || 0);
      row.status = row.salary_slip_status === "Submitted" ? "Submitted" : (row.salary_slip_status === "Cancelled" ? "Cancelled" : "Slip Created");
      if (row.salary_slip_status === "Cancelled" && !row.slip_cancelled_on) {
        row.slip_cancelled_on = frappe.datetime.now_datetime();
      }
    }

    if (row.payment_entry) {
      const payment = await bs_call("frappe.client.get_value", {
        doctype: "Journal Entry",
        filters: { name: row.payment_entry },
        fieldname: ["docstatus"],
      });
      const p = payment.message || {};
      row.payment_status = parseInt(p.docstatus || 0, 10) === 1 ? "Paid" : (parseInt(p.docstatus || 0, 10) === 2 ? "Cancelled" : "Payment Created");
    }

    bs_render_table();
    if (!options.silent) {
      frappe.show_alert({ message: `Status refreshed for ${row.employee}`, indicator: "green" }, 3);
    }
  } catch (e) {
    if (!options.silent) {
      frappe.msgprint({ title: "Refresh Error", message: e.message || String(e), indicator: "red" });
    } else {
      throw e;
    }
  }
};

async function bs_refresh_all_statuses() {
  const rows = window._bs.rows || [];
  if (!rows.length) {
    frappe.show_alert({ message: "No rows to refresh.", indicator: "orange" }, 3);
    return;
  }
  frappe.show_alert({ message: "Refreshing all row statuses…", indicator: "blue" }, 3);
  for (const row of rows) {
    if (row.salary_slip || row.payment_entry) {
      try {
        await window.bs_refresh_row_status(row._id, { silent: true });
      } catch (e) {
        console.error(e);
      }
    }
  }
  bs_sync_to_frm(window._bs.frm);
  frappe.show_alert({ message: "All row statuses refreshed.", indicator: "green" }, 3);
}

function bs_open_submitted_slips() {
  const slips = (window._bs.rows || [])
    .filter((row) => row.salary_slip && row.salary_slip_status === "Submitted")
    .map((row) => row.salary_slip);
  if (!slips.length) {
    frappe.show_alert({ message: "No submitted slips found.", indicator: "orange" }, 3);
    return;
  }
  slips.forEach((slip, index) => {
    setTimeout(() => window.open(`/app/salary-slip/${slip}`, "_blank"), index * 150);
  });
}

async function bs_sync_batch_from_slips(frm, options = {}) {
  if (!frm?.doc?.name) return false;
  try {
    const res = await bs_call("payroll_bulk.api.sync_bulk_batch_slip_status", { batch_name: frm.doc.name });
    const payload = res.message || res || {};
    const updated = (payload.updated_count || 0) > 0;
    const status_changed = payload.processing_status && payload.processing_status !== frm.doc.processing_status;
    if ((updated || status_changed) && !options.skip_reload) {
      await frm.reload_doc();
    } else if (status_changed) {
      frm.doc.processing_status = payload.processing_status;
    }
    return updated || status_changed;
  } catch (error) {
    console.warn("Batch slip status sync failed:", error);
    return false;
  }
}

async function bs_submit_draft_slips() {
  const frm = window._bs.frm;
  await bs_sync_batch_from_slips(frm);
  const draft_rows = (window._bs.rows || frm?.doc?.employees || []).filter(
    (row) => row.salary_slip && row.salary_slip_status === "Draft",
  );
  if (!draft_rows.length) {
    frappe.show_alert({ message: "No draft Salary Slips found — all linked slips are already submitted.", indicator: "green" }, 4);
    if (frm && bs_is_completed_batch(frm.doc)) {
      window._bs._completed_view_batch = null;
      render_submitted_view(frm);
    }
    return;
  }

  frappe.dom.freeze(`Submitting ${draft_rows.length} draft Salary Slip(s)...`);
  try {
    for (const row of draft_rows) {
      const res = await bs_call("frappe.client.get", { doctype: "Salary Slip", name: row.salary_slip });
      const slip = res.message || {};
      if (parseInt(slip.docstatus || 0, 10) === 1) {
        row.salary_slip_status = "Submitted";
        row.status = "Submitted";
        row.error_message = "";
        continue;
      }
      if (parseInt(slip.docstatus || 0, 10) === 2) continue;
      try {
        await bs_call("frappe.client.submit", { doc: slip });
      } catch (submit_error) {
        const check = await bs_call("frappe.client.get", { doctype: "Salary Slip", name: row.salary_slip });
        if (parseInt(check.message?.docstatus || 0, 10) === 1) {
          row.salary_slip_status = "Submitted";
          row.status = "Submitted";
          row.error_message = "";
          continue;
        }
        throw submit_error;
      }
      row.salary_slip_status = "Submitted";
      row.status = "Submitted";
      row.error_message = "";
      const child = bs_find_child_row(frm, row);
      if (child) {
        child.salary_slip_status = "Submitted";
        child.status = "Submitted";
        child.error_message = "";
      }
    }
    await bs_sync_batch_from_slips(frm);
    if (window._bs.rows?.length) {
      bs_sync_to_frm(frm);
      await new Promise((res, rej) => frm.save("Save", (r) => (r.exc ? rej(new Error(r.exc)) : res(r))));
      bs_render_table();
      bs_render_live_summary(frm);
    }
    frappe.show_alert({ message: "Draft Salary Slips submitted.", indicator: "green" }, 4);
    if (frm && bs_is_completed_batch(frm.doc)) {
      window._bs._completed_view_batch = null;
      render_submitted_view(frm);
    }
  } catch (error) {
    frappe.msgprint({ title: "Submit Error", message: error.message || String(error), indicator: "red" });
  } finally {
    frappe.dom.unfreeze();
  }
}

window.bs_submit_saved_drafts = bs_submit_draft_slips;

function recalc_row(row) {
  const frm = window._bs.frm || { doc: {} };
  const mode = frm.doc.calculation_mode || "Manual";
  const daily = row.ctc / 30;
  const hourly = daily / 8;
  const piece_basis = frm.doc.per_piece_basis || "Total Hours";

  row.attendance_days = parseFloat(row.attendance_days || 0);
  row.absent_days = parseFloat(row.absent_days || 0);
  row.attendance_hours = parseFloat(row.attendance_hours || 0);
  row.payment_days = parseFloat(row.payment_days || 0);
  row.source_hours = parseFloat(row.source_hours || 0);
  row.source_qty = parseFloat(row.source_qty || 0);
  row.piece_rate = parseFloat(row.piece_rate || 0);
  row.use_hours = piece_basis === "Total Hours" ? 1 : 0;
  row.use_qty = piece_basis === "Total Qty" ? 1 : 0;
  row.overtime_with_salary = 0;
  row.ot_input = parseFloat(row.ot_input || 0);
  row.worked_hours = parseFloat(row.worked_hours || 0);
  row.shift_hours = parseFloat(row.shift_hours || 0);
  row.overtime_hours = parseFloat(row.overtime_hours || 0);

  if (bs_is_piece_mode(mode)) {
    if (piece_basis === "Total Qty") {
      row.hours_amount = 0;
      row.qty_amount = row.source_qty * row.piece_rate;
    } else {
      row.qty_amount = 0;
      row.hours_amount = hourly * row.source_hours;
    }
    row.base_pay = bs_calculate_base_pay(row, frm);
  } else {
    row.hours_amount = 0;
    row.qty_amount = 0;
    row.base_pay = bs_calculate_base_pay(row, frm);
  }

  row.ot_type = "hours";
  row.ot_amount = hourly * row.ot_input;

  const structure_doc = bs_get_cached_structure_doc(row.salary_structure || "");
  (row.components || []).forEach((item) => {
    if (!item.auto_calculated) return;
    if (item.role === "base") item.amount = row.base_pay || 0;
    if (item.role === "overtime") item.amount = row.ot_amount || 0;
    if (item.role === "qty") item.amount = bs_get_piece_qty_component_amount(row, structure_doc);
  });
  const component_totals_after = bs_get_component_totals(row);
  row.total_additions = row.ot_amount + component_totals_after.earnings;
  row.total_deductions = (row.adv_deduct || 0) + component_totals_after.deductions;
  row.gross = row.base_pay + row.total_additions;
  row.net = Math.max(0, row.gross - row.total_deductions);
  bs_round_row_money(row);
}

function bs_round_row_money(row) {
  row.base_pay = bs_round_money(row.base_pay || 0);
  row.ot_amount = bs_round_money(row.ot_amount || 0);
  row.hours_amount = bs_round_money(row.hours_amount || 0);
  row.qty_amount = bs_round_money(row.qty_amount || 0);
  row.gross = bs_round_money(row.gross || 0);
  row.net = bs_round_money(row.net || 0);
  row.total_additions = bs_round_money(row.total_additions || 0);
  row.total_deductions = bs_round_money(row.total_deductions || 0);
  row.adv_deduct = bs_round_money(row.adv_deduct || 0);
  (row.components || []).forEach((item) => {
    if (item.amount != null) item.amount = bs_round_money(item.amount);
  });
}

// ─── 8. FETCH ADVANCES ────────────────────────────────────────────────────────
function bs_get_advance_closing_balance(row) {
  const balance = parseFloat(row?.advance_balance || 0);
  if (balance > 0) return balance;
  return (row?.advances || []).reduce((sum, adv) => sum + parseFloat(adv.balance || 0), 0);
}

function bs_set_row_advance_aggregate(row, balance, items = []) {
  const closing = parseFloat(balance || 0);
  row.advance_balance = closing;
  row._advance_items = items;
  row.advances = closing > 0 ? [{
    name: "",
    purpose: "Advance",
    balance: closing,
    deduct: parseFloat(row.adv_deduct || 0),
    aggregate: true,
  }] : [];
}

function bs_hydrate_row_advances(row) {
  if (!row) return;
  const balance = parseFloat(row.advance_balance || 0);
  if (balance <= 0) return;
  if ((row.advances || []).length === 1 && row.advances[0].aggregate) return;
  bs_set_row_advance_aggregate(row, balance, row._advance_items || []);
  row.adv_fetched = true;
}

function bs_build_advances_panel_html(r) {
  if (r.adv_loading) {
    return `<span class="bs-meta-chip">Loading advances…</span>`;
  }
  const balance = bs_get_advance_closing_balance(r);
  if (!r.adv_fetched && balance <= 0) {
    return `<button type="button" class="bs-btn-ghost bs-btn-sm" onclick="fetch_advances_for_row(window._bs.rows.find(x=>x._id===${r._id})).then(()=>bs_render_table())">Load Advances</button>`;
  }
  if (balance <= 0) {
    return `<span class="bs-meta-chip">No advances</span>`;
  }
  const deduct = parseFloat(r.adv_deduct || 0);
  const deduct_value = deduct > 0 ? deduct : "";
  return `<div class="bs-adv-closing">
    <span class="bs-meta-chip bs-adv-balance-chip"><b>Advance</b> ${fmt_total(balance)}</span>
    <span class="bs-meta-chip bs-adv-deduct-chip"><b>Deduct</b>
      <input class="bs-adv-input" type="number" min="0" max="${balance}" value="${deduct_value}" placeholder="0"
        onchange="bs_set_advance_deduct(${r._id}, this.value)" />
    </span>
  </div>`;
}

async function bs_hydrate_batch_additional_salaries(frm) {
  if (!frm?.doc?.name || !window._bs.rows?.length) return;
  try {
    const res = await bs_call("payroll_bulk.api.get_batch_additional_salary_amounts", {
      batch_name: frm.doc.name,
    });
    const by_employee = res.message || res || {};
    window._bs.rows.forEach((row) => {
      const entry = by_employee[row.employee];
      if (!entry) return;
      row._batch_additional_salaries = entry.additional_salaries || [];
      if (entry.adv_deduct > 0) {
        row.adv_deduct = entry.adv_deduct;
        row.adv_fetched = true;
        bs_hydrate_row_advances(row);
        if (row.advances?.[0]) row.advances[0].deduct = row.adv_deduct;
      }
      (entry.components || []).forEach((comp) => {
        if (comp.type === "Deduction" && (comp.salary_component || "").toLowerCase().includes("advance")) {
          return;
        }
        const key = bs_normalize_component_key(comp.type, comp.salary_component);
        const existing = (row.components || []).find((c) => c.key === key);
        if (existing) {
          if (!existing.amount || existing.auto_calculated) {
            existing.amount = parseFloat(comp.amount || 0);
          }
        } else {
          row.components = row.components || [];
          row.components.push({
            key,
            component: comp.salary_component,
            label: comp.salary_component,
            type: comp.type || "Earning",
            amount: parseFloat(comp.amount || 0),
            auto_calculated: false,
            from_additional_salary: true,
          });
        }
      });
      recalc_row(row);
    });
  } catch (e) {
    console.warn("Batch Additional Salary hydration:", e);
  }
}
window.bs_hydrate_batch_additional_salaries = bs_hydrate_batch_additional_salaries;

async function bs_hydrate_batch_period_artifacts(frm) {
  if (!frm?.doc?.name || !window._bs.rows?.length) return;
  try {
    const res = await bs_call("payroll_bulk.api.get_batch_period_artifacts", { batch_name: frm.doc.name });
    const payload = res.message || res || {};
    const by_employee = payload.employees || {};
    window._bs.batch_warnings = payload.batch_warnings || [];
    window._bs.rows.forEach((row) => {
      const entry = by_employee[row.employee];
      if (!entry) return;
      row._period_mismatch = !!entry.period_mismatch;
      row._period_salary_slip = entry.period_salary_slip || "";
      row._period_salary_slip_batch = entry.period_salary_slip_batch || "";
      row._period_slip_foreign = !!entry.period_salary_slip_foreign;
      row._linked_additional_salaries = entry.linked_additional_salaries || [];
      row._foreign_additional_salaries = (entry.period_additional_salaries || []).filter((ads) => ads.foreign_batch);
      if (!row.salary_slip && entry.linked_salary_slip) {
        row.salary_slip = entry.linked_salary_slip;
        row.salary_slip_status = entry.linked_salary_slip_status || row.salary_slip_status || "";
      }
      if (!row.adv_deduct && entry.linked_additional_salaries?.length) {
        const adv_total = entry.linked_additional_salaries
          .filter((ads) => ads.type === "Deduction" && (ads.salary_component || "").toLowerCase().includes("advance"))
          .reduce((sum, ads) => sum + parseFloat(ads.amount || 0), 0);
        if (adv_total > 0) {
          row.adv_deduct = adv_total;
          row.adv_fetched = true;
        }
      }
    });
    bs_render_batch_warnings(frm);
  } catch (e) {
    console.warn("Batch period artifact hydration:", e);
  }
}
window.bs_hydrate_batch_period_artifacts = bs_hydrate_batch_period_artifacts;

function bs_render_batch_warnings(frm) {
  const warnings = window._bs.batch_warnings || [];
  const period_ok = bs_period_is_consistent({
    start_date: frm.doc.start_date,
    end_date: frm.doc.end_date,
    posting_date: frm.doc.posting_date,
    month: frm.doc.month,
  });
  const $wrap = $("#bs-main-wrap");
  if (!$wrap.length) return;
  $wrap.find("#bs-batch-warnings").remove();
  const items = [];
  if (!period_ok) {
    items.push("Batch month / start / end / posting dates are not in the same calendar month.");
  }
  warnings.forEach((msg) => items.push(msg));
  window._bs.rows.forEach((row) => {
    if (row._period_slip_foreign && row._period_salary_slip) {
      items.push(`${row.employee}: Salary Slip ${row._period_salary_slip} belongs to ${row._period_salary_slip_batch || "another batch"}.`);
    }
    (row._foreign_additional_salaries || []).forEach((ads) => {
      items.push(`${row.employee}: Additional Salary ${ads.name} belongs to ${ads.batch_name || "another batch"}.`);
    });
  });
  if (!items.length) return;
  const html = `<div id="bs-batch-warnings" class="bs-notice bs-notice-warn" style="margin:12px 0">
    <b>Existing payroll documents for this period</b><br>
    ${items.map((msg) => frappe.utils.escape_html(msg)).join("<br>")}
  </div>`;
  $wrap.find(".bs-title-container").after(html);
}
window.bs_render_batch_warnings = bs_render_batch_warnings;

async function fetch_advances_for_row(row) {
  if (!row?.employee) return;
  const saved_deduct = parseFloat(row.adv_deduct || 0);
  row.adv_loading = true;
  try {
    const company = bs_get_active_company() || window._bs.frm?.doc?.company || "";
    const args = { employee: row.employee };
    if (company) args.company = company;
    const r = await bs_call("payroll_bulk.api.get_employee_advance_balance", args);
    const msg = r.message || {};
    const items = msg.advances || [];
    const balance = parseFloat(msg.balance || 0);
    bs_set_row_advance_aggregate(row, balance, items);
    row.adv_deduct = Math.min(saved_deduct, balance);
    if (row.advances[0]) row.advances[0].deduct = row.adv_deduct;
    row.adv_fetched = true;
    row.adv_fetch_failed = false;
    recalc_row(row);
  } catch (e) {
    console.error("Advance fetch failed:", row.employee, e);
    row.adv_fetch_failed = true;
    bs_hydrate_row_advances(row);
    if (!(row.advances || []).length) {
      row.adv_fetched = false;
    }
  } finally {
    row.adv_loading = false;
  }
}
window.fetch_advances_for_row = fetch_advances_for_row;

async function bs_auto_fetch_pending_advances(rows) {
  const list = rows || window._bs.rows || [];
  const pending = list.filter((row) => row.employee);
  if (!pending.length) return;
  pending.forEach((row) => {
    bs_hydrate_row_advances(row);
    row.adv_loading = true;
  });
  bs_render_table();
  for (const row of pending) {
    await fetch_advances_for_row(row);
  }
  bs_render_table();
}
window.bs_auto_fetch_pending_advances = bs_auto_fetch_pending_advances;

async function bs_fetch_all_advances() {
  const btn = document.getElementById("bs-fetch-advances-btn");
  if (btn) { btn.textContent = "⏳ Fetching…"; btn.disabled = true; }
  for (const row of window._bs.rows) {
    if (!row.adv_fetched) await fetch_advances_for_row(row);
  }
  bs_render_table();
  if (btn) { btn.textContent = "🔄 Fetch All Advances"; btn.disabled = false; }
}

async function bs_maybe_auto_load_source(force = false) {
  const frm = window._bs.frm;
  if (!frm || !window._bs.rows.length) return;
  const mode = frm.doc.calculation_mode || "Manual";
  const needs_auto = ["Checkin Based", "Attendance Based"].includes(mode)
    || (bs_is_piece_mode(mode) && frm.doc.overtime_source === "Custom DocType" && frm.doc.overtime_doctype);
  if (!needs_auto && !force) return;
  if (!frm.doc.start_date || !frm.doc.end_date) return;
  const looks_unloaded = window._bs.rows.some((row) => {
    if (["Checkin Based", "Attendance Based"].includes(mode)) {
      return !parseFloat(row.payment_days || 0) && !parseFloat(row.attendance_days || 0);
    }
    return false;
  });
  if (!force && !looks_unloaded) return;
  await bs_load_source_data({ silent: true });
}

async function bs_prepare_source_load(frm) {
  bs_sync_period_from_header(frm);
  await bs_sync_source_doc(frm);
  const start_date = frm.doc.start_date || "";
  const end_date = frm.doc.end_date || "";
  const employees = (window._bs.rows || []).map((row) => row.employee).filter(Boolean);
  return { start_date, end_date, employees };
}

async function bs_load_days_data(options = {}) {
  const silent = !!options.silent;
  const frm = window._bs.frm;
  if (!frm || !window._bs.rows.length || !bs_needs_days_load(frm)) return false;
  const { start_date, end_date, employees } = await bs_prepare_source_load(frm);
  if (!start_date || !end_date || !employees.length) return false;

  const source = bs_get_days_attendance_source(frm);
  const att = await bs_call("payroll_bulk.api.get_bulk_attendance_values", {
    employees,
    source,
    start_date,
    end_date,
  });
  const source_rows = att.message || {};
  window._bs.rows.forEach((row) => {
    const item = source_rows[row.employee] || {};
    row.attendance_days = parseFloat(item.attendance_days || 0);
    row.absent_days = parseFloat(item.absent_days || 0);
    row.attendance_hours = parseFloat(item.attendance_hours || 0);
    row.payment_days = parseFloat(item.payment_days || 0);
    recalc_row(row);
  });
  window._bs.loaded_days_period = bs_period_key(start_date, end_date);
  if (!silent) frappe.show_alert({ message: "Days loaded for selected period.", indicator: "green" }, 3);
  return true;
}

async function bs_load_overtime_data(options = {}) {
  const silent = !!options.silent;
  const frm = window._bs.frm;
  if (!frm || !window._bs.rows.length) return false;
  const overtime_source = bs_get_active_overtime_source(frm);
  if (overtime_source === "Manual") {
    bs_apply_overtime_source_to_rows(frm);
    return false;
  }
  if (!bs_needs_overtime_load(frm)) return false;
  const { start_date, end_date, employees } = await bs_prepare_source_load(frm);
  if (!start_date || !end_date || !employees.length) return false;

  if (overtime_source === "Employee Checkin Difference") {
    const overtime = await bs_call("payroll_bulk.api.get_bulk_checkin_overtime_values", {
      employees,
      start_date,
      end_date,
      ot_method: "out_in",
    });
    const checkin_overtime_rows = overtime.message || {};
    window._bs.rows.forEach((row) => {
      const item = checkin_overtime_rows[row.employee] || {};
      row.worked_hours = parseFloat(item.worked_hours || 0);
      row.shift_hours = parseFloat(item.shift_hours || 0);
      row.overtime_hours = parseFloat(item.overtime_hours || 0);
      row.ot_input = row.overtime_hours;
      recalc_row(row);
    });
  } else if (overtime_source === "Custom DocType") {
    if (!frm.doc.overtime_doctype || !frm.doc.overtime_employee_field || !frm.doc.overtime_date_field) {
      if (!silent) frappe.show_alert({ message: "Set Custom DocType mapping for Overtime.", indicator: "red" }, 4);
      return false;
    }
    const res = await bs_call("payroll_bulk.api.get_bulk_source_values", {
      employees,
      source_doctype: frm.doc.overtime_doctype,
      employee_field: frm.doc.overtime_employee_field,
      date_field: frm.doc.overtime_date_field,
      hours_field: frm.doc.overtime_hours_field || "",
      qty_field: "",
      rate_field: "",
      start_date,
      end_date,
      batch_name: frm.doc.name || "",
    });
    const imported_rows = res.message || {};
    window._bs.rows.forEach((row) => {
      const item = imported_rows[row.employee] || {};
      row.ot_input = parseFloat(item.hours || 0);
      row.overtime_hours = row.ot_input;
      recalc_row(row);
    });
  }
  window._bs.loaded_overtime_period = bs_period_key(start_date, end_date);
  if (!silent) frappe.show_alert({ message: "Overtime loaded for selected period.", indicator: "green" }, 3);
  return true;
}

async function bs_load_piece_salary_data(options = {}) {
  const silent = !!options.silent;
  const frm = window._bs.frm;
  if (!frm || !window._bs.rows.length || !bs_needs_piece_salary_load(frm)) return false;
  const { start_date, end_date, employees } = await bs_prepare_source_load(frm);
  if (!start_date || !end_date || !employees.length) return false;
  if (!frm.doc.overtime_doctype || !frm.doc.overtime_employee_field || !frm.doc.overtime_date_field) {
    if (!silent) frappe.show_alert({ message: "Set Source DocType mapping for Per Piece salary.", indicator: "red" }, 4);
    return false;
  }

  const piece_basis = frm.doc.per_piece_basis || "Total Hours";
  const res = await bs_call("payroll_bulk.api.get_bulk_source_values", {
    employees,
    source_doctype: frm.doc.overtime_doctype,
    employee_field: frm.doc.overtime_employee_field,
    date_field: frm.doc.overtime_date_field,
    hours_field: piece_basis === "Total Hours" ? (frm.doc.overtime_hours_field || "") : "",
    qty_field: piece_basis === "Total Qty" ? (frm.doc.overtime_qty_field || "") : "",
    rate_field: piece_basis === "Total Qty" ? (frm.doc.overtime_rate_field || "") : "",
    start_date,
    end_date,
    batch_name: frm.doc.name || "",
  });
  const imported_rows = res.message || {};
  window._bs.rows.forEach((row) => {
    const item = imported_rows[row.employee] || {};
    row.source_row_names = item.row_names || [];
    if (piece_basis === "Total Qty") {
      row.source_qty = parseFloat(item.qty || 0);
      row.piece_rate = parseFloat(item.rate || 0);
      row.source_hours = 0;
    } else {
      row.source_hours = parseFloat(item.hours || 0);
      row.source_qty = 0;
      row.piece_rate = 0;
    }
    recalc_row(row);
  });
  const linked_source_rows = window._bs.rows.flatMap((row) => row.source_row_names || []);
  if (linked_source_rows.length) {
    await bs_call("payroll_bulk.api.mark_bulk_source_rows", {
      source_doctype: frm.doc.overtime_doctype,
      row_names: linked_source_rows,
      batch_name: frm.doc.name || "",
    });
  }
  window._bs.loaded_piece_period = bs_period_key(start_date, end_date);
  if (!silent) frappe.show_alert({ message: "Piece salary loaded for selected period.", indicator: "green" }, 3);
  return true;
}

async function bs_load_source_data(options = {}) {
  const silent = !!options.silent;
  const frm = window._bs.frm;
  if (!frm || !window._bs.rows.length) {
    frappe.show_alert({ message: "Add employees before loading source data.", indicator: "orange" }, 4);
    return;
  }
  const btn = document.getElementById("bs-load-source-btn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Loading..."; }
  try {
    await bs_load_days_data({ silent: true });
    await bs_load_piece_salary_data({ silent: true });
    await bs_load_overtime_data({ silent: true });
    const { start_date, end_date } = await bs_prepare_source_load(frm);
    window._bs.loaded_source_period = bs_period_key(start_date, end_date);
    bs_render_table();
    if (!silent) frappe.show_alert({ message: "Days, salary, and overtime loaded.", indicator: "green" }, 3);
  } catch (error) {
    if (!silent) frappe.msgprint({ title: "Source Load Error", message: error.message || String(error), indicator: "red" });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⭳ Load Source Data"; }
  }
}

// ─── 17. SUBMITTED READ-ONLY VIEW ─────────────────────────────────────────────
async function bs_show_batch_report_view(frm) {
  if (!frm?.doc?.name) return;
  window._bs = window._bs || {};
  window._bs.frm = frm;
  window._bs._completed_view_batch = null;
  window._bs._sync_in_flight = null;
  try {
    await frm.reload_doc();
  } catch (error) {
    console.warn("Batch report reload failed:", error);
  }
  render_submitted_view(frm);
}
window.bs_show_batch_report_view = bs_show_batch_report_view;

async function bs_return_to_edit_mode(frm) {
  frm = frm || window._bs?.frm || (typeof cur_frm !== "undefined" ? cur_frm : null);
  if (!frm?.doc?.name || frm.doc.docstatus === 1) {
    frappe.show_alert({ message: "Submitted batches cannot be edited here.", indicator: "orange" }, 4);
    return;
  }
  window._bs = window._bs || {};
  window._bs._force_edit_mode = true;
  window._bs._completed_view_batch = null;
  window._bs._sync_in_flight = null;
  window._bs.frm = frm;
  frm.doc.processing_status = "Partially Processed";
  frappe.dom.freeze("Opening edit mode…");
  try {
    frappe.call({
      method: "frappe.client.set_value",
      args: {
        doctype: "Bulk Salary Creation",
        name: frm.doc.name,
        fieldname: "processing_status",
        value: "Partially Processed",
      },
      freeze: false,
      async: true,
    });
    await bs_bootstrap_main_ui(frm);
    frappe.show_alert({ message: "Edit mode — fix dates, reload source, then recreate draft slips.", indicator: "blue" }, 5);
  } catch (error) {
    frappe.msgprint({ title: "Could not open edit mode", message: error.message || String(error), indicator: "red" });
  } finally {
    frappe.dom.unfreeze();
  }
}
window.bs_return_to_edit_mode = bs_return_to_edit_mode;

function render_submitted_view(frm) {
  window._bs.frm = frm;
  const $body = frm.layout.wrapper.find(".form-page");
  const batch_name = frm.doc.name;

  if (window._bs._completed_view_batch === batch_name) {
    render_submitted_view_content(frm, $body);
    return;
  }

  if (window._bs._sync_in_flight === batch_name) {
    return;
  }
  window._bs._sync_in_flight = batch_name;

  bs_sync_batch_from_slips(frm, { skip_reload: true })
    .then(async () => {
      if (!bs_should_show_report_view(frm.doc)) {
        window._bs._completed_view_batch = null;
        await bs_bootstrap_main_ui(frm);
        return;
      }
      window._bs._completed_view_batch = batch_name;
      render_submitted_view_content(frm, $body);
    })
    .catch(async () => {
      if (!bs_should_show_report_view(frm.doc)) {
        await bs_bootstrap_main_ui(frm);
        return;
      }
      render_submitted_view_content(frm, $body);
    })
    .finally(() => {
      window._bs._sync_in_flight = null;
    });
}

async function bs_build_reconcile_panel_html(frm) {
  const rows_with_slips = (frm.doc.employees || []).filter((r) => r.salary_slip).length;
  if (!rows_with_slips || !frm.doc.name) {
    return "";
  }
  let data = { rows: [], summary: { total: 0, matched: 0, mismatched: 0, missing_slip: 0, no_row: 0 } };
  try {
    const res = await bs_call("payroll_bulk.api.get_batch_slip_reconciliation", { batch_name: frm.doc.name });
    data = res.message || data;
  } catch (error) {
    return `<div class="bs-reconcile-panel"><div class="bs-reconcile-title">Slip Reconciliation</div><div class="bs-notice bs-notice-warn">Could not load reconciliation data.</div></div>`;
  }

  const summary = data.summary || {};
  const issues = (data.rows || []).filter((r) => !r.match);
  const show_rows = issues.length ? issues : (data.rows || []).slice(0, 8);
  const mismatch_count = summary.mismatched || 0;
  const zero_count = summary.zero_slip || 0;
  const all_matched = mismatch_count === 0 && summary.matched === summary.total && summary.total > 0;
  const mismatch_notice = mismatch_count
    ? `<div class="bs-notice bs-notice-warn" style="margin-bottom:10px">
        <b>${mismatch_count} issue(s)</b>${zero_count ? ` including ${zero_count} empty/zero slip(s)` : ""}.
        Do not submit drafts yet.
        Click <b>Edit Batch</b> → Load Source → recreate draft slips with <b>Cancel and Recreate</b>.
      </div>`
    : all_matched
      ? `<div class="bs-notice bs-notice-success" style="margin-bottom:10px">
          All ${summary.matched} slip(s) match expected batch amounts. You can submit drafts when ready.
        </div>`
      : "";

  const trs = show_rows.map((r) => `
    <tr class="${r.match ? "bs-reconcile-row-ok" : "bs-reconcile-row-bad"}">
      <td>${frappe.utils.escape_html(r.employee_name || r.employee || "")}</td>
      <td>${r.salary_slip ? `<a href="/app/salary-slip/${r.salary_slip}" target="_blank" class="bs-mono">${r.salary_slip.split("/").pop()}</a>` : "—"}</td>
      <td>${fmt_num(r.batch_gross || 0)}</td>
      <td>${fmt_num(r.slip_gross || 0)}</td>
      <td style="color:${Math.abs(r.gross_diff || 0) > 1 ? "var(--bs-red)" : ""}">${fmt_num(r.gross_diff || 0)}</td>
      <td>${fmt_num(r.batch_net || 0)}</td>
      <td>${fmt_num(r.slip_net || 0)}</td>
      <td style="color:${Math.abs(r.net_diff || 0) > 1 ? "var(--bs-red)" : ""}">${fmt_num(r.net_diff || 0)}</td>
      <td>${r.match ? `<span class="bs-status-badge bs-status-ok">OK</span>` : `<span class="bs-status-badge bs-status-fail">${frappe.utils.escape_html(r.issue || "Issue")}</span>`}</td>
    </tr>`).join("");

  const batch_arg = encodeURIComponent(frm.doc.name);
  return `
    <div class="bs-reconcile-panel">
      <div class="bs-reconcile-head">
        <div class="bs-reconcile-title">Slip Reconciliation — Batch vs Salary Slip</div>
        <div class="bs-reconcile-kpis">
          <span class="bs-reconcile-kpi bs-reconcile-kpi-ok">Matched ${summary.matched || 0}</span>
          <span class="bs-reconcile-kpi bs-reconcile-kpi-bad">Mismatch ${summary.mismatched || 0}</span>
          ${zero_count ? `<span class="bs-reconcile-kpi bs-reconcile-kpi-bad">Zero ${zero_count}</span>` : ""}
          <span class="bs-reconcile-kpi bs-reconcile-kpi-warn">Missing ${summary.missing_slip || 0}</span>
          ${summary.no_row ? `<span class="bs-reconcile-kpi bs-reconcile-kpi-warn">Orphan ${summary.no_row}</span>` : ""}
        </div>
      </div>
      ${mismatch_notice}
      <div class="bs-table-scroll" style="max-height:240px">
        <table class="bs-reconcile-table">
          <thead><tr>
            <th>Employee</th><th>Slip</th><th>Expected Gross</th><th>Slip Gross</th><th>Diff</th>
            <th>Expected Net</th><th>Slip Net</th><th>Diff</th><th>Status</th>
          </tr></thead>
          <tbody>${trs || `<tr><td colspan="9" style="text-align:center;color:var(--bs-muted)">No rows to compare</td></tr>`}</tbody>
        </table>
      </div>
      <div class="bs-footer-row" style="margin-top:8px">
        <button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_sync_batch_from_slips(window._bs.frm).then(()=>render_submitted_view(window._bs.frm))">Sync from Slips</button>
        <button type="button" class="bs-btn-ghost bs-btn-sm" onclick="frappe.set_route('query-report','Bulk Salary Slip Reconciliation', {batch: decodeURIComponent('${batch_arg}')})">Open Full Report</button>
      </div>
    </div>`;
}

window.bs_open_reconcile_report = (batch_name) => {
  frappe.set_route("query-report", "Bulk Salary Slip Reconciliation", { batch: batch_name || window._bs.frm?.doc?.name });
};

async function render_submitted_view_content(frm, $body) {
  const reconcile_html = await bs_build_reconcile_panel_html(frm);
  const rows = frm.doc.employees || [];
  const draft_count = rows.filter((r) => r.salary_slip && r.salary_slip_status === "Draft").length;
  const unpaid_count = rows.filter((r) => r.salary_slip_status === "Submitted" && !r.payment_entry).length;
  const paid_count = rows.filter((r) => r.payment_entry).length;
  const report_status = frm.doc.processing_status || (draft_count ? "Draft Slips Created" : "Completed");

  let summary = { columns: [], totals: {}, remark: "", payment_journals: [] };
  try {
    const res = await bs_call("payroll_bulk.api.get_batch_completed_summary", { batch_name: frm.doc.name });
    summary = res.message || summary;
  } catch (error) {
    console.warn("Could not load batch summary:", error);
  }

  let stale_link_warning = "";
  try {
    const artifact_res = await bs_call("payroll_bulk.api.get_batch_period_artifacts", { batch_name: frm.doc.name });
    const payload = artifact_res.message || artifact_res || {};
    const stale = Object.entries(payload.employees || {}).filter(([, entry]) => (
      entry.linked_salary_slip && entry.period_salary_slip_foreign
    ));
    const lines = [];
    if (stale.length) {
      lines.push("This batch shows salary slips that belong to another batch. Use Reset / Cancel All to clear stale links.");
    }
    (payload.batch_warnings || []).forEach((msg) => lines.push(msg));
    if (lines.length) {
      stale_link_warning = `<div class="bs-notice bs-notice-warn bs-mb"><b>Link / period warnings</b><br>${lines.map((w) => frappe.utils.escape_html(w)).join("<br>")}</div>`;
    }
  } catch (error) {
    console.warn("Batch artifact check:", error);
  }

  const component_cols = bs_merge_component_columns(summary.columns || []);
  const comp_by_employee = {};
  const emp_summary_by_id = {};
  (summary.employees || []).forEach((item) => {
    comp_by_employee[item.employee] = item.components || {};
    emp_summary_by_id[item.employee] = item;
  });

  const totals = summary.totals || {
    ctc: rows.reduce((s, r) => s + parseFloat(r.ctc || 0), 0),
    ot_amount: rows.reduce((s, r) => s + parseFloat(r.ot_amount || 0), 0),
    gross_pay: rows.reduce((s, r) => s + parseFloat(r.gross_pay || 0), 0),
    adv_deduct: rows.reduce((s, r) => s + parseFloat(r.adv_deduct || 0), 0),
    net_pay: rows.reduce((s, r) => s + parseFloat(r.net_pay || 0), 0),
    components: {},
  };

  const merged_component_totals = {};
  component_cols.forEach((col) => {
    merged_component_totals[col.key] = rows.reduce((s, r) => s + bs_get_merged_component_value(comp_by_employee[r.employee] || {}, col.key), 0);
  });

  const component_header = component_cols
    .map((col) => `<th class="bs-th bs-th-num bs-th-comp" title="${frappe.utils.escape_html(col.label)}">${frappe.utils.escape_html(col.label)}</th>`)
    .join("");

  const trs = rows.map((r) => {
    const comps = comp_by_employee[r.employee] || {};
    const display_status = bs_get_row_display_status(r);
    const salary_pay = emp_summary_by_id[r.employee]?.base_pay ?? (r.base_pay != null ? bs_round_money(r.base_pay) : bs_row_base_pay(r, frm));
    const component_cells = component_cols
      .map((col) => {
        const val = bs_get_merged_component_value(comps, col.key);
        const cls = col.type === "deduction" ? "color:var(--bs-red)" : "";
        return `<td class="bs-td bs-td-num bs-td-comp" style="${cls}">${val ? fmt_num(val) : "—"}</td>`;
      })
      .join("");
    return `
    <tr class="bs-row">
      <td class="bs-td bs-td-sticky bs-report-col-emp">${bs_build_emp_cell_html(r, { compact: true, report: true })}</td>
      <td class="bs-td bs-col-dept"><div class="bs-dept-cell" title="${frappe.utils.escape_html(r.department || "")}">${frappe.utils.escape_html(r.department || "—")}</div></td>
      <td class="bs-td bs-td-num">${fmt_total(r.ctc || 0)}</td>
      <td class="bs-td bs-td-num">${fmt_total(salary_pay)}</td>
      <td class="bs-td bs-td-num bs-money-ot">${fmt_total(r.ot_amount || 0)}</td>
      ${component_cells}
      <td class="bs-td bs-td-num">${fmt_total(r.gross_pay || r.gross || 0)}</td>
      <td class="bs-td bs-td-num" style="color:var(--bs-red)">${fmt_total(r.adv_deduct || 0)}</td>
      <td class="bs-td bs-td-num" style="font-weight:700;color:var(--bs-green)">${fmt_total(r.net_pay || 0)}</td>
      <td class="bs-td">${r.salary_slip ? `<a href="/app/salary-slip/${r.salary_slip}" target="_blank" class="bs-mono">${r.salary_slip.split("/").pop()}</a>` : `<span style="color:var(--bs-muted)">—</span>`}</td>
      <td class="bs-td">${r.payment_entry ? `<button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Journal Entry','${r.payment_entry}')">${r.payment_entry.split("-").slice(-1)[0]}</button>` : (r.salary_slip_status === "Submitted" ? `<button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_create_single_payment('${r.employee}')">Pay</button>` : "—")}</td>
      <td class="bs-td"><span class="bs-status-badge bs-status-${display_status.cls}">${display_status.label}</span></td>
    </tr>`;
  }).join("");

  const total_component_cells = component_cols
    .map((col) => {
      const val = parseFloat(merged_component_totals[col.key] || 0);
      return `<td class="bs-td bs-td-num bs-td-comp" style="font-weight:700">${val ? fmt_num(val) : "—"}</td>`;
    })
    .join("");

  const total_salary = rows.reduce((s, r) => {
    const item = emp_summary_by_id[r.employee];
    return s + (item?.base_pay ?? bs_row_base_pay(r, frm));
  }, 0);
  const totals_row = `
    <tr class="bs-row bs-total-row">
      <td class="bs-td bs-td-sticky bs-report-col-emp">TOTAL (${rows.length})</td>
      <td class="bs-td"></td>
      <td class="bs-td bs-td-num">${fmt_total(totals.ctc || 0)}</td>
      <td class="bs-td bs-td-num">${fmt_total(total_salary)}</td>
      <td class="bs-td bs-td-num">${fmt_total(totals.ot_amount || 0)}</td>
      ${total_component_cells}
      <td class="bs-td bs-td-num">${fmt_total(totals.gross_pay || 0)}</td>
      <td class="bs-td bs-td-num">${fmt_total(totals.adv_deduct || 0)}</td>
      <td class="bs-td bs-td-num" style="color:var(--bs-green)">${fmt_total(totals.net_pay || 0)}</td>
      <td class="bs-td" colspan="3"></td>
    </tr>`;

  const accounting_rows = [];
  if (frm.doc.accrual_journal_entry) {
    accounting_rows.push(`<div class="bs-accounting-row"><span>Accrual JE</span><button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Journal Entry','${frm.doc.accrual_journal_entry}')">${frm.doc.accrual_journal_entry}</button></div>`);
  }
  if (frm.doc.bulk_payment_entry) {
    accounting_rows.push(`<div class="bs-accounting-row"><span>Bulk Payment JE</span><button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Journal Entry','${frm.doc.bulk_payment_entry}')">${frm.doc.bulk_payment_entry}</button></div>`);
  }
  (summary.payment_journals || []).forEach((name) => {
    if (name && name !== frm.doc.bulk_payment_entry) {
      accounting_rows.push(`<div class="bs-accounting-row"><span>Payment JE</span><button type="button" class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Journal Entry','${name}')">${name}</button></div>`);
    }
  });
  if (summary.remark) {
    accounting_rows.push(`<div class="bs-accounting-row"><span>JV Remark</span><span>${frappe.utils.escape_html(summary.remark)}</span></div>`);
  }

  const pipeline_html = bs_build_pipeline_html(frm, rows, draft_count, unpaid_count);
  const kpi_html = `
    <div class="bs-kpi-grid">
      <div class="bs-kpi-card"><div class="bs-kpi-label">Employees</div><div class="bs-kpi-value">${rows.length}</div></div>
      <div class="bs-kpi-card"><div class="bs-kpi-label">Gross Pay</div><div class="bs-kpi-value">${fmt_total(totals.gross_pay || 0)}</div></div>
      <div class="bs-kpi-card"><div class="bs-kpi-label">Deductions</div><div class="bs-kpi-value bs-kpi-value-red">${fmt_total(totals.adv_deduct || 0)}</div></div>
      <div class="bs-kpi-card"><div class="bs-kpi-label">Net Paid</div><div class="bs-kpi-value bs-kpi-value-green">${fmt_total(totals.net_pay || 0)}</div></div>
      <div class="bs-kpi-card"><div class="bs-kpi-label">Submitted</div><div class="bs-kpi-value">${rows.filter((r) => r.salary_slip_status === "Submitted").length}</div></div>
      <div class="bs-kpi-card"><div class="bs-kpi-label">Paid</div><div class="bs-kpi-value bs-kpi-value-green">${paid_count}</div></div>
    </div>`;

  $body.find("#bs-main-wrap").remove();
  $body.prepend($(`
    <div id="bs-main-wrap"><div class="bs-wrap">
      <div class="bs-header-card">
        <div class="bs-header-icon" style="background:linear-gradient(135deg,#166534,#14532d)">✓</div>
        <div style="flex:1">
          <div class="bs-header-title">Bulk Salary — ${report_status}</div>
          <div class="bs-header-sub">
            ${frm.doc.company || "—"} · ${frm.doc.start_date || "—"} → ${frm.doc.end_date || "—"} · ${frm.doc.payroll_frequency || "—"}
            ${frm.doc.posting_date ? ` · Posting ${frm.doc.posting_date}` : ""}
          </div>
          <div class="bs-pipeline">${pipeline_html}</div>
        </div>
        ${frm.doc.docstatus === 0 ? `<button type="button" class="bs-btn-secondary" onclick="bs_return_to_edit_mode()">✎ Edit Batch</button>` : ""}
      </div>
      ${kpi_html}
      ${stale_link_warning}
      ${reconcile_html}
      ${accounting_rows.length ? `<div class="bs-accounting-panel"><div class="bs-accounting-title">Accounting</div>${accounting_rows.join("")}</div>` : ""}
      <div class="bs-footer-row bs-mb">
        ${frm.doc.docstatus === 0 ? `<button type="button" class="bs-btn-secondary" onclick="bs_return_to_edit_mode()">✎ Edit Batch</button>` : ""}
        ${draft_count ? `<button type="button" class="bs-btn-primary" onclick="bs_submit_saved_drafts()">Submit ${draft_count} Draft${draft_count > 1 ? "s" : ""}</button>` : ""}
        ${unpaid_count ? `<button type="button" class="bs-btn-primary" onclick="bs_create_bulk_payment_completed()">Pay All (${unpaid_count})</button>` : ""}
        ${!frm.doc.accrual_journal_entry ? `<button type="button" class="bs-btn-secondary" onclick="bs_create_accrual_journal_entry()">Create Accrual JE</button>` : ""}
        <button type="button" class="bs-btn-secondary bs-btn-danger-outline" onclick="bs_reset_bulk_batch({ delete_batch: 0 })">Reset / Cancel All</button>
        <button type="button" class="bs-btn-secondary bs-btn-danger-outline" onclick="bs_reset_bulk_batch({ delete_batch: 1 })">Delete Batch</button>
        <button type="button" class="bs-btn-secondary" onclick="bs_export_batch_csv(window._bs.frm?.doc?.employees || [], '${(frm.doc.name || "batch").replace(/'/g, "\\'")}.csv')">Export CSV</button>
      </div>
      <div class="bs-table-scroll bs-report-table-scroll">
        <table class="bs-table bs-table-report">
          <thead><tr>
            <th class="bs-th bs-th-sticky bs-report-col-emp">Employee</th>
            <th class="bs-th bs-report-col-dept">Department</th>
            <th class="bs-th bs-th-num bs-report-col-fixed">CTC</th>
            <th class="bs-th bs-th-num bs-report-col-fixed">Salary</th>
            <th class="bs-th bs-th-num bs-report-col-fixed">Overtime</th>
            ${component_header}
            <th class="bs-th bs-th-num bs-report-col-fixed">Gross</th>
            <th class="bs-th bs-th-num bs-report-col-fixed">Adv.Deduct</th>
            <th class="bs-th bs-th-num bs-report-col-fixed">Net Pay</th>
            <th class="bs-th bs-report-col-action">Slip</th>
            <th class="bs-th bs-report-col-action">Payment</th>
            <th class="bs-th bs-report-col-action">Status</th>
          </tr></thead>
          <tbody>${trs}${totals_row}</tbody>
        </table>
      </div>
    </div></div>
  `));
  if (typeof bs_tidy_form_after_ui === "function") bs_tidy_form_after_ui(frm);
}

