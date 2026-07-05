// Payroll Bulk — batch processing, salary slip creation
// ─── 9. SAVE DRAFT ────────────────────────────────────────────────────────────
async function bs_ensure_source_loaded_for_period(frm) {
  if (!frm || !bs_is_source_driven_mode(frm) || !(window._bs.rows || []).length) return;
  bs_sync_period_from_header(frm);
  const current_key = bs_period_key(frm.doc.start_date, frm.doc.end_date);
  if (window._bs.loaded_source_period !== current_key) {
    await bs_trigger_source_reload({ force: true });
  }
}

async function bs_save_draft() {
  if (!window._bs.rows.length) {
    frappe.show_alert({ message:"Add at least one employee first.", indicator:"orange" }, 4);
    return;
  }
  const frm = window._bs.frm;
  bs_sync_period_from_header(frm);
  if (typeof bs_sync_source_doc === "function") {
    await bs_sync_source_doc(frm);
  }
  await bs_ensure_source_loaded_for_period(frm);
  bs_sync_to_frm(frm);
  try {
    await new Promise((res, rej) =>
      window._bs.frm.save("Save", (r) => r.exc ? rej(new Error(r.exc)) : res(r))
    );
    await frm.reload_doc();
    if (typeof bs_apply_source_metrics_from_doc === "function") {
      bs_apply_source_metrics_from_doc(frm);
    }
    (window._bs.rows || []).forEach((row) => {
      if (typeof bs_capture_row_saved_components === "function") {
        bs_capture_row_saved_components(row);
      }
    });
    bs_render_table();
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
  const source_values = bs_collect_source_values(frm);
  Object.assign(frm.doc, source_values);

  frm.doc.use_hours = window._bs.global_piece_flags?.use_hours ?? frm.doc.use_hours ?? 1;
  frm.doc.use_qty = window._bs.global_piece_flags?.use_qty ?? frm.doc.use_qty ?? 1;
  frm.doc.overtime_with_salary = window._bs.global_piece_flags?.overtime_with_salary ?? frm.doc.overtime_with_salary ?? 0;

  const existing_by_name = {};
  (frm.doc.employees || []).forEach((child) => {
    if (child.name) existing_by_name[child.name] = child;
  });

  const next_employees = [];
  frappe.model.clear_table(frm.doc, "component_entries");

  window._bs.rows.forEach((row) => {
    if (!row.employee) return;
    let c = row.row_name && existing_by_name[row.row_name] ? existing_by_name[row.row_name] : null;
    if (!c) {
      c = frappe.model.add_child(frm.doc, "Bulk Salary Creation Employee", "employees");
    }
    row.row_name = c.name;
    c.employee        = row.employee;
    c.employee_name   = row.employee_name;
    c.department      = row.department;
    c.designation     = row.designation;
    c.ctc             = bs_round_money(row.ctc);
    c.ot_type         = "Hours";
    c.ot_input        = row.ot_input;
    c.ot_amount       = bs_round_money(row.ot_amount);
    c.piece_basis     = row.piece_basis || frm.doc.per_piece_basis || "Total Hours";
    c.source_hours    = row.source_hours || 0;
    c.source_qty      = row.source_qty || 0;
    c.piece_rate      = row.piece_rate || 0;
    c.use_hours       = row.use_hours ? 1 : 0;
    c.use_qty         = row.use_qty ? 1 : 0;
    c.attendance_days = row.attendance_days || 0;
    c.absent_days     = row.absent_days || 0;
    c.attendance_hours = row.attendance_hours || 0;
    c.payment_days    = Math.round(row.payment_days || 0) || (window._bs.frm?.doc?.calculation_mode === "Manual" ? 30 : 0);
    c.worked_hours    = row.worked_hours || 0;
    c.shift_hours     = row.shift_hours || 0;
    c.overtime_hours  = row.overtime_hours || 0;
    c.bonus_amount    = bs_round_money(row.bonus_amount || 0);
    c.other_allowance = bs_round_money(row.other_allowance || 0);
    c.total_additions = bs_round_money(row.total_additions || 0);
    c.advance_balance = bs_round_money(row.advance_balance || 0);
    c.adv_deduct      = bs_round_money(row.adv_deduct);
    c.late_deduction  = bs_round_money(row.late_deduction || 0);
    c.other_deduction = bs_round_money(row.other_deduction || 0);
    c.total_deductions = bs_round_money(row.total_deductions || 0);
    c.gross_pay       = bs_round_money(row.gross);
    c.net_pay         = bs_round_money(row.net);
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
        component_row.amount = bs_round_money(parseFloat(item.amount || 0) || 0);
      });
    if (typeof bs_capture_row_saved_components === "function") {
      bs_capture_row_saved_components(row);
    }
    next_employees.push(c);
  });

  frm.doc.employees = next_employees;
  bs_update_parent_summary(frm);
  frm.refresh_field("employees");
  frm.refresh_field("component_entries");
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
  else if (rows.some((r) => r.salary_slip && (r.salary_slip_status || "") === "Draft")) {
    frm.doc.processing_status = "Partially Processed";
  } else if (submitted || success) frm.doc.processing_status = "Completed";
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
  const company = $("#bs-company-wrap input").val() || frm.doc.company || frappe.defaults.get_default("company");
  const batch_start = frm.doc.start_date || "";
  const batch_end = frm.doc.end_date || "";
  const batch_posting = frm.doc.posting_date || batch_end || batch_start || "";
  const batch_frequency = frm.doc.payroll_frequency || "Monthly";
  const has_existing_slips = (frm.doc.employees || []).some((r) => r.salary_slip);
  const has_submitted_slips = (frm.doc.employees || []).some((r) => r.salary_slip_status === "Submitted");

  const d = new frappe.ui.Dialog({
    title: "Create Draft Salary Slips",
    size:  "large",
    fields: [
      { fieldtype:"HTML", fieldname:"info",
        options:`<div class="bs-notice bs-notice-info" style="margin-bottom:12px">
          Creates <b>draft</b> salary slips only — use <b>Submit Drafts</b> later when amounts are verified.<br>
          Employees: <b>${window._bs.rows.length}</b> · Estimated net: <b>${fmt_num(window._bs.rows.reduce((s,r)=>s+r.net,0))}</b><br>
          Period (from saved batch): <b>${batch_start || "—"}</b> → <b>${batch_end || "—"}</b>
          ${batch_posting ? ` · Posting <b>${batch_posting}</b>` : ""}<br>
          <span style="font-size:11px;color:#64748b">Dates are not changed during slip creation.</span>
        </div>
        ${has_submitted_slips ? `<div class="bs-notice bs-notice-warn" style="margin-bottom:12px">Submitted slips already exist. Enable <b>Cancel and Recreate</b> below to replace them with new drafts.</div>` : ""}` },
      { fieldtype:"Link", fieldname:"company", options:"Company",
        label:"Company", reqd:1, default:company },
      { fieldtype:"Check", fieldname:"replace_existing_slips",
        label:"Cancel and Recreate Existing Slips",
        description:"Required when submitted slips exist and you need new draft slips with updated amounts.",
        default: has_submitted_slips || has_existing_slips ? 1 : 0 },
      { fieldtype:"Check", fieldname:"create_missing_only",
        label:"Create Missing Slips Only", default: config.create_missing_only ? 1 : 0 },
    ],
    primary_action_label: config.create_missing_only ? "Create Missing Draft Slips" : "Create Draft Slips",
    primary_action(vals) {
      if (!batch_start || !batch_end) {
        frappe.show_alert({ message:"Save the batch with start and end dates first.", indicator:"red" }, 4); return;
      }
      if (batch_start > batch_end) {
        frappe.show_alert({ message:"Batch start date cannot be after end date.", indicator:"red" }, 4); return;
      }
      vals.advance_deduction_component = "Advance Deduction";
      vals.submit_slips = 0;
      vals.payroll_frequency = batch_frequency;
      vals.start_date = batch_start;
      vals.end_date = batch_end;
      vals.posting_date = batch_posting;
      d.hide();
      process_bulk(frm, vals);
    },
  });

  d.show();
  setTimeout(() => {
    try {
      d.$wrapper.find(".modal-body").css({ "min-height": "180px", overflow: "visible" });
    } catch (error) {
      console.warn("Payroll dialog setup failed:", error);
    }
  }, 100);
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
        if (typeof bs_apply_saved_component_map === "function") {
          bs_apply_saved_component_map(row);
        }
        recalc_row(row);
      }
    } catch (error) {
      row.salary_structure = "";
      row.salary_structure_assignment = "";
      row.payroll_payable_account = "";
      row.structure_base = 0;
      row.structure_warning = error.message || "Salary Structure Assignment not found";
      if (should_load_components) {
        bs_build_row_components(row, null, { include_structure: false });
        if (typeof bs_apply_saved_component_map === "function") {
          bs_apply_saved_component_map(row);
        }
        recalc_row(row);
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
      ref_doctype: "Bulk Salary Creation",
      ref_docname: batch_name,
      docstatus: ["<", 2],
    },
    fields: ["name", "docstatus"],
    limit_page_length: 50,
  });

  for (const row of (res.message || [])) {
    if (row.docstatus === 1) {
      await bs_call("frappe.client.cancel", { doctype: "Additional Salary", name: row.name });
    } else if (row.docstatus === 0) {
      await bs_call("frappe.client.delete", { doctype: "Additional Salary", name: row.name });
    }
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
  const structure_doc = bs_get_cached_structure_doc(row.salary_structure || "");
  const merge_piece_qty = bs_is_piece_mode(mode) && bs_should_merge_piece_qty_into_hours(structure_doc);

  if (bs_is_piece_mode(mode) && (hour_amount > 0 || (merge_piece_qty && qty_amount > 0))) {
    const hour_component = await bs_resolve_special_component(row, vals, "hours");
    await bs_make_additional_salary({
      employee: row.employee,
      company: vals.company,
      component: hour_component,
      type: "Earning",
      amount: merge_piece_qty ? (hour_amount + qty_amount) : hour_amount,
      payroll_date: vals.posting_date,
      start_date: vals.start_date,
      end_date: vals.end_date,
      ref_doctype: "Bulk Salary Creation",
      ref_docname: batch_name,
    });
  }

  if (bs_is_piece_mode(mode) && qty_amount > 0 && !merge_piece_qty) {
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
    if (!item.component || amount <= 0 || item.auto_calculated) continue;
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

async function bs_existing_salary_slip(row, vals, frm) {
  if (!row.row_name || !frm?.doc?.name) {
    const res = await bs_call("frappe.client.get_list", {
      doctype: "Salary Slip",
      filters: {
        employee: row.employee,
        company: vals.company,
        start_date: vals.start_date,
        end_date: vals.end_date,
        docstatus: ["<", 2],
      },
      fields: ["name", "bulk_salary_creation"],
      limit_page_length: 1,
    });
    const slip = (res.message || [])[0];
    if (!slip) return { name: "", foreign_batch: false, batch_name: "" };
    const foreign = slip.bulk_salary_creation && slip.bulk_salary_creation !== frm.doc.name;
    return { name: slip.name, foreign_batch: !!foreign, batch_name: slip.bulk_salary_creation || "" };
  }

  const res = await bs_call("payroll_bulk.api.resolve_existing_salary_slip_for_row", {
    batch_name: frm.doc.name,
    row_name: row.row_name,
    company: vals.company,
    start_date: vals.start_date,
    end_date: vals.end_date,
  });
  const msg = res.message || res || {};
  return {
    name: msg.name || "",
    foreign_batch: !!msg.foreign_batch,
    batch_name: msg.batch_name || "",
    docstatus: msg.docstatus,
  };
}

function bs_finish_slip_process(pw, results, frm) {
  const success = results.filter((r) => r.status !== "Failed" && !!r.slip_name);
  const failed = results.filter((r) => r.status === "Failed");
  const indicator = failed.length ? (success.length ? "warn" : "error") : "success";
  const failed_html = failed.length
    ? `<br><span style="font-size:12px">${failed.map((r) => `<b>${r.employee}</b>: ${frappe.utils.escape_html(r.error || "Failed")}`).join("<br>")}</span>`
    : "";
  pw.set_title(failed.length ? (success.length ? "Completed with errors" : "Processing failed") : "Salary slips created");
  pw.set_subtitle(`${success.length} succeeded${failed.length ? ` · ${failed.length} failed` : ""}`);
  pw.log(failed.length ? "Processing finished with errors." : "All salary slips processed successfully ✓", failed.length ? "error" : "success");
  pw.complete({
    indicator,
    html: `<div class="bs-notice bs-notice-${indicator === "success" ? "info" : indicator === "warn" ? "warn" : "error"}">
      <b style="color:var(--bs-green)">${success.length} succeeded</b>
      ${failed.length ? `&nbsp;·&nbsp;<b style="color:var(--bs-red)">${failed.length} failed</b>${failed_html}` : ""}
    </div>`,
    button_label: "View Batch Report",
  });
  pw.on_done(() => bs_show_batch_report_view(frm));
}

async function process_bulk_in_background(frm, vals, rows, pw, batch_snapshot, fail_and_restore) {
  const log = pw.log;
  const set_prog = pw.set_prog;
  const threshold = window.BS_BACKGROUND_ROW_THRESHOLD || 20;
  log(`Large batch (${rows.length} ≥ ${threshold}) — queued for server processing…`, "info");
  const row_names = rows.map((row) => row.row_name).filter(Boolean);
  if (!row_names.length) {
    await fail_and_restore("Employee rows are not saved yet. Save failed or rows are missing row IDs.");
    return;
  }

  const enqueue = await bs_call("payroll_bulk.api.enqueue_bulk_salary_batch", {
    batch_name: frm.doc.name,
    options: JSON.stringify({
      company: vals.company,
      payroll_frequency: vals.payroll_frequency,
      start_date: vals.start_date,
      end_date: vals.end_date,
      posting_date: vals.posting_date,
      submit_slips: vals.submit_slips ? 1 : 0,
      replace_existing_slips: vals.replace_existing_slips ? 1 : 0,
      create_missing_only: vals.create_missing_only ? 1 : 0,
      row_names,
    }),
  });
  const job_id = (enqueue.message || enqueue || {}).job_id;
  if (!job_id) {
    await fail_and_restore("Failed to enqueue background job.");
    return;
  }

  log(`Background job <b>${job_id}</b> started…`, "info");
  let finished = false;
  while (!finished) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status_res = await bs_call("payroll_bulk.api.get_bulk_salary_batch_job_status", { job_id });
    const job = status_res.message || status_res || {};
    if (job.processed_count != null) {
      set_prog(job.processed_count);
    }
    if (["finished", "failed", "not found"].includes(job.status)) {
      finished = true;
      if (job.status === "failed") {
        await fail_and_restore(job.error || "Background job failed.");
        return;
      }
    }
  }

  await frm.reload_doc();
  bs_sync_row_names_from_doc(frm);
  const results = (frm.doc.employees || []).map((row) => ({
    employee: row.employee,
    employee_name: row.employee_name,
    slip_name: row.salary_slip || "",
    ctc: row.ctc,
    ot_amount: row.ot_amount,
    gross: row.gross_pay,
    adv_deduct: row.adv_deduct,
    net: row.net_pay,
    status: row.status === "Failed" ? "Failed" : (row.salary_slip ? "Success" : row.status),
    error: row.error_message || "",
    payment_entry: row.payment_entry || "",
  }));
  set_prog(rows.length);
  window._bs.results = results;
  window._bs._lock_batch_period = false;
  bs_finish_slip_process(pw, results, frm);
}

// ─── 11. PROCESS ──────────────────────────────────────────────────────────────
async function process_bulk(frm, vals) {
  window._bs.vals = vals;
  const batch_snapshot = typeof bs_snapshot_batch_state === "function" ? bs_snapshot_batch_state(frm) : null;
  window._bs._lock_batch_period = true;

  const period = {
    start_date: frm.doc.start_date || vals.start_date,
    end_date: frm.doc.end_date || vals.end_date,
    posting_date: frm.doc.posting_date || vals.posting_date || frm.doc.end_date,
    payroll_frequency: frm.doc.payroll_frequency || vals.payroll_frequency || "Monthly",
  };
  vals.start_date = period.start_date;
  vals.end_date = period.end_date;
  vals.posting_date = period.posting_date;
  vals.payroll_frequency = period.payroll_frequency;

  const $body = frm.layout.wrapper.find(".form-page");
  const rows  = [...window._bs.rows];
  const total = rows.length;

  const pw = bs_create_process_window({
    title: "Creating Salary Slips",
    subtitle: `Processing ${total} employee(s)…`,
    total,
    modal: false,
    target: $body.find("#bs-main-wrap"),
    done_label: "View Batch Report",
  });
  const log = pw.log;
  const set_prog = pw.set_prog;

  log("Saving parent document…");
  frm.doc.company = vals.company || frm.doc.company;
  bs_sync_to_frm(frm);

  const fail_and_restore = async (message) => {
    window._bs._lock_batch_period = false;
    pw.fail(message, "Back to Batch");
    pw.on_done(async () => {
      if (batch_snapshot && typeof bs_restore_batch_snapshot === "function") {
        await bs_restore_batch_snapshot(frm, batch_snapshot);
      } else if (typeof bs_bootstrap_main_ui === "function") {
        await bs_bootstrap_main_ui(frm);
      }
    });
  };

  try {
    await new Promise((res, rej) => frm.save("Save", (r) => r.exc ? rej(new Error(r.exc)) : res(r)));
    bs_sync_row_names_from_doc(frm);
    log("Parent doc saved ✓", "success");
  } catch (e) {
    await fail_and_restore(e.message || String(e));
    return;
  }

  log("Verifying attendance / source data…");
  try {
    await bs_call("payroll_bulk.api.ensure_bulk_batch_source_data", {
      batch_name: frm.doc.name,
      start_date: period.start_date,
      end_date: period.end_date,
    });
    log("Source data verified ✓", "success");
  } catch (e) {
    await fail_and_restore(e.message || String(e));
    return;
  }

  const threshold = window.BS_BACKGROUND_ROW_THRESHOLD || 20;
  if (rows.length >= threshold) {
    await process_bulk_in_background(frm, vals, rows, pw, batch_snapshot, fail_and_restore);
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

      const exists_info = await bs_existing_salary_slip(row, vals, frm);
      const exists = exists_info.name || "";
      if (exists && exists_info.foreign_batch && !vals.replace_existing_slips) {
        const batch_ref = exists_info.batch_name ? ` (batch ${exists_info.batch_name})` : "";
        const msg = `Salary Slip ${exists} already exists for this period${batch_ref}. Tick Cancel and Recreate to replace it.`;
        row.salary_slip = "";
        row.status = "Failed";
        row.salary_slip_status = "";
        row.error_message = msg;
        const child = bs_find_child_row(frm, row);
        if (child) {
          child.salary_slip = "";
          child.status = row.status;
          child.salary_slip_status = "";
          child.error_message = row.error_message;
        }
        log(`<span class="bs-log-emp">${row.employee}</span> — ${msg}`, "error");
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
          payment_entry: row.payment_entry || "",
        });
        has_failures = true;
        continue;
      }
      if (exists && !vals.replace_existing_slips) {
        const slip_docstatus = exists_info.docstatus != null
          ? parseInt(exists_info.docstatus, 10)
          : parseInt((await bs_call("frappe.client.get_value", {
              doctype: "Salary Slip",
              filters: { name: exists },
              fieldname: ["docstatus"],
            })).message?.docstatus || 0, 10);
        if (slip_docstatus === 1) {
          const msg = `Submitted slip <b>${exists}</b> already exists — tick <b>Cancel and Recreate</b> to create a new draft.`;
          row.salary_slip = exists;
          row.status = "Skipped";
          row.salary_slip_status = "Submitted";
          row.error_message = msg.replace(/<[^>]+>/g, "");
          const child = bs_find_child_row(frm, row);
          if (child) {
            child.salary_slip = exists;
            child.status = row.status;
            child.salary_slip_status = "Submitted";
            child.error_message = row.error_message;
          }
          log(`<span class="bs-log-emp">${row.employee}</span> — ${msg}`, "error");
          results.push({
            employee: row.employee,
            employee_name: row.employee_name,
            slip_name: exists,
            ctc: row.ctc,
            ot_amount: row.ot_amount,
            gross: row.gross,
            adv_deduct: row.adv_deduct,
            net: row.net,
            status: "Skipped",
            error: row.error_message,
            payment_entry: row.payment_entry || "",
          });
          continue;
        }
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

      const created = await bs_call("payroll_bulk.api.create_bulk_salary_slip", {
        batch_name: frm.doc.name,
        row_name: row.row_name || "",
        company: vals.company,
        payroll_frequency: vals.payroll_frequency,
        start_date: vals.start_date,
        end_date: vals.end_date,
        posting_date: vals.posting_date,
        ctc: row.ctc || 0,
        submit_slip: 0,
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
  }

  window._bs.results = results;
  window._bs._lock_batch_period = false;
  bs_finish_slip_process(pw, results, frm);
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

