// Payroll Bulk — desk UI, table rendering, employee rows
// ─── 3. MAIN UI ───────────────────────────────────────────────────────────────
async function bs_bootstrap_main_ui(frm) {
  window._bs.settings = await bs_get_settings();
  render_main_ui(frm);
}

function bs_default_settings() {
  return {
    default_calculation_mode: "Manual",
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
  return parseFloat(row.ctc || 0);
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
    if (row.overtime_with_salary) {
      return bs_manual_base_pay(row, daily, basis);
    }
    return (parseFloat(row.hours_amount || 0) || 0) + (parseFloat(row.qty_amount || 0) || 0);
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

function bs_apply_month_period(frm, month_name) {
  if (!month_name || !BS_MONTHS.includes(month_name)) return;
  const current = frm.doc.posting_date || frappe.datetime.get_today();
  const parts = current.split("-");
  const year = parseInt(parts[0] || frappe.datetime.get_today().split("-")[0], 10);
  const month_index = BS_MONTHS.indexOf(month_name) + 1;
  const mm = String(month_index).padStart(2, "0");
  const start_date = `${year}-${mm}-01`;
  const end_day = new Date(year, month_index, 0).getDate();
  const end_date = `${year}-${mm}-${String(end_day).padStart(2, "0")}`;
  return bs_set_doc_values(frm, {
    month: month_name,
    start_date,
    end_date,
    posting_date: end_date,
    payroll_frequency: "Monthly",
  }).then(() => {
    frm.doc.month = month_name;
    frm.doc.start_date = start_date;
    frm.doc.end_date = end_date;
    frm.doc.posting_date = end_date;
    bs_update_header_period(frm);
  });
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
  frm.doc.attendance_source = bs_get_mode_attendance_source(frm.doc.calculation_mode);
  frm.doc.overtime_source = frm.doc.overtime_source || "Manual";
  frm.doc.per_piece_basis = frm.doc.per_piece_basis || settings.default_per_piece_basis || "Total Hours";
  frm.doc.overtime_doctype = frm.doc.overtime_doctype || settings.overtime_doctype || "";
  frm.doc.overtime_employee_field = frm.doc.overtime_employee_field || settings.overtime_employee_field || "";
  frm.doc.overtime_date_field = frm.doc.overtime_date_field || settings.overtime_date_field || "";
  frm.doc.overtime_hours_field = frm.doc.overtime_hours_field || settings.overtime_hours_field || "";
  frm.doc.overtime_qty_field = frm.doc.overtime_qty_field || settings.overtime_qty_field || "";
  frm.doc.overtime_rate_field = frm.doc.overtime_rate_field || settings.overtime_rate_field || "";
  frm.doc.use_hours = bs_to_int(settings.default_use_hours, 1);
  frm.doc.use_qty = bs_to_int(settings.default_use_qty, 1);
  frm.doc.overtime_with_salary = bs_to_int(settings.default_overtime_with_salary, 0);
  Object.assign(frm.doc, bs_normalize_source_values(frm.doc));
  if (frm.doc.month && (!frm.doc.start_date || !frm.doc.end_date)) {
    bs_apply_month_period(frm, frm.doc.month);
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
  $("#bs-toggle-filters-btn").text("☰ Filters");
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

async function bs_apply_period_controls(frm) {
  const month = $("#bs-head-month-select").val() || "";
  const payroll_frequency = $("#bs-head-frequency").val() || "Monthly";
  const start_date = $("#bs-head-start-date").val() || "";
  const end_date = $("#bs-head-end-date").val() || "";
  const posting_date = $("#bs-head-posting-date").val() || "";
  await bs_set_doc_values(frm, {
    month,
    payroll_frequency,
    start_date,
    end_date,
    posting_date,
  });
  bs_update_header_period(frm);
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

function bs_collect_source_values(frm) {
  const controls = window._bs.source_ctrls || {};
  const calculation_mode = bs_control_get_value(controls.calculation_mode) || frm.doc.calculation_mode || "Manual";
  const raw = {
    month: bs_control_get_value(controls.month) || frm.doc.month || "",
    calculation_mode,
    manual_salary_basis: bs_control_get_value(controls.manual_salary_basis) || frm.doc.manual_salary_basis || "Full Month",
    attendance_source: bs_get_mode_attendance_source(calculation_mode),
    overtime_source: bs_control_get_value(controls.overtime_source) || frm.doc.overtime_source || "Manual",
    per_piece_basis: bs_control_get_value(controls.per_piece_basis) || frm.doc.per_piece_basis || "Total Hours",
    use_hours: $("#bs-global-use-hours").is(":checked") ? 1 : 0,
    use_qty: $("#bs-global-use-qty").is(":checked") ? 1 : 0,
    overtime_with_salary: $("#bs-global-overtime-with-salary").is(":checked") ? 1 : 0,
    overtime_doctype: bs_control_get_value(controls.overtime_doctype).trim(),
    overtime_employee_field: bs_control_get_value(controls.overtime_employee_field).trim(),
    overtime_date_field: bs_control_get_value(controls.overtime_date_field).trim(),
    overtime_hours_field: bs_control_get_value(controls.overtime_hours_field).trim(),
    overtime_qty_field: bs_control_get_value(controls.overtime_qty_field).trim(),
    overtime_rate_field: bs_control_get_value(controls.overtime_rate_field).trim(),
  };
  return bs_normalize_source_values(raw);
}

function bs_normalize_source_values(values) {
  const next = Object.assign({}, values || {});
  const mode = next.calculation_mode || "Manual";
  if (mode === "Manual") {
    next.overtime_source = "Manual";
  }
  if (bs_is_piece_mode(mode)) {
    next.overtime_source = "Manual";
    next.use_hours = next.overtime_with_salary ? 1 : bs_to_int(next.use_hours, 1);
    next.use_qty = bs_to_int(next.use_qty, 1);
  } else {
    next.per_piece_basis = next.per_piece_basis || "Total Hours";
    next.use_hours = bs_to_int(next.use_hours, 1);
    next.use_qty = bs_to_int(next.use_qty, 1);
  }
  if (!bs_is_piece_mode(mode) && next.overtime_source !== "Custom DocType") {
    next.overtime_qty_field = "";
    next.overtime_rate_field = "";
  }
  if (mode === "Manual") {
    next.overtime_doctype = "";
    next.overtime_employee_field = "";
    next.overtime_date_field = "";
    next.overtime_hours_field = "";
    next.overtime_qty_field = "";
    next.overtime_rate_field = "";
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
  const use_custom = use_piece;
  const use_attendance_loader = ["Attendance Based", "Checkin Based"].includes(mode);
  const show_manual_note = mode === "Manual";
  const overtime_with_salary = $("#bs-global-overtime-with-salary").is(":checked");
  const show_manual_basis = mode === "Manual" || (use_piece && overtime_with_salary);
  $(".bs-manual-basis-field").toggle(show_manual_basis);

  $(".bs-overtime-source-field").hide();
  $(".bs-source-map-field").toggle(use_custom);
  $(".bs-source-hours-field").toggle(use_custom);
  $(".bs-source-map-piece").toggle(use_custom);
  $(".bs-per-piece-basis-field").toggle(use_piece);
  $(".bs-piece-mode-option").toggle(use_piece);
  $("#bs-global-use-hours").prop("checked", overtime_with_salary ? true : $("#bs-global-use-hours").is(":checked"));
  $("#bs-global-use-hours").prop("disabled", use_piece && overtime_with_salary);
  $("#bs-load-source-btn").toggle(
    use_attendance_loader
    || use_custom
    || (mode === "Manual" && ["By Payment Days", "Deduct Absent Days"].includes(frm.doc.manual_salary_basis || "")),
  );

  let note = "Manual mode uses direct entry for base pay and overtime.";
  if (mode === "Manual") {
    const basis = frm.doc.manual_salary_basis || "Full Month";
    if (basis === "Full Month") note = "Manual / Full Month: Basic = full CTC. Set overtime manually per row.";
    if (basis === "By Payment Days") note = "Manual / By Payment Days: Basic = CTC ÷ 30 × payment days. Enter payment days per row or load from Attendance.";
    if (basis === "Deduct Absent Days") note = "Manual / Deduct Absent Days: Basic = CTC ÷ 30 × (30 − absent days). Enter absent days per row or load from Attendance.";
  }
  if (mode === "Attendance Based") note = "Attendance Based: Basic Pay = CTC / 30 × present days from Attendance. Overtime stays manual in each employee row.";
  if (mode === "Checkin Based") note = "Checkin Based: Basic Pay = CTC / 30 × unique checkin days. Overtime auto-loads from last checkin minus first checkin.";
  if (bs_is_piece_mode(mode)) note = "Per Piece or Per Hour: each employee row can use both Hours and Qty together. Hours use (CTC / 30 / 8) × Hours. Qty uses Qty × Rate.";
  if (bs_is_piece_mode(mode) && overtime_with_salary) note = "Overtime with Salary: Basic uses Manual Salary Basis (Full Month / Payment Days / Absent deduction). Hours from custom source count as overtime. Qty stays separate.";
  $("#bs-source-note").text(note);
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
  const by_kind = {
    employee: (df) => (df.fieldtype === "Link" && df.options === "Employee") || ["Data", "Dynamic Link", "Select"].includes(df.fieldtype),
    date: (df) => ["Date", "Datetime"].includes(df.fieldtype),
    number: (df) => ["Float", "Currency", "Int", "Percent", "Duration"].includes(df.fieldtype),
  };
  const matcher = by_kind[kind] || (() => true);
  return (fields || []).filter(matcher);
}

function bs_fill_field_select($select, fields, current_value, placeholder) {
  const options = [`<option value="">${placeholder || ""}</option>`]
    .concat((fields || []).map((df) => `<option value="${frappe.utils.escape_html(df.fieldname)}">${frappe.utils.escape_html(df.label || df.fieldname)} (${frappe.utils.escape_html(df.fieldname)})</option>`));
  $select.html(options.join(""));
  $select.val(current_value || "");
  if ($select.val() !== (current_value || "")) $select.val("");
}

function bs_guess_source_field(fields, kind) {
  const list = fields || [];
  const picks = {
    employee: ["employee", "employee_id", "employee_code"],
    date: ["date", "posting_date", "attendance_date", "checkin_date"],
    hours: ["hours", "total_hours", "working_hours", "overtime_hours", "total_overtime_hours"],
    qty: ["qty", "quantity", "total_qty", "piece_qty", "production_qty"],
    rate: ["hourly_rate", "rate", "piece_rate", "per_piece_rate"],
  };
  const wanted = picks[kind] || [];
  const hit = list.find((df) => wanted.includes(String(df.fieldname || "").toLowerCase()));
  return hit?.fieldname || "";
}

async function bs_refresh_source_field_options(frm) {
  const controls = window._bs.source_ctrls || {};
  const doctype_name = bs_control_get_value(controls.overtime_doctype);
  const fields = await bs_get_doctype_field_options(doctype_name);
  const employee_fields = bs_filter_source_fields(fields, "employee");
  const date_fields = bs_filter_source_fields(fields, "date");
  const number_fields = bs_filter_source_fields(fields, "number");
  frm.doc.overtime_employee_field = frm.doc.overtime_employee_field || bs_guess_source_field(employee_fields, "employee");
  frm.doc.overtime_date_field = frm.doc.overtime_date_field || bs_guess_source_field(date_fields, "date");
  frm.doc.overtime_hours_field = frm.doc.overtime_hours_field || bs_guess_source_field(number_fields, "hours");
  frm.doc.overtime_qty_field = frm.doc.overtime_qty_field || bs_guess_source_field(number_fields, "qty");
  frm.doc.overtime_rate_field = frm.doc.overtime_rate_field || bs_guess_source_field(number_fields, "rate");
  bs_fill_field_select(controls.overtime_employee_field, employee_fields, frm.doc.overtime_employee_field, "Select employee field");
  bs_fill_field_select(controls.overtime_date_field, date_fields, frm.doc.overtime_date_field, "Select date field");
  bs_fill_field_select(controls.overtime_hours_field, number_fields, frm.doc.overtime_hours_field, "Select total hours field");
  bs_fill_field_select(controls.overtime_qty_field, number_fields, frm.doc.overtime_qty_field, "Select total qty field");
  bs_fill_field_select(controls.overtime_rate_field, number_fields, frm.doc.overtime_rate_field, "Select rate per piece field");
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
        placeholder: "Custom DocType",
      },
      render_input: true,
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
  bs_control_set_value(source_ctrls.manual_salary_basis, frm.doc.manual_salary_basis || "Full Month");
  bs_control_set_value(source_ctrls.overtime_source, "Manual");
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
        bs_control_set_value(source_ctrls.overtime_source, "Manual");
        bs_control_set_value(source_ctrls.per_piece_basis, normalized.per_piece_basis || "Total Hours");
      }
      await bs_sync_source_doc(frm);
      if (["overtime_doctype", "calculation_mode", "manual_salary_basis", "overtime_source", "per_piece_basis"].includes(key)) {
        await bs_refresh_source_field_options(frm);
      }
      if (["calculation_mode", "manual_salary_basis"].includes(key) && window._bs.rows.length) {
        window._bs.rows.forEach((row) => recalc_row(row));
        bs_render_table();
      }
      bs_update_header_period(frm);
      bs_refresh_source_ui();
      window._bs.rows.forEach(recalc_row);
      bs_render_table();
    });
  });

  source_ctrls.global_use_hours.on("change", () => bs_apply_global_piece_flags_to_rows());
  source_ctrls.global_use_qty.on("change", () => bs_apply_global_piece_flags_to_rows());
  source_ctrls.global_overtime_with_salary.on("change", () => {
    bs_refresh_source_ui();
    bs_apply_global_piece_flags_to_rows();
  });

  await bs_sync_source_doc(frm);
  bs_refresh_source_ui();
}

function render_main_ui(frm) {
  window._bs.frm     = frm;
  window._bs.rows    = [];
  window._bs.counter = 0;
  window._bs.global_piece_flags = null;
  const settings = window._bs.settings || bs_default_settings();
  settings.enable_component_configuration = 0;
  bs_apply_source_defaults(frm, settings);
  const saved_components_map = bs_get_saved_components_map(frm);
  const show_fetch_filters = !!(settings.enable_filter_fetch && (bs_to_int(settings.show_department_filter, 1) || bs_to_int(settings.show_branch_filter, 1) || bs_to_int(settings.show_designation_filter, 1)));
  const show_manual_employee = !!(settings.enable_manual_add && bs_to_int(settings.show_employee_filter, 1));
  const show_filter_row = true;

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
        ot_type:        (r.ot_type || "Hours").toLowerCase(),
        ot_input:       parseFloat(r.ot_input || 0),
        ot_amount:      parseFloat(r.ot_amount || 0),
        bonus_amount:   parseFloat(r.bonus_amount || 0),
        other_allowance:parseFloat(r.other_allowance || 0),
        source_hours:   parseFloat(r.source_hours || 0),
        source_qty:     parseFloat(r.source_qty || 0),
        piece_rate:     parseFloat(r.piece_rate || 0),
        use_hours:      ("use_hours" in r) ? parseInt(r.use_hours || 0, 10) : 1,
        use_qty:        ("use_qty" in r) ? parseInt(r.use_qty || 0, 10) : 1,
        overtime_with_salary: ("overtime_with_salary" in frm.doc) ? parseInt(frm.doc.overtime_with_salary || 0, 10) : bs_to_int(settings.default_overtime_with_salary, 0),
        source_row_names: [],
        attendance_days:parseFloat(r.attendance_days || 0),
        absent_days:    parseFloat(r.absent_days || 0),
        attendance_hours:parseFloat(r.attendance_hours || 0),
        payment_days:   parseFloat(r.payment_days || 0),
        worked_hours:   parseFloat(r.worked_hours || 0),
        shift_hours:    parseFloat(r.shift_hours || 0),
        overtime_hours: parseFloat(r.overtime_hours || 0),
        gross:          parseFloat(r.gross_pay || r.gross || 0),
        advances:       [],
        advance_balance:parseFloat(r.advance_balance || 0),
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
        components: (saved_components_map[r.name] || saved_components_map[r.employee] || []).map((item) => ({
          key: item.salary_component,
          component: item.salary_component,
          label: item.salary_component,
          type: item.component_type || "Earning",
          amount: parseFloat(item.amount || 0),
        })),
        piece_basis: r.piece_basis || frm.doc.per_piece_basis || settings.default_per_piece_basis || "Total Hours",
      });
      recalc_row(window._bs.rows[window._bs.rows.length - 1]);
    });
  }
  bs_normalize_rows();

  const $body = frm.layout.wrapper.find(".form-page");
  $body.find("#bs-main-wrap").remove();

  const $wrap = $(`
    <div id="bs-main-wrap"><div class="bs-wrap">

      <!-- Header -->
      <div class="bs-header-card">
        <div class="bs-header-main">
          <div class="bs-header-icon">SAL</div>
          <div>
            <div class="bs-header-title">Bulk Salary Creation</div>
            <div class="bs-header-sub">
              Fetch or add employees → enter overtime → review advances → create slips → pay.
            </div>
            <div class="bs-header-period-bar">
              <select id="bs-head-month-select" class="bs-select-sm">
                <option value="">Month</option>
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
          <button class="bs-btn-secondary" id="bs-toggle-filters-btn">☰ Filters</button>
        </div>
      </div>

      <div id="bs-filters-area" class="bs-filters-area is-hidden">
      <div class="bs-panel bs-mb bs-panel-soft" id="bs-filter-panel">
        <div class="bs-filter-panel-title">Filters & Source</div>
        ${show_filter_row ? `
        <div class="bs-qa-row">
          <div class="bs-field-wrap bs-floating-field" style="flex:1;min-width:170px">
            <span class="bs-field-caption">Company</span><div id="bs-company-wrap"></div>
          </div>
          ${bs_to_int(settings.show_department_filter, 1) ? `
          <div class="bs-field-wrap bs-floating-field" style="flex:1;min-width:150px">
            <span class="bs-field-caption">Department</span><div id="bs-dept-wrap"></div>
          </div>
          ` : ``}
          ${bs_to_int(settings.show_branch_filter, 1) ? `
          <div class="bs-field-wrap bs-floating-field" style="flex:1;min-width:150px">
            <span class="bs-field-caption">Branch</span><div id="bs-branch-wrap"></div>
          </div>
          ` : ``}
          ${bs_to_int(settings.show_designation_filter, 1) ? `
          <div class="bs-field-wrap bs-floating-field" style="flex:1;min-width:150px">
            <span class="bs-field-caption">Designation</span><div id="bs-desig-wrap"></div>
          </div>
          ` : ``}
          ${show_fetch_filters ? `
          <div class="bs-filter-btn-wrap bs-filter-btn-stack">
            <button class="bs-btn-secondary bs-filter-action-btn" id="bs-fetch-btn">⬇ Fetch</button>
          </div>
          ` : ``}
          ${show_manual_employee ? `
          <div class="bs-field-wrap bs-floating-field bs-employee-picker">
            <span class="bs-field-caption">Employee</span><div id="bs-emp-link-wrap"></div>
          </div>
          <div class="bs-filter-btn-wrap bs-filter-btn-stack">
            <button class="bs-btn-primary bs-filter-action-btn" id="bs-add-btn">＋ Add</button>
          </div>
          ` : ``}
        </div>
        ` : ``}
        <div id="bs-fetch-notice" style="display:none" class="bs-notice bs-notice-info"></div>
        <div id="bs-add-notice" style="display:none" class="bs-notice bs-notice-warn"></div>
        <div class="bs-source-grid">
          <div class="bs-source-row">
          <div class="bs-field-wrap bs-floating-field">
            <select id="bs-calculation-mode" class="bs-select-sm bs-select-full">
              <option value="">Calculation Mode</option>
              <option value="Manual">Manual</option>
              <option value="Attendance Based">Attendance Based</option>
              <option value="Checkin Based">Checkin Based</option>
              <option value="Per Piece or Per Hour">Per Piece or Per Hour</option>
            </select>
          </div>
          <div class="bs-field-wrap bs-floating-field bs-manual-basis-field">
            <select id="bs-manual-salary-basis" class="bs-select-sm bs-select-full">
              <option value="">Salary Basis</option>
              <option value="Full Month">Full Month</option>
              <option value="By Payment Days">By Payment Days</option>
              <option value="Deduct Absent Days">Deduct Absent Days</option>
            </select>
          </div>
          <div class="bs-field-wrap bs-floating-field bs-per-piece-basis-field">
            <select id="bs-per-piece-basis" class="bs-select-sm bs-select-full">
              <option value="">Per Piece Basis</option>
              <option value="Total Hours">Total Hours</option>
              <option value="Total Qty">Total Qty</option>
            </select>
          </div>
          <label class="bs-piece-filter-check bs-per-piece-basis-field bs-piece-mode-option"><input id="bs-global-use-hours" type="checkbox" /> <span>Use Hours</span></label>
          <label class="bs-piece-filter-check bs-per-piece-basis-field bs-piece-mode-option"><input id="bs-global-use-qty" type="checkbox" /> <span>Use Qty</span></label>
          <label class="bs-piece-filter-check bs-per-piece-basis-field bs-piece-mode-option"><input id="bs-global-overtime-with-salary" type="checkbox" /> <span>Overtime with Salary</span></label>
          <div class="bs-field-wrap bs-floating-field bs-source-map-field">
            <div id="bs-overtime-doctype-wrap"></div>
          </div>
          </div>
          <div class="bs-source-row">
          <div class="bs-field-wrap bs-floating-field bs-source-map-field">
            <select id="bs-overtime-employee-field" class="bs-select-sm bs-select-full"><option value="">Employee Field</option></select>
          </div>
          <div class="bs-field-wrap bs-floating-field bs-source-map-field">
            <select id="bs-overtime-date-field" class="bs-select-sm bs-select-full"><option value="">Date Field</option></select>
          </div>
          <div class="bs-field-wrap bs-floating-field bs-source-map-field bs-source-hours-field">
            <select id="bs-overtime-hours-field" class="bs-select-sm bs-select-full"><option value="">Total Hours Field</option></select>
          </div>
          <div class="bs-field-wrap bs-floating-field bs-source-map-piece">
            <select id="bs-overtime-qty-field" class="bs-select-sm bs-select-full"><option value="">Total Qty Field</option></select>
          </div>
          <div class="bs-field-wrap bs-floating-field bs-source-map-piece">
            <select id="bs-overtime-rate-field" class="bs-select-sm bs-select-full"><option value="">Rate per Piece Field</option></select>
          </div>
          <div class="bs-filter-btn-wrap bs-filter-btn-stack">
            <button class="bs-btn-secondary bs-filter-action-btn" id="bs-load-source-btn" style="display:none">⭳ Load Source Data</button>
          </div>
          </div>
        </div>
        <div id="bs-source-note" class="bs-source-note-hidden"></div>
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
        <span class="bs-footer-hint">Enter overtime and component amounts per employee.</span>
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
        <button class="bs-btn-secondary" id="bs-refresh-all-btn">⟳ Refresh All Status</button>
        <button class="bs-btn-secondary" id="bs-open-submitted-btn">↗ Open Submitted Slips</button>
        <button class="bs-btn-secondary" id="bs-submit-drafts-btn">✓ Submit Draft Slips</button>
        <button class="bs-btn-secondary" id="bs-create-accrual-btn">🧾 Create Accrual JE</button>
        <button class="bs-btn-secondary" id="bs-create-missing-btn">＋ Create Missing Only</button>
        <button class="bs-btn-secondary" id="bs-save-draft-btn">💾 Save Draft</button>
        <button class="bs-btn-primary bs-btn-lg" id="bs-review-btn">Review &amp; Create Draft Slips →</button>
      </div>

    </div></div>
  `);

  $body.prepend($wrap);

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
  $wrap.find("#bs-review-btn").on("click",         () => open_payroll_dialog());
  $wrap.find("#bs-fetch-advances-btn").on("click", () => bs_fetch_all_advances());
  $wrap.find("#bs-load-source-btn").on("click",    () => bs_load_source_data());
  $wrap.find("#bs-toggle-filters-btn").on("click", function () {
    $wrap.find("#bs-filters-area").toggleClass("is-hidden");
    $(this).text($wrap.find("#bs-filters-area").hasClass("is-hidden") ? "☰ Filters" : "✕ Close Filters");
  });
  $wrap.find("#bs-head-month-select").on("change", async function () {
    const month = $(this).val() || "";
    if (month) {
      await bs_apply_month_period(frm, month);
    } else {
      await bs_apply_period_controls(frm);
    }
    if (window._bs.rows.length) await bs_refresh_structure_assignments(window._bs.rows);
    window._bs.rows.forEach(recalc_row);
    bs_render_table();
  });
  $wrap.find("#bs-head-frequency, #bs-head-start-date, #bs-head-end-date, #bs-head-posting-date").on("change", async function () {
    await bs_apply_period_controls(frm);
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

  bs_bind_source_controls(frm, settings, $wrap);
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

  if (window._bs.rows.length) {
    bs_refresh_rows_from_employee(window._bs.rows).finally(() => {
      bs_refresh_structure_assignments(window._bs.rows).finally(() => bs_render_table());
    });
  } else {
    bs_render_table();
  }
  bs_render_live_summary(frm);
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
      if (added_rows.length) await bs_refresh_structure_assignments(added_rows);
      bs_normalize_rows();
      bs_render_table();
      notice(`✓ ${added} added${list.length-added ? ` (${list.length-added} already in list)`:""}.`, "success");
      if (bs_auto_hide_filters_enabled()) bs_hide_filters();
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
    attendance_days:0, absent_days:0, attendance_hours:0, payment_days:0,
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
      row.use_hours && hours_component ? { label: "Hours", component: hours_component, amount: parseFloat(row.hours_amount || 0) || 0 } : null,
      row.use_qty && qty_component ? { label: "Qty", component: qty_component, amount: parseFloat(row.qty_amount || 0) || 0 } : null,
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
    existing[item.key || `${item.type}::${item.component}`] = parseFloat(item.amount || 0) || 0;
  });

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
      amount: existing[key] || 0,
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
      const key = `Earning::hours::${hours_component}`;
      auto_items.push({
        key,
        component: hours_component,
        label: hours_component,
        type: "Earning",
        role: "overtime",
        auto_calculated: true,
        amount: existing[key] || (parseFloat(row.hours_amount || 0) || 0),
      });
    }

    if (row.use_qty && qty_component) {
      const key = `Earning::qty::${qty_component}`;
      auto_items.push({
        key,
        component: qty_component,
        label: qty_component,
        type: "Earning",
        role: "qty",
        auto_calculated: true,
        amount: existing[key] || (parseFloat(row.qty_amount || 0) || 0),
      });
    }

    row.components = manual_items.concat(auto_items);
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
}

// ─── 6. RENDER TABLE ──────────────────────────────────────────────────────────
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

  const trs = filtered_rows.map((r) => {
    const hourly = r.ctc / 30 / 8;
    const mode = window._bs.frm?.doc?.calculation_mode || "Manual";
    const attendance_source = bs_get_mode_attendance_source(mode);
    const hours_amount = (parseFloat(r.source_hours || 0) || 0) * hourly;
    const qty_amount = (parseFloat(r.source_qty || 0) || 0) * (parseFloat(r.piece_rate || 0) || 0);
    const slip_html = r.salary_slip
      ? `<a href="/app/salary-slip/${r.salary_slip}" target="_blank" class="bs-mono">${r.salary_slip}</a>`
      : `<span style="color:var(--bs-muted)">—</span>`;
    const status_html = `
      <div class="bs-status-stack">
        <span class="bs-status-badge bs-status-${["Failed","Cancelled"].includes(r.status) ? "fail" : "ok"}">${r.status || "Pending"}</span>
        <div class="bs-status-sub">${r.salary_slip_status || "Not Created"}${r.payment_status ? ` • ${r.payment_status}` : ""}</div>
      </div>`;
    const can_pay_row = r.salary_slip && r.salary_slip_status === "Submitted" && !r.payment_entry;
    const can_delete_draft = r.salary_slip && r.salary_slip_status === "Draft";
    const can_cancel_unlink = r.salary_slip && r.salary_slip_status === "Submitted";
    const can_unlink_existing = r.salary_slip && !r.salary_slip_status && r.status === "Skipped";
    const action_html = `
      <div class="bs-row-actions">
        ${r.salary_slip ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Salary Slip','${r.salary_slip}')">Open Slip</button>` : ""}
        ${can_delete_draft ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_manage_salary_slip(${r._id},'delete_draft')">Delete Draft</button>` : ""}
        ${can_cancel_unlink ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_manage_salary_slip(${r._id},'cancel_unlink')">Cancel Slip</button>` : ""}
        ${can_unlink_existing ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_manage_salary_slip(${r._id},'unlink')">Unlink Slip</button>` : ""}
        <button class="bs-btn-ghost bs-btn-sm" onclick="bs_reprocess_row(${r._id},0)">↻ Recreate Draft</button>
        ${r.salary_slip ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_reprocess_row(${r._id},1)">↻ Recreate & Submit</button>` : ""}
        ${can_pay_row ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_create_single_payment('${r.employee}')">💳 Pay</button>` : ""}
        ${r.payment_entry ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Journal Entry','${r.payment_entry}')">Open Journal</button>` : ""}
        ${(r.salary_slip || r.payment_entry) ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_refresh_row_status(${r._id})">Refresh</button>` : ""}
      </div>`;
    const adv_html = r.adv_fetched
      ? (r.advances.length
          ? `<div class="bs-adv-wrap">
              ${r.advances.map((a,i)=>`
                <div class="bs-adv-row">
                  <div class="bs-adv-stack">
                    <span class="bs-adv-id">${a.name}</span>
                    <span class="bs-adv-bal">Bal: ${fmt_num(a.balance)}</span>
                  </div>
                  <input class="bs-adv-input" type="number" min="0" max="${a.balance}"
                    value="${a.deduct||0}" placeholder="Deduct amt"
                    onchange="bs_update_adv_deduct(${r._id},${i},this.value)"
                    style="width:100px"/>
                </div>`).join("")}
              <div class="bs-adv-total">Total deduction: <b>${fmt_num(r.adv_deduct)}</b></div>
             </div>`
          : `<span style="color:var(--bs-muted);font-size:11px">No advances</span>`)
      : `<span style="color:var(--bs-muted);font-size:11px">Load from Fetch All Advances</span>`;

    const component_totals = bs_get_component_totals(r);
    const render_component_inputs = (type) => (r.components || [])
      .filter((item) => item.type === type)
      .map((item) => `
        <label class="bs-adjust-chip bs-adjust-chip-${type === "Earning" ? "earning" : "deduction"}" title="${frappe.utils.escape_html(item.label)}">
          <input class="bs-input-sm ${item.auto_calculated ? "bs-adjust-input-auto" : "bs-editable"} bs-adjust-input" type="number" min="0" step="0.01" inputmode="decimal"
            placeholder="${frappe.utils.escape_html(item.label)}" value="${bs_component_input_value(item)}" onfocus="this.select()"
            ${item.auto_calculated ? "readonly tabindex='-1'" : `onkeydown="bs_handle_edit_keydown(event,this)" onchange="bs_update_component_amount(${r._id},'${encodeURIComponent(item.key)}',this.value)"`}/>
        </label>`).join("");
    const earning_inputs = render_component_inputs("Earning");
    const deduction_inputs = render_component_inputs("Deduction");
    const adjustments_html = (earning_inputs || deduction_inputs)
      ? `<div class="bs-adjust-row-wrap">
          ${earning_inputs ? `<div class="bs-adjust-line"><span class="bs-adjust-line-title bs-adjust-line-title-earning">Earnings</span><div class="bs-adjust-line-items">${earning_inputs}</div></div>` : ``}
          ${deduction_inputs ? `<div class="bs-adjust-line"><span class="bs-adjust-line-title bs-adjust-line-title-deduction">Deductions</span><div class="bs-adjust-line-items">${deduction_inputs}</div></div>` : ``}
        </div>`
      : `<div class="bs-source-inline bs-source-inline-adjust"><span>No components configured</span></div>`;
    const adjustments_cell_html = (earning_inputs || deduction_inputs)
      ? `<div class="bs-adjust-summary">
          <span class="bs-adjust-summary-chip">Earn ${fmt_total(component_totals.earnings)}</span>
          <span class="bs-adjust-summary-chip">Ded ${fmt_total(component_totals.deductions)}</span>
        </div>`
      : `<div class="bs-adjust-summary bs-adjust-summary-empty">—</div>`;

    const checkin_overtime_note = mode === "Checkin Based"
      ? `<div class="bs-source-inline">
          <span>In/Out ${fmt_num(r.worked_hours || 0, 2)}h</span>
          <span>Shift ${fmt_num(r.shift_hours || 0, 2)}h</span>
          <span>OT ${fmt_num(r.overtime_hours || 0, 2)}h</span>
        </div>`
      : "";
    const auto_component_meta = bs_get_auto_component_meta(r, mode);
    const auto_component_note = auto_component_meta.length
      ? `<div class="bs-source-inline">
          ${auto_component_meta.map((item) => `<span>${frappe.utils.escape_html(item.label)} ${frappe.utils.escape_html(item.component)} ${fmt_total(item.amount)}</span>`).join("")}
        </div>`
      : "";
    const manual_basis = window._bs.frm?.doc?.manual_salary_basis || "Full Month";
    const show_manual_days = mode === "Manual" && manual_basis !== "Full Month";
    const attendance_note = (["Attendance Based", "Checkin Based"].includes(mode) || show_manual_days || r.attendance_days || r.attendance_hours || r.payment_days)
      ? `<div class="bs-source-inline">
          <span>${attendance_source}</span>
          ${show_manual_days || manual_basis === "By Payment Days" ? `<span>Pay <input class="bs-input-sm bs-editable" style="width:52px" type="number" min="0" max="31" step="0.5" value="${bs_input_value(r.payment_days)}" onchange="bs_update_amount(${r._id},'payment_days',this.value)"/></span>` : `<span>Pay ${fmt_num(r.payment_days || 0, 1)}</span>`}
          ${show_manual_days && manual_basis === "Deduct Absent Days" ? `<span>Abs <input class="bs-input-sm bs-editable" style="width:52px" type="number" min="0" max="31" step="0.5" value="${bs_input_value(r.absent_days)}" onchange="bs_update_amount(${r._id},'absent_days',this.value)"/></span>` : `<span>Abs ${fmt_num(r.absent_days || 0, 1)}</span>`}
          <span>Att ${fmt_num(r.attendance_days || 0, 1)}</span>
          <span>Hrs ${fmt_num(r.attendance_hours || 0, 1)}</span>
        </div>`
      : "";
    const base_formula_note = (mode === "Attendance Based" || mode === "Checkin Based" || show_manual_days)
      ? `<div class="bs-source-inline bs-source-inline-formula">
          <span>${fmt_total(r.ctc)} / 30 × ${fmt_num((manual_basis === "Deduct Absent Days" ? Math.max(0, 30 - (r.absent_days || 0)) : (r.payment_days || r.attendance_days || 0)) || 0, 1)} = ${fmt_total(r.base_pay || 0)}</span>
        </div>`
      : "";
    const overtime_source_badge = `
      <div class="bs-source-inline bs-source-inline-top bs-source-inline-tight">
        <span>Base ${mode}</span>
        ${mode === "Attendance Based" ? `<span>OT Manual</span>` : ""}
        ${mode === "Checkin Based" ? `<span>OT Checkin Diff</span>` : ""}
        ${mode === "Manual" ? `<span>OT Manual</span>` : ""}
        ${bs_is_piece_mode(mode) ? `<span>Hours + Qty</span>` : ``}
      </div>`;

    const work_input_html = bs_is_piece_mode(mode)
      ? `
          <div class="bs-piece-stack">
            ${r.use_hours || r.overtime_with_salary ? `<div class="bs-piece-line">
              <input class="bs-piece-check" type="checkbox" ${r.use_hours ? "checked" : ""} ${r.overtime_with_salary ? "disabled" : ""} onchange="bs_toggle_piece_part(${r._id},'use_hours',this.checked)"/>
              <input class="bs-input-sm bs-editable bs-piece-input" type="number" min="0" step="0.01" inputmode="decimal"
                placeholder="" value="${bs_input_value(r.source_hours)}" onfocus="this.select()"
                onkeydown="bs_handle_edit_keydown(event,this)" onchange="bs_update_amount(${r._id},'source_hours',this.value)"/>
              <input class="bs-input-sm bs-piece-input bs-piece-readonly" type="text" tabindex="-1" readonly value="${fmt_num(hourly, 2)}"/>
              <input class="bs-input-sm bs-piece-input bs-piece-total" type="text" tabindex="-1" readonly value="${fmt_total(hours_amount)}"/>
            </div>` : ``}
            ${r.use_qty ? `<div class="bs-piece-line">
              <input class="bs-piece-check" type="checkbox" ${r.use_qty ? "checked" : ""} onchange="bs_toggle_piece_part(${r._id},'use_qty',this.checked)"/>
              <input class="bs-input-sm bs-editable bs-piece-input" type="number" min="0" step="0.01" inputmode="decimal"
                placeholder="" value="${bs_input_value(r.source_qty)}" onfocus="this.select()"
                onkeydown="bs_handle_edit_keydown(event,this)" onchange="bs_update_amount(${r._id},'source_qty',this.value)"/>
              <input class="bs-input-sm bs-editable bs-piece-input" type="number" min="0" step="0.01" inputmode="decimal"
                placeholder="" value="${bs_input_value(r.piece_rate)}" onfocus="this.select()"
                onkeydown="bs_handle_edit_keydown(event,this)" onchange="bs_update_amount(${r._id},'piece_rate',this.value)"/>
              <input class="bs-input-sm bs-piece-input bs-piece-total" type="text" tabindex="-1" readonly value="${fmt_total(qty_amount)}"/>
            </div>` : ``}
            <div class="bs-ot-amount-row"><span class="bs-ot-amount bs-piece-total-pill">${fmt_total(hours_amount + qty_amount)}</span></div>
          </div>
          `
      : `
          <div class="bs-ot-row">
            <select class="bs-select-sm bs-editable" onkeydown="bs_handle_edit_keydown(event,this)" onchange="bs_update_ot_type(${r._id},this.value)">
              <option value="hours" ${r.ot_type==="hours"?"selected":""}>Hours</option>
              <option value="days"  ${r.ot_type==="days" ?"selected":""}>Days</option>
            </select>
            <input class="bs-input-sm bs-editable" type="number" min="0" step="0.5" inputmode="decimal"
              value="${bs_input_value(r.ot_input)}" placeholder="Overtime" onfocus="this.select()"
              onkeydown="bs_handle_edit_keydown(event,this)" onchange="bs_update_ot(${r._id},this.value)"/>
          </div>
          <div class="bs-ot-amount-row"><span class="bs-ot-amount">${fmt_total(r.ot_amount)}</span></div>
          `;
    const comp_detail_html = `
      <div class="bs-source-inline bs-source-inline-plain">
        <span>Daily ${fmt_num(r.ctc / 30, 3)}</span>
        <span>Hourly ${fmt_num(hourly, 3)}</span>
        <span>Basic ${fmt_total(r.base_pay || r.ctc)}</span>
        ${bs_is_piece_mode(mode) ? `<span>Hours Total ${fmt_total(hours_amount)}</span><span>Qty Total ${fmt_total(qty_amount)}</span>` : ``}
      </div>`;
    const detail_html = [comp_detail_html, overtime_source_badge, base_formula_note, auto_component_note, attendance_note, checkin_overtime_note].filter(Boolean).join("");
    const structure_warning_html = r.structure_warning
      ? `<div class="bs-structure-warning">${frappe.utils.escape_html(r.structure_warning)}</div>`
      : "";
    const structure_action_html = r.salary_structure_assignment
      ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Salary Structure Assignment','${r.salary_structure_assignment}')">Open Assignment</button>`
      : `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_new_assignment('${r.employee}','${r.salary_structure || ""}')">New Assignment</button>`;

    return `
      <tr class="bs-row" id="bs-row-${r._id}">
        <td class="bs-td bs-td-emp">
          <div class="bs-emp-code">${r.employee}</div>
          <div class="bs-emp-name">${r.employee_name!==r.employee?r.employee_name:""}</div>
          <div style="font-size:10px;color:var(--bs-muted)">${r.department||""}</div>
          <div class="bs-row-actions bs-row-actions-compact">
            <button class="bs-btn-remove-inline" onclick="bs_remove_row(${r._id})" title="Remove">Remove</button>
          </div>
        </td>
        <td class="bs-td" style="min-width:90px">
          <div class="bs-ctc-val">${fmt_total(r.ctc)}</div>
        </td>
        <td class="bs-td bs-td-overtime" style="min-width:180px">${work_input_html}</td>
        <td class="bs-td" style="min-width:110px">
          ${adjustments_cell_html}
        </td>
        <td class="bs-td" style="min-width:130px">
          <div class="bs-money-main bs-money-gross">${fmt_total(r.gross)}</div>
          <div class="bs-money-sub">Add ${fmt_total(r.total_additions)}</div>
        </td>
        <td class="bs-td" style="min-width:220px">${adv_html}</td>
        <td class="bs-td" style="min-width:110px">
          <div class="bs-money-main bs-money-net">${fmt_total(r.net)}</div>
          <div class="bs-money-sub">Ded ${fmt_total(r.total_deductions)}</div>
        </td>
        <td class="bs-td" style="min-width:170px">
          <div class="bs-structure-line">${r.salary_structure || "—"}</div>
          <div class="bs-emp-name bs-structure-meta">${r.salary_structure_assignment || ""}</div>
          <div class="bs-emp-name bs-structure-meta">Payable ${r.payroll_payable_account || "—"}</div>
          ${structure_warning_html}
          <div class="bs-row-actions">${structure_action_html}</div>
        </td>
        <td class="bs-td" style="min-width:150px">
          <div>${slip_html}</div>
          ${status_html}
          ${action_html}
        </td>
      </tr>
      <tr class="bs-row-detail">
        <td class="bs-td-detail" colspan="9">
          <div class="bs-row-detail-wrap">${adjustments_html}</div>
        </td>
      </tr>
      <tr class="bs-row-detail bs-row-detail-adjust">
        <td class="bs-td-detail" colspan="9">
          <div class="bs-row-detail-wrap">${detail_html}</div>
        </td>
      </tr>`;
  }).join("");

  container.innerHTML = `
    <table class="bs-table">
      <thead><tr>
        <th class="bs-th bs-td-emp">Employee</th>
        <th class="bs-th">Basic Salary</th>
        <th class="bs-th">${bs_is_piece_mode(window._bs.frm?.doc?.calculation_mode || "Manual") ? "Per Piece / Hour" : "Overtime"}</th>
        <th class="bs-th">Add / Ded</th>
        <th class="bs-th">Gross Pay</th>
        <th class="bs-th">Advances</th>
        <th class="bs-th">Net Pay</th>
        <th class="bs-th">Structure</th>
        <th class="bs-th">Slip / Status</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>`;
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
        bs_render_table();
        bs_render_live_summary(frm);
        frappe.show_alert({ message: `Salary Slip ${slip.name || ""} recreated.`, indicator: "green" }, 5);
      } catch (error) {
        frappe.msgprint({ title: "Reprocess Error", message: error.message || String(error), indicator: "red" });
      } finally {
        frappe.dom.unfreeze();
      }
    },
  );
};

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
  row.ot_type = val;
  recalc_row(row);
  bs_render_table();
};

window.bs_update_ot = (id, val) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  row.ot_input = parseFloat(val) || 0;
  recalc_row(row);
  bs_render_table();
};

window.bs_update_amount = (id, fieldname, val) => {
  const row = window._bs.rows.find((r) => r._id === id);
  if (!row) return;
  row[fieldname] = Math.max(0, parseFloat(val) || 0);
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
  const item = (row.components || []).find((component) => component.key === key);
  if (!item) return;
  item.amount = Math.max(0, parseFloat(val) || 0);
  recalc_row(row);
  bs_render_table();
};

window.bs_update_adv_deduct = (row_id, adv_idx, val) => {
  const row = window._bs.rows.find((r) => r._id === row_id);
  if (!row || !row.advances[adv_idx]) return;
  const adv = row.advances[adv_idx];
  adv.deduct = Math.min(parseFloat(val)||0, adv.balance);
  row.adv_deduct = row.advances.reduce((s,a)=>s+(a.deduct||0),0);
  recalc_row(row);
  bs_render_table();
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

  try {
    const res = await bs_call("payroll_bulk.api.create_bulk_accrual_journal_entry", {
      batch_name: frm.doc.name,
    });
    const journal_entry = res.message?.journal_entry || res.journal_entry || res.message;
    if (journal_entry) {
      await frm.set_value("accrual_journal_entry", journal_entry);
      frappe.show_alert({ message: `Accrual Journal Entry ${journal_entry} ready.`, indicator: "green" }, 5);
      bs_render_table();
      return;
    }
    frappe.show_alert({ message: "Accrual Journal Entry processed.", indicator: "green" }, 4);
  } catch (error) {
    frappe.msgprint({ title: "Accrual Error", message: error.message || String(error), indicator: "red" });
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

async function bs_sync_batch_from_slips(frm) {
  if (!frm?.doc?.name) return false;
  try {
    const res = await bs_call("payroll_bulk.api.sync_bulk_batch_slip_status", { batch_name: frm.doc.name });
    if ((res.message?.updated_count || 0) > 0) {
      await frm.reload_doc();
      return true;
    }
  } catch (error) {
    console.warn("Batch slip status sync failed:", error);
  }
  return false;
}

async function bs_submit_draft_slips() {
  const frm = window._bs.frm;
  await bs_sync_batch_from_slips(frm);
  const draft_rows = (window._bs.rows || frm?.doc?.employees || []).filter(
    (row) => row.salary_slip && row.salary_slip_status === "Draft",
  );
  if (!draft_rows.length) {
    frappe.show_alert({ message: "No draft Salary Slips found — all linked slips are already submitted.", indicator: "green" }, 4);
    if (frm && bs_is_completed_batch(frm.doc)) render_submitted_view(frm);
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
    if (frm && bs_is_completed_batch(frm.doc)) render_submitted_view(frm);
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

  row.attendance_days = parseFloat(row.attendance_days || 0);
  row.absent_days = parseFloat(row.absent_days || 0);
  row.attendance_hours = parseFloat(row.attendance_hours || 0);
  row.payment_days = parseFloat(row.payment_days || 0);
  row.source_hours = parseFloat(row.source_hours || 0);
  row.source_qty = parseFloat(row.source_qty || 0);
  row.piece_rate = parseFloat(row.piece_rate || 0);
  row.use_hours = parseInt(row.use_hours ?? 1, 10) ? 1 : 0;
  row.use_qty = parseInt(row.use_qty ?? 1, 10) ? 1 : 0;
  row.overtime_with_salary = parseInt(row.overtime_with_salary ?? 0, 10) ? 1 : 0;
  if (row.overtime_with_salary) row.use_hours = 1;
  row.ot_input = parseFloat(row.ot_input || 0);
  row.worked_hours = parseFloat(row.worked_hours || 0);
  row.shift_hours = parseFloat(row.shift_hours || 0);
  row.overtime_hours = parseFloat(row.overtime_hours || 0);
  row.hours_amount = row.use_hours ? (hourly * row.source_hours) : 0;
  row.qty_amount = row.use_qty ? (row.source_qty * row.piece_rate) : 0;

  if (mode === "Attendance Based") {
    row.base_pay = bs_calculate_base_pay(row, frm);
  } else if (mode === "Checkin Based") {
    row.base_pay = bs_calculate_base_pay(row, frm);
    row.ot_type = "hours";
    row.ot_input = row.overtime_hours || row.ot_input || 0;
  } else if (bs_is_piece_mode(mode)) {
    row.base_pay = bs_calculate_base_pay(row, frm);
    row.ot_input = row.overtime_with_salary ? row.source_hours : 0;
    row.ot_amount = row.overtime_with_salary ? row.hours_amount : 0;
  } else {
    row.base_pay = bs_calculate_base_pay(row, frm);
  }

  if (!bs_is_piece_mode(mode)) {
    if (row.ot_type === "days") {
      row.ot_amount = daily * row.ot_input;
    } else {
      row.ot_amount = hourly * row.ot_input;
    }
  }

  const component_totals = bs_get_component_totals(row);
  (row.components || []).forEach((item) => {
    if (!item.auto_calculated) return;
    if (item.role === "base") item.amount = row.base_pay || 0;
    if (item.role === "overtime") item.amount = bs_is_piece_mode(mode) ? (row.hours_amount || 0) : (row.ot_amount || 0);
    if (item.role === "qty") item.amount = row.qty_amount || 0;
  });
  row.total_additions = row.ot_amount + component_totals.earnings + ((bs_is_piece_mode(mode) && row.overtime_with_salary) ? (row.qty_amount || 0) : 0);
  row.total_deductions = (row.adv_deduct || 0) + component_totals.deductions;
  row.gross = row.base_pay + row.total_additions;
  row.net = Math.max(0, row.gross - row.total_deductions);
}

// ─── 8. FETCH ADVANCES ────────────────────────────────────────────────────────
async function fetch_advances_for_row(row) {
  try {
    const r = await bs_call("payroll_bulk.api.get_employee_advance_balance", {
      employee: row.employee,
    });
    const balance = parseFloat((r.message && r.message.balance) || 0);
    const count = parseInt((r.message && r.message.count) || 0, 10);
    row.advances = balance > 0 ? [{
      name: "",
      purpose: count > 1 ? `Closing Balance (${count} advances)` : "Closing Balance",
      balance,
      deduct: 0,
      aggregate: true,
    }] : [];
    row.advance_balance = balance;
    row.adv_fetched = true;
    row.adv_deduct  = 0;
    recalc_row(row);
  } catch(e) {
    row.advance_balance = 0;
    row.adv_fetched = true;
    row.advances    = [];
    console.error("Advance fetch failed:", e);
  }
}

async function bs_fetch_all_advances() {
  const btn = document.getElementById("bs-fetch-advances-btn");
  if (btn) { btn.textContent = "⏳ Fetching…"; btn.disabled = true; }
  for (const row of window._bs.rows) {
    if (!row.adv_fetched) await fetch_advances_for_row(row);
  }
  bs_render_table();
  if (btn) { btn.textContent = "🔄 Fetch All Advances"; btn.disabled = false; }
}

async function bs_load_source_data() {
  const frm = window._bs.frm;
  if (!frm || !window._bs.rows.length) {
    frappe.show_alert({ message: "Add employees before loading source data.", indicator: "orange" }, 4);
    return;
  }

  await bs_sync_source_doc(frm);
  const mode = frm.doc.calculation_mode || "Manual";
  const attendance_source = mode === "Checkin Based" ? "Employee Checkin" : "Attendance";
  const needs_attendance = ["Attendance Based", "Checkin Based"].includes(mode)
    || (mode === "Manual" && ["By Payment Days", "Deduct Absent Days"].includes(frm.doc.manual_salary_basis || "Full Month"));
  const needs_checkin_overtime = mode === "Checkin Based";
  const needs_custom_source = bs_is_piece_mode(mode);
  if (!needs_attendance && !needs_custom_source) {
    frappe.show_alert({ message: "Selected source does not need custom import.", indicator: "orange" }, 4);
    return;
  }

  if (needs_custom_source) {
    const required = [
      ["overtime_doctype", "Custom DocType"],
      ["overtime_employee_field", "Employee Field"],
      ["overtime_date_field", "Date Field"],
    ];
    if (bs_is_piece_mode(mode) && !frm.doc.overtime_hours_field && !frm.doc.overtime_qty_field) {
      frappe.show_alert({ message: "Set Total Hours Field or Total Qty Field.", indicator: "red" }, 4);
      return;
    }
    for (const [fieldname, label] of required) {
      if (!frm.doc[fieldname]) {
        frappe.show_alert({ message: `${label} is required.`, indicator: "red" }, 4);
        return;
      }
    }
  }

  const btn = document.getElementById("bs-load-source-btn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Loading..."; }
  try {
    let source_rows = {};
    if (needs_attendance) {
      const att = await bs_call("payroll_bulk.api.get_bulk_attendance_values", {
        employees: window._bs.rows.map((row) => row.employee),
        source: attendance_source,
        start_date: frm.doc.start_date || "",
        end_date: frm.doc.end_date || "",
      });
      source_rows = att.message || {};
    }
    let imported_rows = {};
    if (needs_custom_source) {
      const res = await bs_call("payroll_bulk.api.get_bulk_source_values", {
        employees: window._bs.rows.map((row) => row.employee),
        source_doctype: frm.doc.overtime_doctype,
        employee_field: frm.doc.overtime_employee_field,
        date_field: frm.doc.overtime_date_field,
        hours_field: frm.doc.overtime_hours_field || "",
        qty_field: frm.doc.overtime_qty_field || "",
        rate_field: frm.doc.overtime_rate_field || "",
        start_date: frm.doc.start_date || "",
        end_date: frm.doc.end_date || "",
        batch_name: frm.doc.name || "",
      });
      imported_rows = res.message || {};
    }
    let checkin_overtime_rows = {};
    if (needs_checkin_overtime) {
      const overtime = await bs_call("payroll_bulk.api.get_bulk_checkin_overtime_values", {
        employees: window._bs.rows.map((row) => row.employee),
        start_date: frm.doc.start_date || "",
        end_date: frm.doc.end_date || "",
      });
      checkin_overtime_rows = overtime.message || {};
    }

    window._bs.rows.forEach((row) => {
      const attendance_item = source_rows[row.employee] || {};
      row.attendance_days = parseFloat(attendance_item.attendance_days || 0);
      row.absent_days = parseFloat(attendance_item.absent_days || 0);
      row.attendance_hours = parseFloat(attendance_item.attendance_hours || 0);
      row.payment_days = parseFloat(attendance_item.payment_days || 0);

      const item = imported_rows[row.employee] || {};
      if (needs_custom_source) {
        row.source_hours = parseFloat(item.hours || 0);
        row.source_qty = parseFloat(item.qty || 0);
        row.piece_rate = parseFloat(item.rate || 0);
        row.source_row_names = item.row_names || [];
        if (mode === "Checkin Based") row.ot_input = row.overtime_hours;
      }
      if (needs_checkin_overtime) {
        const overtime_item = checkin_overtime_rows[row.employee] || {};
        row.worked_hours = parseFloat(overtime_item.worked_hours || 0);
        row.shift_hours = parseFloat(overtime_item.shift_hours || 0);
        row.overtime_hours = parseFloat(overtime_item.overtime_hours || 0);
        row.ot_input = row.overtime_hours;
      }
      recalc_row(row);
    });
    const linked_source_rows = window._bs.rows.flatMap((row) => row.source_row_names || []);
    if (needs_custom_source && linked_source_rows.length) {
      await bs_call("payroll_bulk.api.mark_bulk_source_rows", {
        source_doctype: frm.doc.overtime_doctype,
        row_names: linked_source_rows,
        batch_name: frm.doc.name || "",
      });
    }
    if (bs_auto_hide_filters_enabled()) bs_hide_filters();
    bs_render_table();
    frappe.show_alert({ message: "Source data loaded.", indicator: "green" }, 3);
  } catch (error) {
    frappe.msgprint({ title: "Source Load Error", message: error.message || String(error), indicator: "red" });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⭳ Load Source Data"; }
  }
}

// ─── 17. SUBMITTED READ-ONLY VIEW ─────────────────────────────────────────────
function render_submitted_view(frm) {
  window._bs.frm = frm;
  const $body = frm.layout.wrapper.find(".form-page");

  bs_sync_batch_from_slips(frm).finally(() => {
    frm.reload_doc().then(() => render_submitted_view_content(frm, $body));
  });
}

function render_submitted_view_content(frm, $body) {
  const rows = frm.doc.employees || [];
  const draft_count = rows.filter((r) => r.salary_slip && r.salary_slip_status === "Draft").length;

  const trs = rows.map((r)=>`
    <tr class="bs-row">
      <td class="bs-td bs-td-emp">
        <div class="bs-emp-code">${r.employee||""}</div>
        <div class="bs-emp-name">${r.employee_name&&r.employee_name!==r.employee?r.employee_name:""}</div>
      </td>
      <td class="bs-td" style="font-size:12px;color:var(--bs-muted)">${r.department||"—"}</td>
      <td class="bs-td" style="text-align:right">${fmt_num(r.ctc||0)}</td>
      <td class="bs-td" style="text-align:right;color:var(--bs-amber)">${fmt_num(r.ot_amount||0)}</td>
      <td class="bs-td" style="text-align:right">${fmt_num(r.gross_pay||r.gross||0)}</td>
      <td class="bs-td" style="text-align:right;color:var(--bs-red)">${fmt_num(r.adv_deduct||0)}</td>
      <td class="bs-td" style="text-align:right;font-weight:700;color:var(--bs-green)">${fmt_num(r.net_pay||0)}</td>
      <td class="bs-td">
        ${r.salary_slip
          ?`<a href="/app/salary-slip/${r.salary_slip}" target="_blank" class="bs-mono">${r.salary_slip}</a>`
          :`<span style="color:var(--bs-muted)">—</span>`}
      </td>
      <td class="bs-td" style="text-align:center">
        ${r.payment_entry
          ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Journal Entry','${r.payment_entry}')">Open Journal</button>`
          : (r.salary_slip_status === "Submitted"
              ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_create_single_payment('${r.employee}')">💳 Pay</button>`
              : `—`)}
      </td>
      <td class="bs-td">
        <span class="bs-status-badge bs-status-${r.salary_slip_status === "Submitted" ? "ok" : (r.salary_slip_status === "Draft" ? "warn" : (["Failed","Cancelled"].includes(r.status) ? "fail" : "ok"))}">
          ${r.salary_slip_status || r.status||"—"}
        </span>
        <div style="font-size:11px;color:var(--bs-muted)">${r.status||""}${r.payment_status && r.payment_status !== "Not Paid" ? ` • ${r.payment_status}` : ""}</div>
      </td>
    </tr>`).join("");

  $body.find("#bs-main-wrap").remove();
  $body.prepend($(`
    <div id="bs-main-wrap"><div class="bs-wrap">
      <div class="bs-header-card">
        <div class="bs-header-icon" style="background:linear-gradient(135deg,#166534,#14532d)">✓</div>
        <div>
          <div class="bs-header-title">Bulk Salary Creation — ${frm.doc.processing_status || "Completed"}</div>
          <div class="bs-header-sub">
            Company: <b>${frm.doc.company||"—"}</b>
            &nbsp;|&nbsp; Period: <b>${frm.doc.start_date||"—"}</b> → <b>${frm.doc.end_date||"—"}</b>
            &nbsp;|&nbsp; Frequency: <b>${frm.doc.payroll_frequency||"—"}</b>
          </div>
        </div>
      </div>
      <div class="bs-notice bs-notice-success bs-mb">
        Batch processed. ${rows.length} employee row(s) on record.
      </div>
      <div class="bs-footer-row bs-mb">
        ${draft_count ? `<button class="bs-btn-primary" onclick="bs_submit_saved_drafts()">✓ Submit ${draft_count} Draft Slip${draft_count > 1 ? "s" : ""}</button>` : ""}
        ${frm.doc.accrual_journal_entry
          ? `<button class="bs-btn-secondary" onclick="bs_open_doc('Journal Entry','${frm.doc.accrual_journal_entry}')">Open Accrual JE</button>`
          : `<button class="bs-btn-secondary" onclick="bs_create_accrual_journal_entry()">🧾 Create Accrual JE</button>`}
      </div>
      <div class="bs-notice bs-notice-info bs-mb" style="font-size:12px">
        <b>Status:</b> <i>Slip Created</i> = draft salary slip (not yet submitted).
        <i>Submitted</i> = salary slip submitted in ERPNext — payment can be created.
        <b>Payment Days</b> = paid days used for basic salary (CTC ÷ 30 × days). Load attendance or set manually when using By Payment Days / Deduct Absent Days.
      </div>
      <div class="bs-table-wrap">
        <table class="bs-table">
          <thead><tr>
            <th class="bs-th bs-td-emp">Employee</th>
            <th class="bs-th">Department</th>
            <th class="bs-th" style="text-align:right">CTC</th>
            <th class="bs-th" style="text-align:right">Overtime</th>
            <th class="bs-th" style="text-align:right">Gross</th>
            <th class="bs-th" style="text-align:right">Adv.Deduct</th>
            <th class="bs-th" style="text-align:right">Net Pay</th>
            <th class="bs-th">Salary Slip</th>
            <th class="bs-th">Payment</th>
            <th class="bs-th">Status</th>
          </tr></thead>
          <tbody>${trs||'<tr><td colspan="10" class="bs-empty">No rows.</td></tr>'}</tbody>
        </table>
      </div>
    </div></div>
  `));
}

