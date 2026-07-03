// ═══════════════════════════════════════════════════════════════════════════════
// Bulk Salary Creation — client script v3.0
// DocType : Bulk Salary Creation  (submittable)
// Child   : Bulk Salary Creation Employee
//
// FULL WORKFLOW:
//   1. Add employees (filter fetch or manual)
//   2. Auto-fetch CTC from Employee salary tab
//   3. Input overtime hours OR days per employee
//   4. Auto-calculate gross salary (base + overtime)
//   5. Fetch employee advances — choose deduction amount per employee
//   6. Review & create Salary Slips (submit optional)
//   7. Per-employee printable payslip PDF
//   8. Create Payment Entries — individual or bulk
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. FORM HOOKS ────────────────────────────────────────────────────────────
frappe.ui.form.on("Bulk Salary Creation", {
  refresh(frm) {
    inject_bs_styles();
    frm.fields_dict.employees && frm.fields_dict.employees.$wrapper.hide();
    frm.disable_save();
    if (frm.doc.docstatus === 1) {
      render_submitted_view(frm);
    } else {
      bs_bootstrap_main_ui(frm);
    }
  },
});

// ─── 2. GLOBAL STATE ──────────────────────────────────────────────────────────
window._bs = {
  rows:        [],   // employee rows
  counter:     0,    // row id counter
  ctrls:       {},   // frappe link controls
  frm:         null,
  results:     [],   // after processing
  vals:        {},   // payroll dialog values
  active_filter:"all",
  search_query:"",
  settings:    null,
};

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

  $(".bs-overtime-source-field").hide();
  $(".bs-source-map-field").toggle(use_custom);
  $(".bs-source-hours-field").toggle(use_custom);
  $(".bs-source-map-piece").toggle(use_custom);
  $(".bs-per-piece-basis-field").toggle(use_piece);
  $(".bs-piece-mode-option").toggle(use_piece);
  const overtime_with_salary = $("#bs-global-overtime-with-salary").is(":checked");
  $("#bs-global-use-hours").prop("checked", overtime_with_salary ? true : $("#bs-global-use-hours").is(":checked"));
  $("#bs-global-use-hours").prop("disabled", use_piece && overtime_with_salary);
  $("#bs-load-source-btn").toggle(!show_manual_note && (use_custom || use_attendance_loader));

  let note = "Manual mode uses direct entry for base pay and overtime.";
  if (mode === "Attendance Based") note = "Attendance Based: Basic Pay = CTC / 30 × present days from Attendance. Overtime stays manual in each employee row.";
  if (mode === "Checkin Based") note = "Checkin Based: Basic Pay = CTC / 30 × unique checkin days. Overtime auto-loads from last checkin minus first checkin.";
  if (bs_is_piece_mode(mode)) note = "Per Piece or Per Hour: each employee row can use both Hours and Qty together. Hours use (CTC / 30 / 8) × Hours. Qty uses Qty × Rate.";
  if (bs_is_piece_mode(mode) && overtime_with_salary) note = "Overtime with Salary: Basic Salary stays from employee CTC. Hours load as overtime from the custom source. Qty stays separate and can still be included or excluded.";
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
      if (["calculation_mode", "overtime_source", "per_piece_basis"].includes(key)) {
        const normalized = bs_normalize_source_values(bs_collect_source_values(frm));
        Object.assign(frm.doc, normalized);
        bs_control_set_value(source_ctrls.overtime_source, "Manual");
        bs_control_set_value(source_ctrls.per_piece_basis, normalized.per_piece_basis || "Total Hours");
      }
      await bs_sync_source_doc(frm);
      if (["overtime_doctype", "calculation_mode", "overtime_source", "per_piece_basis"].includes(key)) {
        await bs_refresh_source_field_options(frm);
      }
      if (["calculation_mode"].includes(key) && window._bs.rows.length) {
        await bs_refresh_structure_assignments(window._bs.rows);
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
        <button class="bs-btn-secondary" id="bs-create-accrual-btn">🧾 Create Accrual JE</button>
        <button class="bs-btn-secondary" id="bs-create-missing-btn">＋ Create Missing Only</button>
        <button class="bs-btn-secondary" id="bs-save-draft-btn">💾 Save Draft</button>
        <button class="bs-btn-primary bs-btn-lg" id="bs-review-btn">Review &amp; Create Slips →</button>
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
    bs_refresh_structure_assignments(window._bs.rows).finally(() => bs_render_table());
  } else {
    bs_render_table();
  }
  bs_render_live_summary(frm);
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
    const action_html = `
      <div class="bs-row-actions">
        ${r.salary_slip ? `<button class="bs-btn-ghost bs-btn-sm" onclick="bs_open_doc('Salary Slip','${r.salary_slip}')">Open Slip</button>` : ""}
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
    const attendance_note = (["Attendance Based", "Checkin Based"].includes(mode) || r.attendance_days || r.attendance_hours || r.payment_days)
      ? `<div class="bs-source-inline">
          <span>${attendance_source}</span>
          <span>Att ${fmt_num(r.attendance_days || 0, 1)}</span>
          <span>Abs ${fmt_num(r.absent_days || 0, 1)}</span>
          <span>Pay ${fmt_num(r.payment_days || 0, 1)}</span>
          <span>Hrs ${fmt_num(r.attendance_hours || 0, 1)}</span>
        </div>`
      : "";
    const base_formula_note = (mode === "Attendance Based" || mode === "Checkin Based")
      ? `<div class="bs-source-inline bs-source-inline-formula">
          <span>${fmt_total(r.ctc)} / 30 × ${fmt_num(r.attendance_days || 0, 1)} = ${fmt_total(r.base_pay || 0)}</span>
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
    row.base_pay = daily * row.attendance_days;
  } else if (mode === "Checkin Based") {
    row.base_pay = daily * row.attendance_days;
    row.ot_type = "hours";
    row.ot_input = row.overtime_hours || row.ot_input || 0;
  } else if (bs_is_piece_mode(mode)) {
    row.base_pay = row.overtime_with_salary ? row.ctc : (row.hours_amount + row.qty_amount);
    row.ot_input = row.overtime_with_salary ? row.source_hours : 0;
    row.ot_amount = row.overtime_with_salary ? row.hours_amount : 0;
  } else {
    row.base_pay = row.ctc;
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
  const attendance_source = bs_get_mode_attendance_source(mode);
  const needs_attendance = ["Attendance Based", "Checkin Based"].includes(mode);
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

// ─── 9. SAVE DRAFT ────────────────────────────────────────────────────────────
async function bs_save_draft() {
  if (!window._bs.rows.length) {
    frappe.show_alert({ message:"Add at least one employee first.", indicator:"orange" }, 4);
    return;
  }
  bs_sync_to_frm(window._bs.frm);
  try {
    await new Promise((res, rej) =>
      window._bs.frm.save("Save", (r) => r.exc ? rej(new Error(r.exc)) : res(r))
    );
    frappe.show_alert({ message:"Draft saved ✓", indicator:"green" }, 3);
  } catch(e) {
    frappe.msgprint({ title:"Save Error", message: e.message||String(e), indicator:"red" });
  }
}

function bs_sync_to_frm(frm) {
  bs_normalize_rows();
  if (window._bs.ctrls) {
    frm.doc.company = window._bs.ctrls.company_ctrl?.get_value() || frm.doc.company || window._bs.settings?.company || frappe.defaults.get_default("company") || "";
  }
  bs_sync_source_doc(frm);
  frm.doc.use_hours = window._bs.global_piece_flags?.use_hours ?? frm.doc.use_hours ?? 1;
  frm.doc.use_qty = window._bs.global_piece_flags?.use_qty ?? frm.doc.use_qty ?? 1;
  frm.doc.overtime_with_salary = window._bs.global_piece_flags?.overtime_with_salary ?? frm.doc.overtime_with_salary ?? 0;
  frappe.model.clear_table(frm.doc, "employees");
  frappe.model.clear_table(frm.doc, "component_entries");
  window._bs.rows.forEach((row) => {
    if (!row.employee) return;
    const c = frappe.model.add_child(frm.doc, "Bulk Salary Creation Employee", "employees");
    if (row.row_name) c.name = row.row_name;
    c.employee        = row.employee;
    c.employee_name   = row.employee_name;
    c.department      = row.department;
    c.designation     = row.designation;
    c.ctc             = row.ctc;
    c.ot_type         = row.ot_type === "days" ? "Days" : "Hours";
    c.ot_input        = row.ot_input;
    c.ot_amount       = row.ot_amount;
    c.piece_basis     = row.piece_basis || frm.doc.per_piece_basis || "Total Hours";
    c.source_hours    = row.source_hours || 0;
    c.source_qty      = row.source_qty || 0;
    c.piece_rate      = row.piece_rate || 0;
    c.use_hours       = row.use_hours ? 1 : 0;
    c.use_qty         = row.use_qty ? 1 : 0;
    c.attendance_days = row.attendance_days || 0;
    c.absent_days     = row.absent_days || 0;
    c.attendance_hours = row.attendance_hours || 0;
    c.payment_days    = row.payment_days || 0;
    c.worked_hours    = row.worked_hours || 0;
    c.shift_hours     = row.shift_hours || 0;
    c.overtime_hours  = row.overtime_hours || 0;
    c.bonus_amount    = row.bonus_amount || 0;
    c.other_allowance = row.other_allowance || 0;
    c.total_additions = row.total_additions || 0;
    c.advance_balance = row.advance_balance || 0;
    c.adv_deduct      = row.adv_deduct;
    c.late_deduction  = row.late_deduction || 0;
    c.other_deduction = row.other_deduction || 0;
    c.total_deductions = row.total_deductions || 0;
    c.gross_pay       = row.gross;
    c.net_pay         = row.net;
    c.status          = row.status || "Pending";
    c.salary_slip_status = row.salary_slip_status || "";
    c.payment_status  = row.payment_status || "Not Paid";
    c.salary_structure = row.salary_structure || "";
    c.salary_structure_assignment = row.salary_structure_assignment || "";
    c.payroll_payable_account = row.payroll_payable_account || "";
    c.slip_cancelled_on = row.slip_cancelled_on || "";
    c.error_message   = row.error_message || "";
    if (row.salary_slip) c.salary_slip = row.salary_slip;
    if (row.payment_entry) c.payment_entry = row.payment_entry;

    (row.components || [])
      .filter((item) => item.component && !item.auto_calculated && parseFloat(item.amount || 0) > 0)
      .forEach((item) => {
        const component_row = frappe.model.add_child(frm.doc, "Bulk Salary Component Entry", "component_entries");
        component_row.employee_row = c.name || row.row_name || "";
        component_row.employee = row.employee;
        component_row.salary_component = item.component;
        component_row.component_type = item.type || "Earning";
        component_row.amount = parseFloat(item.amount || 0) || 0;
      });
  });
  bs_update_parent_summary(frm);
  frm.refresh_field("employees");
}

function bs_update_parent_summary(frm) {
  const rows = window._bs.rows || [];
  const processed = rows.filter((r) => ["Slip Created","Submitted","Payment Created","Completed","Cancelled","Failed"].includes(r.status || "")).length;
  const success = rows.filter((r) => ["Slip Created","Submitted","Payment Created","Completed"].includes(r.status || "")).length;
  const failed = rows.filter((r) => (r.status || "") === "Failed").length;
  const submitted = rows.filter((r) => (r.salary_slip_status || "") === "Submitted").length;
  const cancelled = rows.filter((r) => (r.salary_slip_status || "") === "Cancelled" || (r.status || "") === "Cancelled").length;
  const invalid_structures = rows.filter((r) => !!(r.structure_warning || "")).length;

  frm.doc.total_employees = rows.length;
  frm.doc.processed_count = processed;
  frm.doc.success_count = success;
  frm.doc.failed_count = failed;
  frm.doc.submitted_count = submitted;
  frm.doc.cancelled_count = cancelled;
  frm.doc.invalid_structure_count = invalid_structures;
  frm.doc.total_additions = rows.reduce((sum, row) => sum + (row.total_additions || 0), 0);
  frm.doc.total_deductions = rows.reduce((sum, row) => sum + (row.total_deductions || 0), 0);
  frm.doc.total_gross = rows.reduce((sum, row) => sum + (row.gross || 0), 0);
  frm.doc.total_net = rows.reduce((sum, row) => sum + (row.net || 0), 0);

  if (!rows.length) frm.doc.processing_status = "Draft";
  else if (cancelled === rows.length) frm.doc.processing_status = "Cancelled";
  else if (failed && success) frm.doc.processing_status = "Completed With Errors";
  else if (failed) frm.doc.processing_status = "Partially Processed";
  else if (submitted || success) frm.doc.processing_status = "Completed";
  else frm.doc.processing_status = "Ready";
}

function bs_get_invalid_structure_rows() {
  return (window._bs.rows || []).filter((row) => !!(row.structure_warning || ""));
}

function bs_get_detected_payable_accounts() {
  const accounts = new Set(
    (window._bs.rows || [])
      .map((row) => row.payroll_payable_account || "")
      .filter(Boolean),
  );
  return Array.from(accounts);
}

function bs_render_structure_summary() {
  const rows = bs_get_invalid_structure_rows();
  const el = document.getElementById("bs-structure-summary");
  const reviewBtn = document.getElementById("bs-review-btn");
  const missingBtn = document.getElementById("bs-create-missing-btn");
  const accrualBtn = document.getElementById("bs-create-accrual-btn");
  if (!el) return;

  if (!rows.length) {
    const accounts = bs_get_detected_payable_accounts();
    if (accounts.length === 1) {
      el.className = "bs-notice bs-notice-info bs-mb";
      el.innerHTML = `<b>Detected Payroll Payable Account:</b> ${frappe.utils.escape_html(accounts[0])}`;
      el.style.display = "";
    } else if (accounts.length > 1) {
      el.className = "bs-notice bs-notice-warn bs-mb";
      el.innerHTML = `<b>Multiple Payroll Payable Accounts detected:</b> ${accounts.map((account) => frappe.utils.escape_html(account)).join(", ")}`;
      el.style.display = "";
    } else {
      el.style.display = "none";
    }
    if (reviewBtn) reviewBtn.disabled = false;
    if (missingBtn) missingBtn.disabled = false;
    if (accrualBtn) accrualBtn.disabled = accounts.length > 1;
    return;
  }

  const sample = rows.slice(0, 4).map((row) =>
    `<b>${frappe.utils.escape_html(row.employee)}</b>: ${frappe.utils.escape_html(row.structure_warning)}`
  ).join("<br>");
  const more = rows.length > 4 ? `<br>...and ${rows.length - 4} more employee(s).` : "";
  el.className = "bs-notice bs-notice-error bs-mb";
  el.innerHTML = `<b>Salary Structure issue:</b> ${rows.length} employee(s) have missing or zero-base structure assignment.<br>${sample}${more}`;
  el.style.display = "";
  if (reviewBtn) reviewBtn.disabled = true;
  if (missingBtn) missingBtn.disabled = true;
  if (accrualBtn) accrualBtn.disabled = true;
}

function bs_render_live_summary(frm) {
  if (!frm) return;
  bs_update_parent_summary(frm);
  const set_text = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set_text("bs-card-employees", String(frm.doc.total_employees || 0));
  set_text("bs-card-gross", fmt_total(frm.doc.total_gross || 0));
  set_text("bs-card-deductions", fmt_total(frm.doc.total_deductions || 0));
  set_text("bs-card-net", fmt_total(frm.doc.total_net || 0));
  set_text("bs-card-submitted", String(frm.doc.submitted_count || 0));
  set_text("bs-card-cancelled", String(frm.doc.cancelled_count || 0));
  bs_render_structure_summary();
}

function bs_find_child_row(frm, row) {
  return (frm.doc.employees || []).find((child) =>
    (row.row_name && child.name === row.row_name) || child.employee === row.employee
  );
}

function bs_sync_row_names_from_doc(frm) {
  window._bs.rows.forEach((row) => {
    const child = bs_find_child_row(frm, row);
    if (child && child.name) row.row_name = child.name;
  });
}

// ─── 10. PAYROLL DETAILS DIALOG ───────────────────────────────────────────────
function open_payroll_dialog(config = {}) {
  const invalid_rows = bs_get_invalid_structure_rows();
  if (invalid_rows.length) {
    frappe.msgprint({
      title: "Salary Structure Issue",
      message: `${invalid_rows.length} employee(s) have missing or zero-base Salary Structure Assignment. Fix them before creating Salary Slips.`,
      indicator: "red",
    });
    return;
  }
  if (!window._bs.rows.length) {
    frappe.msgprint({ title:"Nothing to process",
      message:"Add at least one employee.", indicator:"orange" }); return;
  }

  const frm     = window._bs.frm;
  const company = frm.doc.company || frappe.defaults.get_default("company");
  const current_frequency = frm.doc.payroll_frequency || "Monthly";
  const current_start_date = frm.doc.start_date || null;
  const current_end_date = frm.doc.end_date || null;
  const current_posting_date = frm.doc.posting_date || frappe.datetime.get_today();
  const settings = window._bs.settings || bs_default_settings();

  const d = new frappe.ui.Dialog({
    title: "Payroll Details",
    size:  "small",
    fields: [
      { fieldtype:"HTML", fieldname:"info",
        options:`<div class="bs-notice bs-notice-info" style="margin-bottom:12px">
          Creating slips for <b>${window._bs.rows.length}</b> employee(s).<br>
          Total estimated net: <b>${fmt_num(window._bs.rows.reduce((s,r)=>s+r.net,0))}</b>
        </div>` },
      { fieldtype:"Link", fieldname:"company", options:"Company",
        label:"Company", reqd:1, default:company },
      { fieldtype:"Select", fieldname:"payroll_frequency",
        label:"Payroll Frequency",
        options:["Monthly", "Bimonthly", "Fortnightly", "Weekly", "Daily"].join("\n"),
        reqd:1, default:current_frequency },
      { fieldtype:"Date", fieldname:"start_date", label:"Start Date", reqd:1, default: current_start_date },
      { fieldtype:"Date", fieldname:"end_date",   label:"End Date",   reqd:1, default: current_end_date },
      { fieldtype:"Date", fieldname:"posting_date", label:"Posting Date",
        reqd:1, default: current_posting_date },
      { fieldtype:"Check", fieldname:"submit_slips",
        label:"Submit Salary Slips after creation", default: Number(settings.default_submit_slips) ? 1 : 0 },
      { fieldtype:"Check", fieldname:"replace_existing_slips",
        label:"Cancel and Recreate Existing Slips", default: 0 },
      { fieldtype:"Check", fieldname:"create_missing_only",
        label:"Create Missing Slips Only", default: config.create_missing_only ? 1 : 0 },
    ],
    primary_action_label: config.create_missing_only ? "Create Missing Slips" : "Confirm & Create Slips",
    primary_action(vals) {
      if (!vals.start_date || !vals.end_date) {
        frappe.show_alert({ message:"Dates are required.", indicator:"red" }, 4); return;
      }
      if (vals.start_date > vals.end_date) {
        frappe.show_alert({ message:"Start date cannot be after end date.", indicator:"red" }, 4); return;
      }
      vals.overtime_component = frm.doc.overtime_component || "";
      vals.bonus_component = frm.doc.bonus_component || "";
      vals.allowance_component = frm.doc.allowance_component || "";
      vals.advance_deduction_component = "Advance Deduction";
      vals.late_deduction_component = frm.doc.late_deduction_component || "";
      vals.deduction_component = frm.doc.deduction_component || "";
      d.hide();
      process_bulk(frm, vals);
    },
  });

  const set_dialog_period = () => {
    const freq = d.get_value("payroll_frequency");
    const posting_date = d.get_value("posting_date") || frappe.datetime.get_today();
    const base_date = frappe.datetime.str_to_obj(posting_date);

    if (!freq || !base_date) return;

    let start_date = posting_date;
    let end_date = posting_date;

    if (freq === "Monthly") {
      start_date = frappe.datetime.month_start(posting_date);
      end_date = frappe.datetime.month_end(posting_date);
    } else if (freq === "Weekly") {
      const day = base_date.getDay();
      const monday = new Date(base_date);
      monday.setDate(base_date.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      start_date = frappe.datetime.obj_to_str(monday);
      end_date = frappe.datetime.obj_to_str(sunday);
    } else if (freq === "Fortnightly") {
      start_date = frappe.datetime.month_start(posting_date);
      end_date = frappe.datetime.obj_to_str(new Date(base_date.getFullYear(), base_date.getMonth(), 15));
    } else if (freq === "Bimonthly") {
      const is_first_half = base_date.getDate() <= 15;
      start_date = is_first_half
        ? frappe.datetime.month_start(posting_date)
        : frappe.datetime.obj_to_str(new Date(base_date.getFullYear(), base_date.getMonth(), 16));
      end_date = is_first_half
        ? frappe.datetime.obj_to_str(new Date(base_date.getFullYear(), base_date.getMonth(), 15))
        : frappe.datetime.month_end(posting_date);
    }

    d.set_value("start_date", start_date);
    d.set_value("end_date", end_date);
  };

  d.fields_dict.payroll_frequency.$input.on("change", set_dialog_period);
  d.fields_dict.posting_date.$input.on("change", () => {
    if (!d.get_value("start_date") || !d.get_value("end_date")) {
      set_dialog_period();
      return;
    }
    const freq = d.get_value("payroll_frequency");
    if (["Monthly", "Bimonthly", "Fortnightly", "Weekly", "Daily"].includes(freq)) {
      set_dialog_period();
    }
  });
  d.show();
  if (!(current_start_date && current_end_date)) {
    setTimeout(set_dialog_period, 200);
  }
}


async function bs_get_salary_structure(employee, on_date) {
  const res = await bs_call("frappe.client.get_list", {
    doctype: "Salary Structure Assignment",
    filters: {
      employee,
      docstatus: 1,
      from_date: ["<=", on_date],
    },
    fields: ["name", "salary_structure", "base", "from_date", "payroll_payable_account"],
    order_by: "from_date desc, creation desc",
    limit_page_length: 1,
  });
  const row = (res.message || [])[0];
  if (!row || !row.salary_structure) {
    throw new Error(`No Salary Structure Assignment found for ${employee}.`);
  }
  return row;
}

async function bs_refresh_structure_assignments(rows = window._bs.rows || []) {
  const frm = window._bs.frm;
  const on_date = frm?.doc?.end_date || frm?.doc?.start_date || frappe.datetime.get_today();
  const targets = (rows || []).filter((row) => row.employee);
  if (!targets.length) return;
  const include_structure_components = bs_to_int(window._bs.settings?.auto_load_structure_components, 1) === 1;
  const should_load_components = bs_should_load_any_components();

  await Promise.all(targets.map(async (row) => {
    try {
      const structure_info = await bs_get_salary_structure(row.employee, on_date);
      const structure_doc = await bs_get_salary_structure_doc(structure_info.salary_structure);
      row.salary_structure = structure_info.salary_structure || row.salary_structure || "";
      row.salary_structure_assignment = structure_info.name || row.salary_structure_assignment || "";
      row.payroll_payable_account = structure_info.payroll_payable_account || "";
      row.structure_base = parseFloat(structure_info.base || 0);
      row.structure_warning = row.payroll_payable_account
        ? ""
        : `Payroll Payable Account missing on ${row.salary_structure_assignment || "Salary Structure Assignment"}`;
      if (should_load_components) {
        bs_build_row_components(row, structure_doc, { include_structure: include_structure_components });
      }
    } catch (error) {
      row.salary_structure = "";
      row.salary_structure_assignment = "";
      row.payroll_payable_account = "";
      row.structure_base = 0;
      row.structure_warning = error.message || "Salary Structure Assignment not found";
      if (should_load_components) {
        bs_build_row_components(row, null, { include_structure: false });
      } else {
        row.components = row.components || [];
      }
    }
  }));
}

async function bs_find_salary_component(component_name) {
  const res = await bs_call("frappe.client.get_list", {
    doctype: "Salary Component",
    filters: { salary_component: component_name },
    fields: ["name", "salary_component"],
    limit_page_length: 1,
  });
  return (res.message || [])[0] || null;
}

async function bs_ensure_salary_component(component_name, type) {
  const existing = await bs_find_salary_component(component_name);
  if (existing) return existing.salary_component || existing.name;
  const inserted = await bs_call("frappe.client.insert", {
    doc: {
      doctype: "Salary Component",
      salary_component: component_name,
      salary_component_abbr: component_name.slice(0, 10).toUpperCase(),
      type,
      depends_on_payment_days: 0,
      is_tax_applicable: 1,
      remove_if_zero_valued: 1,
    },
  });
  return inserted.message.salary_component || inserted.message.name;
}

async function bs_delete_generated_additional_salaries(employee, payroll_date, batch_name) {
  const res = await bs_call("frappe.client.get_list", {
    doctype: "Additional Salary",
    filters: {
      employee,
      payroll_date,
      ref_doctype: "Bulk Salary Creation",
      ref_docname: batch_name,
      docstatus: ["<", 2],
    },
    fields: ["name", "docstatus"],
    limit_page_length: 50,
  });

  for (const row of (res.message || [])) {
    if (row.docstatus === 1) {
      const full = await bs_call("frappe.client.get", { doctype: "Additional Salary", name: row.name });
      await bs_call("frappe.client.cancel", { doc: full.message });
    }
    await bs_call("frappe.client.delete", { doctype: "Additional Salary", name: row.name });
  }
}

async function bs_make_additional_salary({ employee, company, component, type, amount, payroll_date, start_date, end_date, ref_doctype, ref_docname }) {
  amount = parseFloat(amount || 0);
  if (amount <= 0) return null;

  const emp = await bs_call("frappe.client.get_value", {
    doctype: "Employee",
    filters: { name: employee },
    fieldname: ["employee_name", "department"],
  });
  const inserted = await bs_call("frappe.client.insert", {
    doc: {
      doctype: "Additional Salary",
      employee,
      employee_name: emp.message.employee_name || employee,
      department: emp.message.department || "",
      company,
      is_recurring: 0,
      from_date: start_date,
      to_date: end_date,
      payroll_date,
      salary_component: component,
      type,
      amount,
      overwrite_salary_structure_amount: 0,
      ref_doctype,
      ref_docname,
    },
  });
  const full = await bs_call("frappe.client.get", { doctype: "Additional Salary", name: inserted.message.name });
  await bs_call("frappe.client.submit", { doc: full.message });
  return inserted.message.name;
}

async function bs_prepare_salary_inputs(row, vals, batch_name) {
  await bs_delete_generated_additional_salaries(row.employee, vals.posting_date, batch_name);
  const mode = window._bs.frm?.doc?.calculation_mode || "Manual";
  const hourly_rate = (parseFloat(row.ctc || 0) || 0) / 30 / 8;
  const hour_amount = (parseFloat(row.source_hours || 0) || 0) * hourly_rate;
  const qty_amount = (parseFloat(row.source_qty || 0) || 0) * (parseFloat(row.piece_rate || 0) || 0);

  if (bs_is_piece_mode(mode) && hour_amount > 0) {
    const hour_component = await bs_resolve_special_component(row, vals, "hours");
    await bs_make_additional_salary({
      employee: row.employee,
      company: vals.company,
      component: hour_component,
      type: "Earning",
      amount: hour_amount,
      payroll_date: vals.posting_date,
      start_date: vals.start_date,
      end_date: vals.end_date,
      ref_doctype: "Bulk Salary Creation",
      ref_docname: batch_name,
    });
  }

  if (bs_is_piece_mode(mode) && qty_amount > 0) {
    const qty_component = await bs_resolve_special_component(row, vals, "qty");
    await bs_make_additional_salary({
      employee: row.employee,
      company: vals.company,
      component: qty_component,
      type: "Earning",
      amount: qty_amount,
      payroll_date: vals.posting_date,
      start_date: vals.start_date,
      end_date: vals.end_date,
      ref_doctype: "Bulk Salary Creation",
      ref_docname: batch_name,
    });
  }

  if (!bs_is_piece_mode(mode) && row.ot_amount > 0) {
    const overtime_component = await bs_resolve_special_component(row, vals, "overtime");
    await bs_make_additional_salary({
      employee: row.employee,
      company: vals.company,
      component: overtime_component,
      type: "Earning",
      amount: row.ot_amount,
      payroll_date: vals.posting_date,
      start_date: vals.start_date,
      end_date: vals.end_date,
      ref_doctype: "Bulk Salary Creation",
      ref_docname: batch_name,
    });
  }

  if (row.adv_deduct > 0) {
    const deduction_component = vals.advance_deduction_component || await bs_ensure_salary_component("Advance Deduction", "Deduction");
    const single_named_advance = row.advances && row.advances.length === 1 && row.advances[0].name && !row.advances[0].aggregate;
    const ref_doctype = single_named_advance ? "Employee Advance" : "Bulk Salary Creation";
    const ref_docname = single_named_advance ? row.advances[0].name : batch_name;
    await bs_make_additional_salary({
      employee: row.employee,
      company: vals.company,
      component: deduction_component,
      type: "Deduction",
      amount: row.adv_deduct,
      payroll_date: vals.posting_date,
      start_date: vals.start_date,
      end_date: vals.end_date,
      ref_doctype,
      ref_docname,
    });
  }

  for (const item of (row.components || [])) {
    const amount = parseFloat(item.amount || 0);
    if (!item.component || amount <= 0) continue;
    await bs_make_additional_salary({
      employee: row.employee,
      company: vals.company,
      component: item.component,
      type: item.type || "Earning",
      amount,
      payroll_date: vals.posting_date,
      start_date: vals.start_date,
      end_date: vals.end_date,
      ref_doctype: "Bulk Salary Creation",
      ref_docname: batch_name,
    });
  }
}

async function bs_existing_salary_slip(row, vals) {
  const res = await bs_call("frappe.client.get_list", {
    doctype: "Salary Slip",
    filters: {
      employee: row.employee,
      company: vals.company,
      start_date: vals.start_date,
      end_date: vals.end_date,
      docstatus: ["<", 2],
    },
    fields: ["name"],
    limit_page_length: 1,
  });
  return (res.message || [])[0]?.name || "";
}

// ─── 11. PROCESS ──────────────────────────────────────────────────────────────
async function process_bulk(frm, vals) {
  window._bs.vals = vals;
  const $body = frm.layout.wrapper.find(".form-page");
  const rows  = [...window._bs.rows];
  const total = rows.length;

  $body.find("#bs-main-wrap").html(`
    <div class="bs-wrap">
      <div class="bs-header-card">
        <div class="bs-header-icon">●</div>
        <div>
          <div class="bs-header-title">Creating Salary Slips</div>
          <div class="bs-header-sub">Processing ${total} employee(s)…</div>
        </div>
      </div>
      <div class="bs-progress-wrap">
        <div class="bs-progress-bar-bg">
          <div class="bs-progress-bar" id="bs-prog-bar" style="width:0%"></div>
        </div>
        <div id="bs-prog-label" class="bs-prog-label">0 / ${total}</div>
      </div>
      <div id="bs-log" class="bs-log"></div>
    </div>
  `);

  const log = (msg, type="info") => {
    const el = document.getElementById("bs-log");
    if (!el) return;
    const d = document.createElement("div");
    d.className = `bs-log-row bs-log-${type}`;
    d.innerHTML = msg;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  };
  const set_prog = (n) => {
    const b = document.getElementById("bs-prog-bar");
    const l = document.getElementById("bs-prog-label");
    if (b) b.style.width = Math.round((n / Math.max(total, 1)) * 100) + "%";
    if (l) l.textContent = `${n} / ${total}`;
  };

  log("Saving parent document…");
  frm.doc.company           = vals.company;
  frm.doc.payroll_frequency = vals.payroll_frequency;
  frm.doc.start_date        = vals.start_date;
  frm.doc.end_date          = vals.end_date;
  frm.doc.posting_date      = vals.posting_date;
  bs_sync_to_frm(frm);

  try {
    await new Promise((res, rej) => frm.save("Save", (r) => r.exc ? rej(new Error(r.exc)) : res(r)));
    bs_sync_row_names_from_doc(frm);
    log("Parent doc saved ✓", "success");
  } catch (e) {
    log(`Parent save failed: ${e.message || e}`, "error");
    frappe.msgprint({ title: "Save Error", message: e.message || String(e), indicator: "red" });
    return;
  }

  const results = [];
  let has_failures = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    set_prog(i);
    log(`<span class="bs-log-emp">${row.employee}</span> — Validating…`);

    try {
      if (!row.employee) throw new Error("Employee is required.");
      if (!row.ctc) throw new Error("CTC is missing.");
      if (row.adv_deduct > 0 && row.advance_balance > 0 && row.adv_deduct > row.advance_balance) {
        throw new Error("Advance deduction cannot exceed advance balance.");
      }

      const exists = await bs_existing_salary_slip(row, vals);
      if (exists && !vals.replace_existing_slips) {
        row.salary_slip = exists;
        row.status = "Skipped";
        row.error_message = vals.create_missing_only
          ? "Skipped because Salary Slip already exists."
          : "Linked existing Salary Slip for this period.";
        const child = bs_find_child_row(frm, row);
        if (child) {
          child.salary_slip = exists;
          child.status = row.status;
          child.error_message = row.error_message;
        }
        await window.bs_refresh_row_status(row._id, { silent: true });
        log(
          `<span class="bs-log-emp">${row.employee}</span> — Using existing slip <b>${exists}</b>`,
          "info",
        );
        results.push({
          employee: row.employee,
          employee_name: row.employee_name,
          slip_name: exists,
          ctc: row.ctc,
          ot_amount: row.ot_amount,
          gross: row.gross,
          adv_deduct: row.adv_deduct,
          net: row.net,
          status: row.status,
          error: "",
          payment_entry: row.payment_entry || "",
        });
        continue;
      }
      if (exists && vals.replace_existing_slips) {
        log(
          `<span class="bs-log-emp">${row.employee}</span> — Existing slip <b>${exists}</b> will be cancelled and recreated`,
          "info",
        );
      }

      row.status = "Validated";
      const structure_info = await bs_get_salary_structure(row.employee, vals.end_date);
      if ((parseFloat(structure_info.base) || 0) <= 0) {
        if ((parseFloat(row.ctc) || 0) <= 0) {
          throw new Error(
            `Salary Structure Assignment ${structure_info.name} has Base = 0 and employee CTC is also zero.`,
          );
        }
        await bs_call("payroll_bulk.api.sync_salary_structure_assignment_base", {
          assignment_name: structure_info.name,
          base: row.ctc,
        });
        structure_info.base = row.ctc;
      }
      row.salary_structure = structure_info.salary_structure || "";
      row.salary_structure_assignment = structure_info.name || "";
      row.payroll_payable_account = structure_info.payroll_payable_account || row.payroll_payable_account || "";
      row.structure_base = parseFloat(structure_info.base || row.ctc || 0);
      row.structure_warning = row.payroll_payable_account
        ? ""
        : `Payroll Payable Account missing on ${row.salary_structure_assignment || "Salary Structure Assignment"}`;
      await bs_prepare_salary_inputs(row, vals, frm.doc.name);

      const created = await bs_call("payroll_bulk.api.create_bulk_salary_slip", {
        batch_name: frm.doc.name,
        row_name: row.row_name || "",
        company: vals.company,
        payroll_frequency: vals.payroll_frequency,
        start_date: vals.start_date,
        end_date: vals.end_date,
        posting_date: vals.posting_date,
        ctc: row.ctc || 0,
        submit_slip: vals.submit_slips ? 1 : 0,
        cancel_existing: exists && vals.replace_existing_slips ? 1 : 0,
      });

      const m = created.message || created || {};
      log(`<span class="bs-log-emp">${row.employee}</span> — Slip <b>${m.name}</b> created ✓`, "success");
      if (parseInt(m.docstatus || 0, 10) === 1) {
        log(`<span class="bs-log-emp">${row.employee}</span> — Slip <b>${m.name}</b> submitted ✓`, "success");
      }

      row.salary_slip = m.name;
      row.salary_slip_status = parseInt(m.docstatus || 0, 10) === 1 ? "Submitted" : "Draft";
      row.salary_structure = m.salary_structure || row.salary_structure || "";
      row.salary_structure_assignment = m.salary_structure_assignment || row.salary_structure_assignment || "";
      row.payroll_payable_account = m.payroll_payable_account || row.payroll_payable_account || "";
      row.gross = parseFloat(m.gross_pay || row.gross || 0);
      row.net = parseFloat(m.net_pay || row.net || 0);
      row.payment_days = parseFloat(m.payment_days || row.payment_days || 0);
      row.absent_days = parseFloat(m.absent_days || row.absent_days || 0);
      row.attendance_days = parseFloat(m.total_working_days || row.attendance_days || 0);
      row.status = vals.submit_slips ? "Submitted" : "Slip Created";
      row.error_message = "";
      if ((row.source_row_names || []).length && frm.doc.overtime_doctype) {
        await bs_call("payroll_bulk.api.mark_bulk_source_rows", {
          source_doctype: frm.doc.overtime_doctype,
          row_names: row.source_row_names,
          batch_name: frm.doc.name || "",
          salary_slip: m.name,
        });
      }

      const child = bs_find_child_row(frm, row);
      if (child) {
        child.salary_slip = m.name;
        child.salary_structure = row.salary_structure;
        child.salary_structure_assignment = row.salary_structure_assignment;
        child.salary_slip_status = row.salary_slip_status;
        child.payment_days = row.payment_days || 0;
        child.absent_days = row.absent_days || 0;
        child.attendance_days = row.attendance_days || 0;
        child.total_additions = row.total_additions;
        child.total_deductions = row.total_deductions;
        child.gross_pay = row.gross;
        child.net_pay = row.net;
        child.status = row.status;
        child.payment_status = row.payment_status || "Not Paid";
        child.error_message = "";
      }

      results.push({
        employee: row.employee,
        employee_name: row.employee_name,
        slip_name: m.name,
        ctc: row.ctc,
        ot_amount: row.ot_amount,
        gross: row.gross,
        adv_deduct: row.adv_deduct,
        net: row.net,
        status: "Success",
        error: "",
        payment_entry: "",
      });
    } catch (err) {
      const msg = err.message || String(err);
      has_failures = true;
      row.status = "Failed";
      row.salary_slip_status = "";
      row.error_message = msg;
      const child = bs_find_child_row(frm, row);
      if (child) {
        child.status = "Failed";
        child.salary_slip_status = "";
        child.error_message = msg;
      }
      log(`<span class="bs-log-emp">${row.employee}</span> — ❌ ${msg}`, "error");
      results.push({
        employee: row.employee,
        employee_name: row.employee_name,
        slip_name: "",
        ctc: row.ctc,
        ot_amount: row.ot_amount,
        gross: row.gross,
        adv_deduct: row.adv_deduct,
        net: row.net,
        status: "Failed",
        error: msg,
        payment_entry: "",
      });
    }
  }

  set_prog(total);
  frm.refresh_field("employees");

  try {
    bs_sync_to_frm(frm);
    await new Promise((res, rej) => frm.save("Save", (r) => r.exc ? rej(new Error(r.exc)) : res(r)));
    log("Parent results saved ✓", "success");
    log(has_failures ? "Parent kept in Draft because some rows failed." : "Parent remains Draft. Salary Slips are submitted separately.", has_failures ? "info" : "success");
  } catch (e) {
    log(`Parent finalize failed: ${e.message || e}`, "error");
    frappe.msgprint({ title:"Finalize Error", message:e.message || String(e), indicator:"red" });
  }

  window._bs.results = results;
  show_summary(frm, results, vals);
}

// ─── 12. SUMMARY ──────────────────────────────────────────────────────────────
function show_summary(frm, results, vals) {
  const $body   = frm.layout.wrapper.find(".form-page");
  const success = results.filter((r)=>r.status!=="Failed" && !!r.slip_name);
  const failed  = results.filter((r)=>r.status==="Failed");

  const total_gross = success.reduce((s,r)=>s+r.gross,0);
  const total_ded   = success.reduce((s,r)=>s+r.adv_deduct,0);
  const total_net   = success.reduce((s,r)=>s+r.net,0);
  const total_ot    = success.reduce((s,r)=>s+r.ot_amount,0);

  const rows_html = results.map((r)=>{
    const ok = r.status!=="Failed" && !!r.slip_name;
    const batch_row = window._bs.rows.find((row) => row.employee === r.employee);
    const can_pay = ok && batch_row && batch_row.salary_slip_status === "Submitted" && !batch_row.payment_entry;
    return `
      <tr class="bs-row" id="bs-sum-row-${r.employee.replace(/[^a-z0-9]/gi,'-')}">
        <td class="bs-td bs-td-emp">
          <div class="bs-emp-code">${r.employee}</div>
          <div class="bs-emp-name">${r.employee_name!==r.employee?r.employee_name:""}</div>
        </td>
        <td class="bs-td"><span class="bs-mono">${r.slip_name||"—"}</span></td>
        <td class="bs-td" style="text-align:right">${ok?fmt_num(r.ctc):"—"}</td>
        <td class="bs-td" style="text-align:right;color:var(--bs-amber)">${ok?fmt_num(r.ot_amount):"—"}</td>
        <td class="bs-td" style="text-align:right">${ok?fmt_num(r.gross):"—"}</td>
        <td class="bs-td" style="text-align:right;color:var(--bs-red)">${ok?fmt_num(r.adv_deduct):"—"}</td>
        <td class="bs-td" style="text-align:right;font-weight:700;color:var(--bs-green)">${ok?fmt_num(r.net):"—"}</td>
        <td class="bs-td">
          <span class="bs-status-badge bs-status-${ok?"ok":"fail"}">
            ${ok?((batch_row?.salary_slip_status)|| (vals.submit_slips?"Submitted":"Processed")):"Failed"}
          </span>
        </td>
        <td class="bs-td" style="text-align:center">
          ${ok?`<button class="bs-btn-ghost bs-btn-sm" onclick="bs_print_payslip('${r.employee}')">🖨 Print</button>`:"—"}
        </td>
        <td class="bs-td" style="text-align:center">
          ${can_pay?`<button class="bs-btn-ghost bs-btn-sm" id="bs-pay-btn-${r.employee.replace(/[^a-z0-9]/gi,'-')}"
            onclick="bs_create_single_payment('${r.employee}')">💳 Pay</button>`:"—"}
        </td>
      </tr>`;
  }).join("");

  $body.find("#bs-main-wrap").html(`
    <div class="bs-wrap">
      <div class="bs-header-card">
        <div class="bs-header-icon" style="background:linear-gradient(135deg,#166534,#14532d)">✓</div>
        <div>
          <div class="bs-header-title">Processing Complete</div>
          <div class="bs-header-sub">
            <b style="color:var(--bs-green)">${success.length} succeeded</b>
            ${failed.length?`&nbsp;|&nbsp;<b style="color:var(--bs-red)">${failed.length} failed</b>`:""}
            &nbsp;|&nbsp; Period: <b>${vals.start_date}</b> → <b>${vals.end_date}</b>
          </div>
        </div>
      </div>

      ${failed.length?`<div class="bs-notice bs-notice-warn bs-mb">
        <b>Failed:</b><br>${failed.map((r)=>`<b>${r.employee}</b>: ${r.error}`).join("<br>")}
      </div>`:""}

      <div class="bs-summary-totals">
        <div class="bs-total-card">
          <div class="bs-total-label">Total CTC</div>
          <div class="bs-total-value">${fmt_num(success.reduce((s,r)=>s+r.ctc,0))}</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Total Overtime</div>
          <div class="bs-total-value" style="color:var(--bs-amber)">${fmt_num(total_ot)}</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Total Gross</div>
          <div class="bs-total-value">${fmt_num(total_gross)}</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Advance Deductions</div>
          <div class="bs-total-value" style="color:var(--bs-red)">${fmt_num(total_ded)}</div>
        </div>
        <div class="bs-total-card">
          <div class="bs-total-label">Total Net Pay</div>
          <div class="bs-total-value" style="color:var(--bs-green)">${fmt_num(total_net)}</div>
        </div>
      </div>

      <!-- Payment actions -->
      <div class="bs-payment-bar">
        <div style="font-size:13px;font-weight:600;color:var(--bs-text)">Journal Entry</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:3px">
            <label class="bs-label">Pay From Account</label>
            <div id="bs-pay-account-wrap" style="min-width:220px"></div>
          </div>
          <div style="display:flex;align-items:flex-end">
            <button class="bs-btn-primary" id="bs-bulk-pay-btn">
              💳 Create Bulk Journal Entry
            </button>
          </div>
        </div>
        <div id="bs-pay-notice" style="display:none" class="bs-notice bs-notice-info"></div>
      </div>

      <div class="bs-table-wrap" style="max-height:400px;margin-top:16px">
        <table class="bs-table">
          <thead><tr>
            <th class="bs-th bs-td-emp">Employee</th>
            <th class="bs-th">Salary Slip</th>
            <th class="bs-th" style="text-align:right">CTC</th>
            <th class="bs-th" style="text-align:right">Overtime</th>
            <th class="bs-th" style="text-align:right">Gross</th>
            <th class="bs-th" style="text-align:right">Adv. Deduct</th>
            <th class="bs-th" style="text-align:right">Net Pay</th>
            <th class="bs-th">Status</th>
            <th class="bs-th" style="text-align:center">Payslip</th>
            <th class="bs-th" style="text-align:center">Payment</th>
          </tr></thead>
          <tbody>${rows_html}</tbody>
        </table>
      </div>

      <div class="bs-footer-row" style="margin-top:16px">
        <button class="bs-btn-primary" id="bs-dl-pdf">⬇ Download Summary PDF</button>
        <button class="bs-btn-secondary" id="bs-new-btn">+ New Bulk Creation</button>
      </div>
    </div>
  `);

  // Pay account link control
  const pay_acc_ctrl = frappe.ui.form.make_control({
    parent: $body.find("#bs-pay-account-wrap")[0],
    df: {
      fieldtype:"Link", fieldname:"bs_pay_account", options:"Account",
      placeholder:"Select cash/bank account…", reqd:0,
      get_query: () => ({
        filters: [
          ["account_type", "in", ["Cash","Bank"]],
          ["company",      "=",  vals.company||frappe.defaults.get_default("company")],
        ]
      }),
    },
    render_input:true,
  });
  pay_acc_ctrl.refresh();
  window._bs._pay_acc_ctrl = pay_acc_ctrl;

  // Bulk payment
  $body.find("#bs-bulk-pay-btn").on("click", () => {
    const acct = pay_acc_ctrl.get_value();
    if (!acct) {
      bs_notice("bs-pay-notice","⚠ Please select a pay-from account first.","warn"); return;
    }
    bs_create_bulk_payment(success, acct, vals);
  });

  // PDF
  $body.find("#bs-dl-pdf").on("click",  () =>
    bs_download_pdf(results, vals, total_gross, total_ded, total_net, total_ot, success, failed));
  $body.find("#bs-new-btn").on("click", () => frappe.new_doc("Bulk Salary Creation"));
}

// ─── 13. PER-EMPLOYEE PAYSLIP PDF ─────────────────────────────────────────────
window.bs_print_payslip = function(employee_id) {
  const result = window._bs.results.find((r)=>r.employee===employee_id);
  const vals   = window._bs.vals;
  if (!result || !result.slip_name) {
    frappe.show_alert({message:"No slip found for this employee.",indicator:"red"},3); return;
  }

  const load_jspdf = () => new Promise((res,rej)=>{
    const load = (src) => new Promise((r2,rj2)=>{
      if (document.querySelector(`script[src="${src}"]`)) { r2(); return; }
      const s=document.createElement("script"); s.src=src;
      s.onload=r2; s.onerror=rj2; document.head.appendChild(s);
    });
    load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
      .then(()=>load("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"))
      .then(res).catch(rej);
  });

  frappe.show_alert({message:"Generating payslip…",indicator:"blue"},3);

  load_jspdf().then(()=>{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
    const W   = doc.internal.pageSize.getWidth();
    const today = frappe.datetime.get_today();

    // Header
    doc.setFillColor(22,78,99);
    doc.rect(0,0,W,24,"F");
    doc.setTextColor(255,255,255);
    doc.setFontSize(16); doc.setFont("helvetica","bold");
    doc.text("SALARY SLIP", W/2, 12, {align:"center"});
    doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text(`${vals.company||""}   |   Period: ${vals.start_date} to ${vals.end_date}`, W/2, 19, {align:"center"});

    // Employee info box
    doc.setFillColor(26,29,39);
    doc.roundedRect(10,28,W-20,24,3,3,"F");
    doc.setTextColor(100,180,220); doc.setFontSize(11); doc.setFont("helvetica","bold");
    doc.text(result.employee_name||result.employee, 16, 37);
    doc.setTextColor(160,165,175); doc.setFontSize(8); doc.setFont("helvetica","normal");
    doc.text(`Employee ID: ${result.employee}`, 16, 44);
    doc.text(`Slip No: ${result.slip_name}`, 16, 49);
    doc.text(`Posting Date: ${vals.posting_date||today}`, W-14, 44, {align:"right"});
    doc.text(`Frequency: ${vals.payroll_frequency||""}`, W-14, 49, {align:"right"});

    // Earnings table
    const earnings = [
      ["Basic Salary (CTC)", fmt_num(result.ctc)],
    ];
    if (result.ot_amount > 0) {
      earnings.push(["Overtime Pay", fmt_num(result.ot_amount)]);
    }
    earnings.push(["", ""]);
    earnings.push([{ content:"GROSS PAY", styles:{fontStyle:"bold",textColor:[74,222,128]} },
                   { content:fmt_num(result.gross), styles:{fontStyle:"bold",textColor:[74,222,128]} }]);

    doc.autoTable({
      head:[["EARNINGS","AMOUNT"]],
      body: earnings,
      startY:58,
      margin:{left:10,right:W/2+2},
      styles:{fontSize:9,cellPadding:3},
      headStyles:{fillColor:[22,78,99],textColor:255,fontStyle:"bold",fontSize:8},
      alternateRowStyles:{fillColor:[26,29,39]},
      theme:"grid",
      tableWidth: W/2-14,
    });

    // Deductions table
    const deductions = [];
    if (result.adv_deduct > 0) {
      deductions.push(["Advance Deduction", fmt_num(result.adv_deduct)]);
    }
    deductions.push(["", ""]);
    deductions.push([{ content:"TOTAL DEDUCTIONS", styles:{fontStyle:"bold",textColor:[248,113,113]} },
                     { content:fmt_num(result.adv_deduct), styles:{fontStyle:"bold",textColor:[248,113,113]} }]);

    doc.autoTable({
      head:[["DEDUCTIONS","AMOUNT"]],
      body: deductions.length > 2 ? deductions : [["No deductions","0.00"]],
      startY:58,
      margin:{left:W/2+4,right:10},
      styles:{fontSize:9,cellPadding:3},
      headStyles:{fillColor:[127,29,29],textColor:255,fontStyle:"bold",fontSize:8},
      alternateRowStyles:{fillColor:[26,29,39]},
      theme:"grid",
      tableWidth: W/2-14,
    });

    // Net pay box
    const finalY = Math.max(doc.lastAutoTable.finalY, 58+40) + 8;
    doc.setFillColor(5,46,22);
    doc.roundedRect(10,finalY,W-20,16,3,3,"F");
    doc.setTextColor(74,222,128); doc.setFontSize(14); doc.setFont("helvetica","bold");
    doc.text("NET PAY", 18, finalY+10);
    doc.text(fmt_num(result.net), W-14, finalY+10, {align:"right"});

    // Status stamp
    doc.setFontSize(9); doc.setFont("helvetica","normal");
    doc.setTextColor(160,163,175);
    doc.text(
      vals.submit_slips ? "✓ Submitted" : "✓ Processed",
      W/2, finalY+22, {align:"center"}
    );

    // Footer
    const H = doc.internal.pageSize.getHeight();
    doc.setFontSize(7); doc.setTextColor(100,100,120);
    doc.text(`Generated: ${today}   |   ${vals.company||""}`, W/2, H-6, {align:"center"});

    doc.save(`payslip_${result.employee}_${vals.start_date}.pdf`);
    frappe.show_alert({message:"Payslip downloaded ✓",indicator:"green"},3);
  });
};

// ─── 14. SINGLE JOURNAL ENTRY ────────────────────────────────────────────────
async function bs_persist_payment_reference(employee_id, journal_name, payment_status = "Payment Created") {
  const frm = window._bs.frm;
  const row = window._bs.rows.find((item) => item.employee === employee_id);
  if (row) {
    row.payment_entry = journal_name || "";
    row.payment_status = payment_status || "Payment Created";
    if (!["Cancelled", "Failed"].includes(row.status || "")) {
      row.status = payment_status === "Paid" ? "Completed" : "Payment Created";
    }
  }
  const child = row ? bs_find_child_row(frm, row) : null;
  if (child) {
    child.payment_entry = journal_name || "";
    child.payment_status = payment_status || "Payment Created";
    if (!["Cancelled", "Failed"].includes(child.status || "")) {
      child.status = payment_status === "Paid" ? "Completed" : "Payment Created";
    }
  }
  if (frm) {
    bs_sync_to_frm(frm);
    await new Promise((resolve, reject) =>
      frm.save("Save", (r) => (r.exc ? reject(new Error(r.exc)) : resolve(r))),
    );
  }
}

window.bs_create_single_payment = function(employee_id) {
  const row = window._bs.rows.find((item) => item.employee === employee_id);
  const result = window._bs.results.find((r)=>r.employee===employee_id) || {
    employee: employee_id,
    employee_name: row?.employee_name || employee_id,
    slip_name: row?.salary_slip || "",
    net: parseFloat(row?.net || row?.net_pay || 0),
    payment_entry: row?.payment_entry || "",
  };
  const vals = window._bs.vals || {
    company: window._bs.frm?.doc?.company || frappe.defaults.get_default("company"),
    start_date: window._bs.frm?.doc?.start_date,
    end_date: window._bs.frm?.doc?.end_date,
  };
  if (!result || !result.slip_name) {
    frappe.show_alert({message:"No slip for this employee.",indicator:"red"},3); return;
  }
  const batch_row = row;
  if (batch_row && batch_row.salary_slip_status !== "Submitted") {
    frappe.show_alert({message:"Only submitted Salary Slips can be paid.",indicator:"orange"},4); return;
  }

  const pay_acc_ctrl = window._bs._pay_acc_ctrl;
  const pre_acct = pay_acc_ctrl ? pay_acc_ctrl.get_value() : "";

  const d = new frappe.ui.Dialog({
    title: `Payment — ${result.employee_name||result.employee}`,
    size: "small",
    fields:[
      { fieldtype:"HTML", fieldname:"info",
        options:`<div class="bs-notice bs-notice-info" style="margin-bottom:10px">
          Employee: <b>${result.employee_name}</b><br>
          Salary Slip: <b>${result.slip_name}</b><br>
          Net Pay: <b>${fmt_num(result.net)}</b>
        </div>` },
      { fieldtype:"Link", fieldname:"pay_from", options:"Account",
        label:"Pay From Account", reqd:1, default: pre_acct,
        get_query:()=>({ filters:[
          ["account_type","in",["Cash","Bank"]],
          ["company","=",vals.company||frappe.defaults.get_default("company")],
        ]}) },
      { fieldtype:"Currency", fieldname:"amount", label:"Amount",
        reqd:1, default: result.net },
      { fieldtype:"Date", fieldname:"payment_date", label:"Payment Date",
        reqd:1, default: frappe.datetime.get_today() },
      { fieldtype:"Data", fieldname:"reference_no", label:"Reference / Cheque No" },
    ],
    primary_action_label:"Create Journal Entry",
    async primary_action(v) {
      if (!v.pay_from) {
        frappe.show_alert({message:"Select a pay-from account.",indicator:"red"},4); return;
      }
      d.hide();
      try {
        const payable_account = await bs_get_salary_payable_account(result.slip_name, vals.company);
        const pay_from_meta = await bs_call("frappe.client.get_value", {
          doctype: "Account",
          filters: { name: v.pay_from },
          fieldname: ["account_type"],
        });
        const account_type = pay_from_meta.message?.account_type || "";
        const voucher_type = account_type === "Cash" ? "Cash Entry" : "Bank Entry";
        const pe = await bs_call("frappe.client.insert",{
          doc:{
            doctype: "Journal Entry",
            voucher_type,
            posting_date: v.payment_date,
            cheque_no: v.reference_no || "",
            cheque_date: v.payment_date,
            company: vals.company||frappe.defaults.get_default("company"),
            user_remark: `Salary payment for ${result.employee_name} — Slip ${result.slip_name}`,
            accounts: [
              {
                account: payable_account,
                party_type: "Employee",
                party: result.employee,
                reference_type: "Salary Slip",
                reference_name: result.slip_name,
                debit_in_account_currency: v.amount,
                credit_in_account_currency: 0,
              },
              {
                account: v.pay_from,
                debit_in_account_currency: 0,
                credit_in_account_currency: v.amount,
              },
            ],
          },
        });
        result.payment_entry = pe.message.name;
        const safe_id = employee_id.replace(/[^a-z0-9]/gi,"-");
        const btn = document.getElementById(`bs-pay-btn-${safe_id}`);
        if (btn) {
          btn.textContent = `✓ ${pe.message.name}`;
          btn.disabled = true;
          btn.style.color = "var(--bs-green)";
        }
        await bs_persist_payment_reference(employee_id, pe.message.name, "Payment Created");
        frappe.show_alert({message:`Journal Entry <b>${pe.message.name}</b> created ✓`,indicator:"green"},5);
      } catch(err) {
        frappe.msgprint({title:"Payment Error",message:err.message||String(err),indicator:"red"});
      }
    },
  });
  d.show();
};

// ─── 15. BULK PAYMENT ENTRY ───────────────────────────────────────────────────
async function bs_create_bulk_payment(success_results, pay_from_account, vals) {
  const notice = (msg,type="info") => bs_notice("bs-pay-notice",msg,type);
  notice("⏳ Creating bulk journal entry…");

  const eligible_results = success_results.filter((result) => {
    const row = window._bs.rows.find((item) => item.employee === result.employee);
    return row && row.salary_slip_status === "Submitted";
  });
  if (!eligible_results.length) {
    notice("⚠ Only submitted Salary Slips can be paid.", "warn");
    return;
  }

  const total_net = eligible_results.reduce((s,r)=>s+r.net,0);
  try {
    const pay_from_meta = await bs_call("frappe.client.get_value", {
      doctype: "Account",
      filters: { name: pay_from_account },
      fieldname: ["account_type"],
    });
    const account_type = pay_from_meta.message?.account_type || "";
    const voucher_type = account_type === "Cash" ? "Cash Entry" : "Bank Entry";
    const payable_accounts = await Promise.all(eligible_results.map((r) => bs_get_salary_payable_account(r.slip_name, vals.company)));
    const accounts = eligible_results.map((r, idx) => ({
      account: payable_accounts[idx],
      party_type: "Employee",
      party: r.employee,
      reference_type: "Salary Slip",
      reference_name: r.slip_name,
      debit_in_account_currency: r.net,
      credit_in_account_currency: 0,
    }));
    accounts.push({
      account: pay_from_account,
      debit_in_account_currency: 0,
      credit_in_account_currency: total_net,
    });
    const pe = await bs_call("frappe.client.insert",{
      doc:{
        doctype: "Journal Entry",
        voucher_type,
        posting_date: frappe.datetime.get_today(),
        cheque_date: frappe.datetime.get_today(),
        company: vals.company||frappe.defaults.get_default("company"),
        user_remark: `Bulk salary payment — Period: ${vals.start_date} to ${vals.end_date} — ${eligible_results.length} employees`,
        accounts,
      },
    });
    notice(`✓ Journal Entry <b>${pe.message.name}</b> created for ${fmt_num(total_net)}!`,"success");
    for (const result of eligible_results) {
      result.payment_entry = pe.message.name;
      await bs_persist_payment_reference(result.employee, pe.message.name, "Payment Created");
    }
  } catch(err) {
    notice(`❌ ${err.message||String(err)}`,"error");
  }
}

async function bs_get_salary_payable_account(slip_name, company) {
  const refs = await bs_call("frappe.client.get_list", {
    doctype: "GL Entry",
    filters: {
      voucher_type: "Salary Slip",
      voucher_no: slip_name,
      company: company || frappe.defaults.get_default("company"),
      is_cancelled: 0,
    },
    fields: ["account", "credit", "credit_in_account_currency"],
    order_by: "credit_in_account_currency desc, credit desc, creation asc",
    limit_page_length: 20,
  });
  const rows = refs.message || [];
  const payable = rows.find((row) => flt(row.credit_in_account_currency || row.credit) > 0);
  if (!payable?.account) {
    throw new Error(`Could not detect payable account from Salary Slip ${slip_name}.`);
  }
  return payable.account;
}

// ─── 16. SUMMARY PDF ──────────────────────────────────────────────────────────
function bs_download_pdf(results, vals, total_gross, total_ded, total_net, total_ot, success, failed) {
  const load = (src) => new Promise((res,rej)=>{
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s=document.createElement("script"); s.src=src;
    s.onload=res; s.onerror=rej; document.head.appendChild(s);
  });

  frappe.show_alert({message:"Preparing PDF…",indicator:"blue"},3);
  load("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
    .then(()=>load("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"))
    .then(()=>{
      const { jsPDF } = window.jspdf;
      const doc   = new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});
      const today = frappe.datetime.get_today();

      // Header
      doc.setFillColor(22,78,99); doc.rect(0,0,297,18,"F");
      doc.setTextColor(255,255,255);
      doc.setFontSize(13); doc.setFont("helvetica","bold");
      doc.text("Bulk Salary Creation — Summary Report", 12, 12);
      doc.setFontSize(8); doc.setFont("helvetica","normal");
      doc.text(`Period: ${vals.start_date} → ${vals.end_date}   |   Company: ${vals.company||"—"}   |   Generated: ${today}`,12,17.5);

      // Stat badges
      let bx=12; const by=24;
      const badge = (label,color_fill,color_text,color_border,w) => {
        doc.setFillColor(...color_fill); doc.setDrawColor(...color_border);
        doc.roundedRect(bx,by,w,8,2,2,"FD");
        doc.setTextColor(...color_text); doc.setFontSize(8); doc.setFont("helvetica","bold");
        doc.text(label, bx+4, by+5.5);
        bx+=w+4;
      };
      badge(`✓ ${success.length} Succeeded`,[220,252,231],[22,101,52],[187,247,208],52);
      if (failed.length) badge(`✕ ${failed.length} Failed`,[254,226,226],[127,29,29],[254,202,202],40);
      badge(`OT: ${fmt_num(total_ot)}`,[254,243,199],[146,64,14],[253,230,138],50);
      badge(`Gross: ${fmt_num(total_gross)}`,[219,234,254],[30,58,138],[191,219,254],56);
      badge(`Net: ${fmt_num(total_net)}`,[209,250,229],[6,78,59],[167,243,208],56);

      // Table
      doc.autoTable({
        head:[["Employee","Name","Salary Slip","CTC","Overtime","Gross","Adv.Deduct","Net Pay","Status"]],
        body: results.map((r)=>[
          r.employee,
          r.employee_name!==r.employee?r.employee_name:"",
          r.slip_name||"—",
          r.status==="Success"?fmt_num(r.ctc):"—",
          r.status==="Success"?fmt_num(r.ot_amount):"—",
          r.status==="Success"?fmt_num(r.gross):"—",
          r.status==="Success"?fmt_num(r.adv_deduct):"—",
          r.status==="Success"?fmt_num(r.net):"—",
          r.status==="Success"?(vals.submit_slips?"Submitted":"Processed"):"FAILED",
        ]),
        startY:36, margin:{left:10,right:10},
        styles:{fontSize:7.5,cellPadding:2.5,overflow:"linebreak"},
        headStyles:{fillColor:[22,78,99],textColor:255,fontStyle:"bold",fontSize:7},
        alternateRowStyles:{fillColor:[248,250,252]},
        columnStyles:{
          0:{cellWidth:24},1:{cellWidth:32},2:{cellWidth:32,fontSize:6.5},
          3:{halign:"right",cellWidth:24},4:{halign:"right",cellWidth:22},
          5:{halign:"right",cellWidth:24},6:{halign:"right",cellWidth:22},
          7:{halign:"right",cellWidth:24,fontStyle:"bold"},
          8:{halign:"center",cellWidth:20},
        },
        didParseCell(data){
          if (data.section==="body"&&data.column.index===8) {
            const ok = data.cell.raw==="Submitted"||data.cell.raw==="Processed";
            data.cell.styles.textColor = ok?[22,101,52]:[185,28,28];
            data.cell.styles.fontStyle = "bold";
          }
        },
      });

      const finalY = doc.lastAutoTable.finalY+5;
      doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.setTextColor(30,30,30);
      doc.text(`Totals — Gross: ${fmt_num(total_gross)}   OT: ${fmt_num(total_ot)}   Adv.Deduct: ${fmt_num(total_ded)}   Net: ${fmt_num(total_net)}`,12,finalY);

      const H=doc.internal.pageSize.getHeight();
      doc.setFontSize(7.5); doc.setFont("helvetica","normal"); doc.setTextColor(156,163,175);
      doc.text(`Bulk Salary Creation  |  ${today}`,285,H-6,{align:"right"});

      doc.save(`bulk_salary_${vals.start_date}_${vals.end_date}.pdf`);
      frappe.show_alert({message:"PDF downloaded ✓",indicator:"green"},3);
    })
    .catch((e)=>frappe.msgprint({title:"PDF Error",message:String(e),indicator:"red"}));
}

// ─── 17. SUBMITTED READ-ONLY VIEW ─────────────────────────────────────────────
function render_submitted_view(frm) {
  const $body = frm.layout.wrapper.find(".form-page");
  const rows  = frm.doc.employees||[];

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
        <span class="bs-status-badge bs-status-${["Failed","Cancelled"].includes(r.status)?"fail":"ok"}">
          ${r.status||"—"}
        </span>
      </td>
    </tr>`).join("");

  $body.find("#bs-main-wrap").remove();
  $body.prepend($(`
    <div id="bs-main-wrap"><div class="bs-wrap">
      <div class="bs-header-card">
        <div class="bs-header-icon" style="background:linear-gradient(135deg,#166534,#14532d)">✓</div>
        <div>
          <div class="bs-header-title">Bulk Salary Creation — Submitted</div>
          <div class="bs-header-sub">
            Company: <b>${frm.doc.company||"—"}</b>
            &nbsp;|&nbsp; Period: <b>${frm.doc.start_date||"—"}</b> → <b>${frm.doc.end_date||"—"}</b>
            &nbsp;|&nbsp; Frequency: <b>${frm.doc.payroll_frequency||"—"}</b>
          </div>
        </div>
      </div>
      <div class="bs-notice bs-notice-success bs-mb">
        Submitted. ${rows.length} salary slip(s) were created.
      </div>
      <div class="bs-footer-row bs-mb">
        ${frm.doc.accrual_journal_entry
          ? `<button class="bs-btn-secondary" onclick="bs_open_doc('Journal Entry','${frm.doc.accrual_journal_entry}')">Open Accrual JE</button>`
          : `<button class="bs-btn-secondary" onclick="bs_create_accrual_journal_entry()">🧾 Create Accrual JE</button>`}
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

// ─── 18. HELPERS ──────────────────────────────────────────────────────────────
function bs_call(method, args) {
  return new Promise((resolve, reject) => {
    frappe.call({
      method, args,
      callback: resolve,
      error:(e)=>reject(new Error(e&&e.message?e.message:JSON.stringify(e))),
    });
  });
}

function bs_notice(el_id, msg, type="info", timeout=4000) {
  const el = document.getElementById(el_id);
  if (!el) return;
  el.style.display = "";
  el.className = `bs-notice bs-notice-${type}`;
  el.innerHTML = msg;
  if (timeout) setTimeout(()=>(el.style.display="none"), timeout);
}

function fmt_num(n, dec=2) {
  return (parseFloat(n)||0).toLocaleString(undefined,
    {minimumFractionDigits:dec, maximumFractionDigits:dec});
}

function fmt_total(n) {
  return fmt_num(n, 0);
}

function bs_input_value(value) {
  const num = parseFloat(value || 0);
  return num ? String(num) : "";
}

function bs_component_input_value(item) {
  const amount = parseFloat(item?.amount || 0) || 0;
  return item?.auto_calculated ? String(Math.round(amount)) : bs_input_value(amount);
}

// ─── 19. STYLES ───────────────────────────────────────────────────────────────
function inject_bs_styles() {
  if (document.getElementById("bs-styles")) return;
  const s = document.createElement("style");
  s.id = "bs-styles";
  s.textContent = `
    :root {
      --bs-page:#f5f7fb;
      --bs-surface:#ffffff;
      --bs-surface-soft:#f8fafc;
      --bs-surface-strong:#eef4ff;
      --bs-border:#dbe4f0;
      --bs-border-strong:#c7d5e6;
      --bs-primary:#2563eb;
      --bs-primary-soft:#dbeafe;
      --bs-primary-deep:#1d4ed8;
      --bs-green:#15803d;
      --bs-green-dim:#dcfce7;
      --bs-amber:#b45309;
      --bs-amber-dim:#fef3c7;
      --bs-red:#b91c1c;
      --bs-red-dim:#fee2e2;
      --bs-muted:#64748b;
      --bs-text:#0f172a;
      --bs-cyan:#0f766e;
      --bs-radius:12px;
      --bs-shadow:0 10px 30px rgba(15,23,42,.06);
    }
    #bs-main-wrap{margin:0 0 32px}
    .bs-wrap{font-family:'Segoe UI',system-ui,sans-serif;color:var(--bs-text);padding:6px 14px 14px 4px;overflow:visible}
    .bs-opt{font-weight:400;text-transform:none;font-size:11px}

    /* Header */
    .bs-header-card{display:flex;align-items:center;justify-content:space-between;gap:16px;background:linear-gradient(135deg,#ffffff 0%,#f6f9ff 100%);border:1px solid var(--bs-border);border-radius:var(--bs-radius);padding:14px 18px;margin-bottom:14px;box-shadow:var(--bs-shadow)}
    .bs-header-main{display:flex;align-items:center;gap:14px;min-width:0}
    .bs-header-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
    .bs-header-meta{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .bs-head-pill{display:inline-flex;align-items:center;min-height:28px;padding:4px 10px;border:1px solid #dbe4f0;border-radius:999px;background:#fff;color:#475569;font-size:11px;font-weight:700;white-space:nowrap}
    .bs-header-icon{background:linear-gradient(135deg,#2563eb,#0f766e);border:none;color:#fff;font-weight:800;font-size:13px;border-radius:10px;min-width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 10px 22px rgba(37,99,235,.18)}
    .bs-header-title{font-size:16px;font-weight:700;color:var(--bs-text);margin-bottom:3px}
    .bs-header-sub{font-size:12.5px;color:var(--bs-muted);line-height:1.5}
    .bs-header-period-bar{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
    .bs-filters-area.is-hidden{display:none}
    .bs-filter-panel-title{font-size:12px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#475569;margin-bottom:8px}

    /* Layout */
    .bs-section-label{font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#475569;margin-bottom:8px}
    .bs-collapsible{overflow:hidden;transition:all .18s ease}
    .bs-collapsible.is-collapsed{display:none}
    .bs-mb{margin-bottom:10px}
    .bs-panel{overflow:visible;background:var(--bs-surface);border:1px solid var(--bs-border);border-radius:10px;padding:5px 6px;box-shadow:var(--bs-shadow)}
    .bs-panel-soft{background:linear-gradient(180deg,#fcfdff 0%,#f6faff 100%)}
    .bs-head-inline-label{display:inline-flex;align-items:center;padding:0 8px;height:24px;border:1px solid var(--bs-border);border-radius:6px;background:#f8fafc;color:#64748b;font-size:10px;font-weight:700}
    .bs-qa-row{display:grid;grid-template-columns:minmax(145px,1fr) minmax(145px,1fr) minmax(135px,1fr) minmax(135px,1fr) 86px minmax(150px,.92fr) 86px;gap:3px;align-items:end}
    .bs-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .bs-source-grid{display:flex;flex-direction:column;gap:3px}
    .bs-source-row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:3px;align-items:end}
    .bs-piece-filter-check{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border:1px solid var(--bs-border);border-radius:6px;background:#fff;color:#475569;font-size:10px;font-weight:700}
    .bs-piece-filter-check input{width:14px;height:14px;margin:0}
    .bs-filter-panel-title{margin-bottom:4px}
    .bs-filter-btn-wrap{display:flex;align-items:flex-end}
    .bs-filter-btn-stack{align-items:flex-start}
    .bs-field-with-top-action{display:flex;flex-direction:column;gap:2px}
    .bs-top-action-wrap{display:flex;justify-content:flex-start}
    .bs-filter-action-btn{min-width:86px;height:28px}
    .bs-employee-picker{min-width:150px}
    .bs-search-filter-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 8px}
    .bs-search-row{flex:1;min-width:280px;margin:0}
    .bs-search-input{width:100%;max-width:640px;background:#fff;border:1px solid var(--bs-border-strong);color:var(--bs-text);border-radius:8px;padding:8px 12px;font-size:12px;box-shadow:none}
    .bs-search-input:focus{outline:none;border-color:#a78bfa;box-shadow:0 0 0 3px rgba(167,139,250,.15)}
    .bs-source-metrics{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
    .bs-source-inline{display:flex;flex-wrap:wrap;gap:3px 5px;margin-top:3px;font-size:9.5px;color:#64748b;line-height:1.2}
    .bs-source-inline span{display:inline-flex;align-items:center;padding:0 5px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0}
    .bs-source-inline-top span{background:#f5f3ff;border-color:#ddd6fe;color:#6d28d9;font-weight:700}
    .bs-source-inline-plain span{background:#fff;border-color:#dbe4f0;color:#64748b}
    .bs-source-inline-adjust span{background:#fffbeb;border-color:#fde68a;color:#92400e}
    .bs-source-inline-formula span{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;font-weight:700}
    .bs-source-inline-tight{margin-top:2px}
    .bs-source-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:700;border:1px solid transparent;line-height:1.5}
    .bs-source-chip-slate{background:#f1f5f9;color:#334155;border-color:#cbd5e1}
    .bs-source-chip-purple{background:#f3e8ff;color:#7c3aed;border-color:#d8b4fe}
    .bs-source-chip-blue{background:#dbeafe;color:#1d4ed8;border-color:#93c5fd}
    .bs-source-chip-green{background:#dcfce7;color:#166534;border-color:#86efac}
    .bs-source-chip-red{background:#fee2e2;color:#b91c1c;border-color:#fca5a5}
    .bs-source-chip-emerald{background:#d1fae5;color:#047857;border-color:#6ee7b7}
    .bs-source-chip-cyan{background:#cffafe;color:#155e75;border-color:#67e8f9}
    .bs-source-chip-violet{background:#ede9fe;color:#5b21b6;border-color:#c4b5fd}
    .bs-source-chip-amber{background:#fef3c7;color:#b45309;border-color:#fcd34d}
    .bs-filter-bar{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin:0}
    .bs-filter-btn{background:#fff;border:1px solid #ddd6fe;color:#6d28d9;border-radius:999px;padding:4px 10px;font-size:10.5px;font-weight:700;cursor:pointer;transition:all .15s}
    .bs-filter-btn:hover{background:#f5f3ff;border-color:#c4b5fd;color:#5b21b6}
    .bs-filter-btn.is-active{background:#ede9fe;border-color:#a78bfa;color:#5b21b6}
    .bs-field-wrap{display:flex;flex-direction:column;gap:1px}
    .bs-floating-field{position:relative;min-height:28px}
    .bs-field-caption{display:none}
    .bs-label{font-size:11.5px;font-weight:700;color:#475569;user-select:none}
    .bs-select-full{width:100%}
    .bs-source-note-hidden,.bs-config-note{display:none!important}
    #bs-fetch-notice,#bs-add-notice{margin:0;padding:0;min-height:0;border:none;background:transparent}

    /* Buttons */
    .bs-btn-primary{height:26px;padding:0 12px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:1px solid #1d4ed8;border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;box-shadow:0 8px 18px rgba(37,99,235,.16)}
    .bs-btn-primary:hover{background:linear-gradient(135deg,#1d4ed8,#1e40af);border-color:#1e40af}
    .bs-btn-primary.bs-btn-lg{height:38px;padding:0 24px;font-size:14px}
    .bs-btn-secondary{height:26px;padding:0 10px;background:#fff;color:var(--bs-text);border:1px solid var(--bs-border-strong);border-radius:6px;font-size:10.5px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s}
    .bs-btn-secondary:hover{background:#f8fbff;border-color:#94a3b8}
    .bs-btn-ghost{background:#fff;border:1px solid var(--bs-border);color:#475569;border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;transition:all .15s}
    .bs-btn-ghost:hover{border-color:#93c5fd;color:var(--bs-primary-deep);background:#eff6ff}
    .bs-btn-ghost.bs-btn-sm{padding:2px 8px;font-size:11px}
    .bs-btn-remove{background:#fff;border:1px solid #fecaca;color:var(--bs-red);border-radius:6px;width:26px;height:26px;font-size:11px;cursor:pointer;transition:background .15s}
    .bs-btn-remove:hover{background:var(--bs-red-dim)}
    .bs-btn-remove-inline{background:#fff;border:1px solid #fecaca;color:var(--bs-red);border-radius:999px;padding:1px 8px;font-size:10px;font-weight:700;cursor:pointer}
    .bs-btn-remove-inline:hover{background:var(--bs-red-dim)}
    .bs-action-bar{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--bs-border)}

    /* Notices */
    .bs-notice{border-radius:6px;padding:8px 12px;font-size:12.5px;line-height:1.5;margin-top:10px}
    .bs-notice-warn{background:var(--bs-amber-dim);border:1px solid #fcd34d;color:var(--bs-amber)}
    .bs-notice-success{background:var(--bs-green-dim);border:1px solid #86efac;color:var(--bs-green)}
    .bs-notice-info{background:var(--bs-primary-soft);border:1px solid #bfdbfe;color:var(--bs-primary-deep)}
    .bs-notice-error{background:var(--bs-red-dim);border:1px solid #fca5a5;color:var(--bs-red)}

    /* Table */
    .bs-table-wrap{border:1px solid var(--bs-border);border-radius:var(--bs-radius);overflow:hidden;overflow-y:auto;margin-bottom:4px;background:var(--bs-surface);box-shadow:var(--bs-shadow)}
    .bs-table{width:100%;border-collapse:collapse;font-size:14px}
    .bs-th{background:linear-gradient(180deg,#f8fbff 0%,#eef4ff 100%);padding:11px 12px;text-align:left;font-size:11.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#475569;border-bottom:1px solid var(--bs-border)}
    .bs-td{padding:8px 10px;border-bottom:1px solid #e9eef5;vertical-align:middle;background:#fff}
    .bs-row:last-child .bs-td{border-bottom:none}
    .bs-row:nth-child(even) .bs-td{background:#fbfdff}
    .bs-row:hover .bs-td{background:#f0f7ff}
    .bs-row-detail .bs-td-detail{padding:0 10px 1px;border-bottom:1px solid #e9eef5;background:#f8fafc}
    .bs-row-detail-adjust .bs-td-detail{padding:0 10px 2px;background:linear-gradient(180deg,#fff7d6 0%,#ffeeba 100%);border-top:1px solid #fde68a;border-bottom:1px solid #fcd34d}
    .bs-row-detail-adjust:nth-of-type(3n) .bs-td-detail{background:linear-gradient(180deg,#eef6ff 0%,#dbeafe 100%);border-top:1px solid #bfdbfe;border-bottom:1px solid #93c5fd}
    .bs-row-detail-wrap{display:flex;flex-wrap:wrap;gap:2px 5px;align-items:center}
    .bs-td-emp{min-width:160px}
    .bs-emp-code{font-weight:700;color:var(--bs-primary-deep);font-size:15px}
    .bs-emp-name{font-size:12px;color:var(--bs-muted);margin-top:1px}
    .bs-ctc-val{font-weight:700;color:var(--bs-text);font-size:15px}
    .bs-structure-line{font-size:12px;font-weight:700;color:var(--bs-cyan);line-height:1.4}
    .bs-structure-meta{font-size:10px;line-height:1.2}
    .bs-structure-warning{margin-top:4px;padding:3px 8px;border-radius:999px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:10px;font-weight:700;display:inline-flex}
    .bs-status-stack{display:flex;flex-direction:column;gap:4px;margin-top:4px}
    .bs-status-sub{font-size:10px;color:var(--bs-muted)}
    .bs-row-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
    .bs-row-actions-compact{margin-top:4px}
    .bs-adjust-grid{display:grid;grid-template-columns:repeat(2,minmax(74px,1fr));gap:4px 8px}
    .bs-adjust-row-wrap{display:flex;flex-direction:column;gap:0;width:100%;margin:0}
    .bs-adjust-line{display:flex;align-items:center;gap:0;flex-wrap:wrap;width:100%;margin:0}
    .bs-adjust-line-title{display:inline-flex;align-items:center;justify-content:center;min-width:64px;width:64px;height:18px;padding:0 5px;border-radius:2px;font-size:8px;font-weight:800}
    .bs-adjust-line-title-earning{background:#ecfdf5;border:1px solid #bbf7d0;color:#166534}
    .bs-adjust-line-title-deduction{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c}
    .bs-adjust-line-items{display:flex;flex-wrap:wrap;gap:1px;flex:1}
    .bs-adjust-chip{display:inline-flex;align-items:center;padding:0;border:1px solid transparent;background:transparent;min-height:18px;border-radius:2px;margin:0}
    .bs-adjust-chip-earning{background:#f3fcf6;border-color:#b7ebca}
    .bs-adjust-chip-deduction{background:#fff5f5;border-color:#fecaca}
    .bs-adjust-chip-earning .bs-adjust-chip-label,.bs-adjust-chip-earning .bs-adjust-input{color:#166534}
    .bs-adjust-chip-deduction .bs-adjust-chip-label,.bs-adjust-chip-deduction .bs-adjust-input{color:#b91c1c}
    .bs-adjust-input-auto{cursor:default;opacity:.95;font-weight:400}
    .bs-adjust-summary{display:flex;flex-direction:column;gap:4px}
    .bs-adjust-summary-chip{display:inline-flex;align-items:center;justify-content:center;padding:1px 6px;border-radius:6px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:10px;font-weight:700}
    .bs-adjust-summary-empty{font-size:11px;color:var(--bs-muted)}

    /* OT inputs */
    .bs-td-overtime{vertical-align:top}
    .bs-ot-row{display:flex;gap:3px;align-items:center;flex-wrap:nowrap}
    .bs-piece-stack{display:flex;flex-direction:column;gap:2px;align-items:flex-start}
    .bs-piece-line{display:grid;grid-template-columns:16px 54px 54px 54px;gap:3px;align-items:center}
    .bs-piece-check{width:14px;height:14px;margin:0 2px 0 0}
    .bs-piece-input{width:54px}
    .bs-piece-readonly{background:#f8fafc;color:#64748b;border-color:#dbe4f0}
    .bs-piece-total{width:54px;background:#fffdf6;color:#b45309;border-color:#fdba74}
    .bs-ot-amount-row{margin-top:1px;padding-left:19px}
    .bs-ot-amount{display:inline-flex;align-items:center;white-space:nowrap;font-size:9px;font-weight:700;color:var(--bs-amber);background:#fffaf2;border:1px solid #fdba74;border-radius:3px;padding:0 6px;min-height:18px}
    .bs-piece-total-pill{background:#fffaf2;border-color:#fdba74;width:168px;min-width:168px;justify-content:center;margin-left:0}
    .bs-select-sm{background:#fff;border:1px solid var(--bs-border-strong);color:var(--bs-text);border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer;min-height:28px}
    .bs-date-sm{min-width:132px}
    .bs-floating-field .form-control{min-height:28px;height:28px;padding:3px 8px;border-radius:4px;font-size:12px}
    .bs-floating-field .control-input-wrapper input{min-height:28px;height:28px;padding:3px 8px;border-radius:4px;font-size:12px}
    .bs-floating-field .awesomplete input{min-height:28px;height:28px;padding:3px 8px;border-radius:4px;font-size:12px}
    .bs-input-sm{background:#fff;border:1px solid var(--bs-border-strong);color:var(--bs-text);border-radius:2px;padding:1px 5px;font-size:11px;width:56px;min-height:22px;height:22px}
    .bs-adjust-input{width:116px;height:18px;border-radius:2px;padding:0 5px;text-align:left;background:transparent;font-weight:400}
    .bs-adjust-input::placeholder{color:currentColor;opacity:.85;font-size:9px}
    .bs-input-sm[type=number]::-webkit-outer-spin-button,.bs-input-sm[type=number]::-webkit-inner-spin-button,.bs-adv-input[type=number]::-webkit-outer-spin-button,.bs-adv-input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
    .bs-input-sm[type=number],.bs-adv-input[type=number]{-moz-appearance:textfield;appearance:textfield}
    .bs-input-sm:focus,.bs-select-sm:focus{outline:none;border-color:#93c5fd;box-shadow:0 0 0 3px rgba(59,130,246,.12)}
    .bs-money-main{font-size:15px;font-weight:800;line-height:1.1}
    .bs-money-gross{color:var(--bs-cyan)}
    .bs-money-net{color:var(--bs-green)}
    .bs-money-sub{font-size:9.5px;color:var(--bs-muted);margin-top:2px}

    /* Advances */
    .bs-adv-wrap{display:flex;flex-direction:column;gap:4px;align-items:flex-start;width:100%}
    .bs-adv-row{display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:2px}
    .bs-adv-stack{display:flex;flex-direction:column;align-items:flex-start;gap:1px}
    .bs-adv-id{font-size:11px;font-family:monospace;color:var(--bs-primary-deep);min-width:80px}
    .bs-adv-bal{font-size:11px;color:var(--bs-muted);min-width:86px;text-align:left}
    .bs-adv-input{background:#fff;border:1px solid var(--bs-border-strong);color:var(--bs-text);border-radius:6px;padding:3px 7px;font-size:12px}
    .bs-adv-input:focus{outline:none;border-color:#fbbf24;box-shadow:0 0 0 3px rgba(251,191,36,.14)}
    .bs-adv-total{font-size:11px;color:var(--bs-muted);padding-top:1px;text-align:left}

    /* Badges & pills */
    .bs-pill{background:var(--bs-primary-soft);color:var(--bs-primary-deep);border:1px solid #bfdbfe;border-radius:999px;padding:3px 10px;font-size:11.5px;font-weight:700}
    .bs-total-badge{background:#eff6ff;border:1px solid #bfdbfe;color:var(--bs-primary-deep);border-radius:999px;padding:5px 14px;font-size:13px;font-weight:700}
    .bs-status-badge{border-radius:5px;padding:2px 8px;font-size:11.5px;font-weight:700}
    .bs-status-ok{background:var(--bs-green-dim);color:var(--bs-green)}
    .bs-status-fail{background:var(--bs-red-dim);color:var(--bs-red)}
    .bs-mono{font-family:'Consolas',monospace;font-size:12px;color:var(--bs-primary-deep)}

    /* Footer */
    .bs-footer-row{display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px}
    .bs-footer-hint{font-size:12px;color:var(--bs-muted)}
    .bs-empty{padding:32px;text-align:center;color:var(--bs-muted);font-size:13px;background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%)}

    /* Progress */
    .bs-progress-wrap{margin:20px 0}
    .bs-progress-bar-bg{background:#e2e8f0;border:1px solid var(--bs-border);border-radius:999px;height:10px;overflow:hidden;margin-bottom:8px}
    .bs-progress-bar{height:100%;background:linear-gradient(90deg,#2563eb,#0f766e);border-radius:999px;transition:width .3s ease}
    .bs-prog-label{font-size:12px;color:var(--bs-muted);text-align:right}

    /* Log */
    .bs-log{background:#fcfdff;border:1px solid var(--bs-border);border-radius:var(--bs-radius);padding:10px 14px;max-height:260px;overflow-y:auto;font-size:12px;font-family:'Consolas','Courier New',monospace;box-shadow:inset 0 1px 0 rgba(255,255,255,.8)}
    .bs-log-row{padding:3px 0;border-bottom:1px solid #e2e8f0;line-height:1.5}
    .bs-log-row:last-child{border-bottom:none}
    .bs-log-success{color:var(--bs-green)}.bs-log-error{color:var(--bs-red)}.bs-log-info{color:#93c5fd}
    .bs-log-emp{font-weight:700;color:var(--bs-amber)}

    /* Summary */
    .bs-summary-totals{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
    .bs-live-summary{margin-top:14px}
    .bs-total-card{flex:1;min-width:100px;background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);border:1px solid var(--bs-border);border-radius:10px;padding:10px 14px;box-shadow:var(--bs-shadow)}
    .bs-total-label{font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
    .bs-total-value{font-size:17px;font-weight:700;color:var(--bs-text)}
    .bs-live-summary .bs-total-card:nth-child(1) .bs-total-value{color:var(--bs-primary-deep)}
    .bs-live-summary .bs-total-card:nth-child(2) .bs-total-value{color:var(--bs-cyan)}
    .bs-live-summary .bs-total-card:nth-child(3) .bs-total-value{color:var(--bs-red)}
    .bs-live-summary .bs-total-card:nth-child(4) .bs-total-value{color:var(--bs-green)}
    .bs-live-summary .bs-total-card:nth-child(5) .bs-total-value{color:var(--bs-primary)}
    .bs-live-summary .bs-total-card:nth-child(6) .bs-total-value{color:var(--bs-amber)}

    /* Payment bar */
    .bs-payment-bar{background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);border:1px solid var(--bs-border);border-radius:var(--bs-radius);padding:14px 18px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-top:6px;box-shadow:var(--bs-shadow)}
    @media (max-width: 1280px){.bs-qa-row{grid-template-columns:repeat(3,minmax(0,1fr))}.bs-source-row{grid-template-columns:repeat(3,minmax(0,1fr))}.bs-header-card{align-items:flex-start;flex-direction:column}.bs-header-tools{width:100%;justify-content:space-between}.bs-header-period-bar{width:100%}.bs-piece-total-pill{width:168px;min-width:168px}}
    @media (max-width: 900px){.bs-qa-row,.bs-source-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width: 768px){.bs-source-row,.bs-qa-row{grid-template-columns:repeat(1,minmax(0,1fr))}}
  `;
  document.head.appendChild(s);
}


// style patch marker
