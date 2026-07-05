// Payroll Bulk — shared utilities, state, and styles
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
  expanded_rows: {}, // row _id → expanded
  show_empty_components: false,
};

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

function fmt_num(n, dec=0) {
  return (parseFloat(n)||0).toLocaleString(undefined,
    {minimumFractionDigits:dec, maximumFractionDigits:dec});
}

function fmt_rate(n) {
  return fmt_num(n, 2);
}

function fmt_total(n) {
  return fmt_num(n, 0);
}

function bs_round_money(n) {
  return Math.round(parseFloat(n) || 0);
}

window.bs_round_money = bs_round_money;
window.fmt_rate = fmt_rate;

function bs_input_value(value) {
  const num = parseFloat(value || 0);
  return num ? String(num) : "";
}

function bs_component_input_value(item) {
  const amount = parseFloat(item?.amount || 0) || 0;
  return item?.auto_calculated ? String(bs_round_money(amount)) : bs_input_value(bs_round_money(amount));
}

function bs_normalize_component_key(type, component) {
  return `${type || "Earning"}::${component || ""}`;
}

function bs_saved_components_to_map(entries) {
  const map = {};
  (entries || []).forEach((item) => {
    const component = item.salary_component || item.component;
    const type = item.component_type || item.type || "Earning";
    if (!component) return;
    const amount = parseFloat(item.amount || 0) || 0;
    map[bs_normalize_component_key(type, component)] = amount;
    map[component] = amount;
  });
  return map;
}

function bs_apply_saved_component_map(row) {
  const saved_map = row?._saved_component_map;
  if (!saved_map || !Object.keys(saved_map).length) return;
  (row.components || []).forEach((item) => {
    if (item.auto_calculated) return;
    const key = item.key || bs_normalize_component_key(item.type, item.component);
    if (saved_map[key] !== undefined) {
      item.amount = saved_map[key];
      return;
    }
    if (saved_map[item.component] !== undefined) {
      item.amount = saved_map[item.component];
    }
  });
}

function bs_capture_row_saved_components(row) {
  row._saved_component_map = bs_saved_components_to_map(
    (row.components || [])
      .filter((item) => item.component && !item.auto_calculated)
      .map((item) => ({
        salary_component: item.component,
        component_type: item.type || "Earning",
        amount: item.amount || 0,
      })),
  );
}

window.bs_apply_saved_component_map = bs_apply_saved_component_map;
window.bs_capture_row_saved_components = bs_capture_row_saved_components;
window.bs_saved_components_to_map = bs_saved_components_to_map;

function bs_get_initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function bs_is_row_expanded(row_id) {
  return !!window._bs.expanded_rows[row_id];
}

window.bs_toggle_row_expand = (row_id) => {
  if (window._bs.expanded_rows[row_id]) delete window._bs.expanded_rows[row_id];
  else window._bs.expanded_rows[row_id] = true;
  bs_render_table();
};

window.bs_toggle_empty_components = () => {
  window._bs.show_empty_components = !window._bs.show_empty_components;
  const btn = document.getElementById("bs-toggle-empty-comp");
  if (btn) btn.classList.toggle("is-active", window._bs.show_empty_components);
  bs_render_table();
};

window.bs_expand_all_rows = (expand) => {
  const rows = window._bs.rows || [];
  window._bs.expanded_rows = {};
  if (expand) rows.forEach((r) => { window._bs.expanded_rows[r._id] = true; });
  bs_render_table();
};

function bs_get_row_display_status(row) {
  if (row.payment_entry || row.payment_status === "Payment Created") return { key: "paid", label: "Paid", cls: "ok" };
  if (row.salary_slip_status === "Submitted") return { key: "submitted", label: "Submitted", cls: "ok" };
  if (row.salary_slip_status === "Draft") return { key: "draft", label: "Draft", cls: "warn" };
  if (row.status === "Failed") return { key: "failed", label: "Failed", cls: "fail" };
  if (row.status === "Cancelled" || row.salary_slip_status === "Cancelled") return { key: "cancelled", label: "Cancelled", cls: "fail" };
  if (row.salary_slip) return { key: "slip", label: "Slip Created", cls: "warn" };
  return { key: "pending", label: "Pending", cls: "warn" };
}

function bs_row_has_validation_issue(row) {
  return !!(
    row.structure_warning
    || !row.salary_structure_assignment
    || !row.payroll_payable_account
    || row._period_mismatch
    || row._period_slip_foreign
    || (row._foreign_additional_salaries || []).length
  );
}

function bs_build_linked_docs_hint(row) {
  const parts = [];
  if (row.salary_slip) {
    parts.push(`<button type="button" class="bs-link-chip" onclick="bs_open_doc('Salary Slip','${row.salary_slip}')">${row.salary_slip.split("/").slice(-1)[0]}</button>`);
  } else if (row._period_salary_slip && row._period_slip_foreign) {
    parts.push(`<span class="bs-link-chip bs-link-chip-warn" title="${frappe.utils.escape_html(row._period_salary_slip)}">Slip in ${frappe.utils.escape_html(row._period_salary_slip_batch || "other batch")}</span>`);
  } else if (row._period_salary_slip) {
    parts.push(`<button type="button" class="bs-link-chip" onclick="bs_open_doc('Salary Slip','${row._period_salary_slip}')">${row._period_salary_slip.split("/").slice(-1)[0]}</button>`);
  }
  const ads_count = (row._linked_additional_salaries || []).length || (row._batch_additional_salaries || []).length;
  if (ads_count) {
    parts.push(`<span class="bs-link-chip">ADS ×${ads_count}</span>`);
  }
  if ((row._foreign_additional_salaries || []).length) {
    parts.push(`<span class="bs-link-chip bs-link-chip-warn">ADS in other batch</span>`);
  }
  if (row._period_mismatch) {
    parts.push(`<span class="bs-link-chip bs-link-chip-warn">Period mismatch</span>`);
  }
  return parts.length ? `<div class="bs-linked-docs">${parts.join("")}</div>` : "";
}
window.bs_build_linked_docs_hint = bs_build_linked_docs_hint;

function bs_should_show_component(item, show_empty) {
  if (show_empty || window._bs.show_empty_components) return true;
  const amount = parseFloat(item?.amount || 0) || 0;
  if (amount) return true;
  return !item?.auto_calculated;
}

function bs_merge_component_columns(columns) {
  const alias = { "Basic Salary": "Basic", "House Rent Allowance": "HRA", "Medical Allowance": "Medical" };
  const skip = /^(basic(\s+salary)?|overtime|\bot\b)$/i;
  const merged = {};
  (columns || []).forEach((col) => {
    const key = alias[col.key] || col.key;
    if (skip.test(String(key || "")) || skip.test(String(col.label || ""))) return;
    if (!merged[key]) merged[key] = { key, label: key, type: col.type };
  });
  return Object.values(merged);
}

function bs_row_base_pay(row, frm) {
  if (row?.base_pay != null && row.base_pay !== "") {
    return bs_round_money(row.base_pay);
  }
  return bs_round_money(bs_calculate_base_pay(row, frm || window._bs.frm));
}

function bs_build_emp_cell_html(r, { compact = false, report = false, expand_btn = "" } = {}) {
  return `
    <div class="bs-emp-cell${compact ? " bs-emp-cell-compact" : ""}${report ? " bs-emp-cell-report" : ""}">
      ${expand_btn}
      <div class="bs-emp-avatar">${bs_get_initials(r.employee_name || r.employee)}</div>
      <div class="bs-emp-meta">
        <div class="bs-emp-name-main" title="${frappe.utils.escape_html(r.employee_name || r.employee || "")}">${frappe.utils.escape_html(r.employee_name && r.employee_name !== r.employee ? r.employee_name : r.employee)}</div>
        <div class="bs-emp-id">${r.employee || ""}</div>
      </div>
    </div>`;
}

function bs_build_work_input_row(label, input_html, pill_html) {
  return `<div class="bs-ot-row">
    <span class="bs-input-box-label">${label}</span>
    <span class="bs-input-box-field">${input_html}</span>
    <span class="bs-input-box-pill">${pill_html || "&nbsp;"}</span>
  </div>`;
}

function bs_get_work_column_label(mode) {
  if (typeof bs_is_piece_mode === "function" && bs_is_piece_mode(mode)) return "Overtime";
  if (mode === "Attendance Based" || mode === "Checkin Based") return "Pay Days / OT";
  return "Overtime";
}

function bs_get_merged_component_value(comps, colKey) {
  const aliasMap = {
    Basic: ["Basic", "Basic Salary"],
    HRA: ["House Rent Allowance", "HRA"],
    Medical: ["Medical Allowance", "Medical"],
  };
  const keys = aliasMap[colKey] || [colKey];
  return keys.reduce((s, k) => s + (parseFloat(comps[k] || 0) || 0), 0);
}

window.bs_export_batch_csv = function (rows, filename = "bulk_salary_export.csv") {
  const data_rows = rows || window._bs?.rows || [];
  if (!data_rows.length) {
    frappe.show_alert({ message: "No rows to export.", indicator: "orange" }, 3);
    return;
  }
  const headers = ["Employee", "Employee Name", "Department", "CTC", "Gross", "Advances", "Net Pay", "Status", "Salary Slip", "Payment JE"];
  const lines = [headers.join(",")];
  data_rows.forEach((r) => {
    const st = bs_get_row_display_status(r);
    lines.push([
      r.employee,
      `"${(r.employee_name || "").replace(/"/g, '""')}"`,
      `"${(r.department || "").replace(/"/g, '""')}"`,
      r.ctc || 0,
      r.gross || r.gross_pay || 0,
      r.adv_deduct || 0,
      r.net || r.net_pay || 0,
      st.label,
      r.salary_slip || "",
      r.payment_entry || "",
    ].join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

function bs_build_pipeline_html(frm, rows, draft_count, unpaid_count) {
  const total = rows.length;
  const slip_count = rows.filter((r) => r.salary_slip).length;
  const submitted_count = rows.filter((r) => r.salary_slip_status === "Submitted").length;
  const paid_count = rows.filter((r) => r.payment_entry).length;
  const steps = [
    { label: "Batch", done: total > 0, active: frm.doc.docstatus === 1 },
    { label: "Slips", done: slip_count === total && total > 0, active: draft_count > 0 },
    { label: "Submitted", done: submitted_count === total && total > 0, active: submitted_count > 0 && unpaid_count > 0 },
    { label: "Accrued", done: !!frm.doc.accrual_journal_entry, active: !!frm.doc.accrual_journal_entry && unpaid_count > 0 },
    { label: "Paid", done: paid_count === total && total > 0, active: paid_count > 0 && unpaid_count === 0 },
  ];
  return steps.map((step, idx) => {
    const cls = step.done ? "is-done" : (step.active ? "is-active" : "");
    const line = idx < steps.length - 1 ? `<div class="bs-pipeline-line ${step.done ? "is-done" : ""}"></div>` : "";
    return `<div class="bs-pipeline-step ${cls}"><div class="bs-pipeline-dot">${step.done ? "✓" : idx + 1}</div><div class="bs-pipeline-label">${step.label}</div></div>${line}`;
  }).join("");
}

// ─── 19. STYLES ───────────────────────────────────────────────────────────────
function inject_bs_styles() {
  if (document.getElementById("bs-styles-v7")) return;
  document.getElementById("bs-styles-v6")?.remove();
  document.getElementById("bs-styles-v5")?.remove();
  document.getElementById("bs-styles-v4")?.remove();
  document.getElementById("bs-styles-v3")?.remove();
  document.getElementById("bs-styles-v2")?.remove();
  document.getElementById("bs-styles")?.remove();
  const s = document.createElement("style");
  s.id = "bs-styles-v7";
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
    #bs-main-wrap{margin:0 0 32px;display:block!important;visibility:visible!important;overflow:visible!important}
    /* Hide standard doc fields on Bulk Salary form only — must not affect frappe dialogs */
    .form-page:has(#bs-main-wrap) > .form-section,
    .form-page:has(#bs-main-wrap) > .form-column,
    #bs-main-wrap ~ .form-section,
    #bs-main-wrap ~ .form-column{display:none!important}
    .modal-body .form-page > .form-section,
    .modal-body .form-page > .form-column,
    .modal-body .form-layout .frappe-control{display:block!important;visibility:visible!important;opacity:1!important}
    .bs-adv-closing{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .bs-adv-deduct-chip .bs-adv-input{width:88px;height:24px;padding:2px 8px;border:1px solid var(--bs-border);border-radius:8px;font-size:13px}
    .bs-adv-balance-chip{font-weight:600}
    .bs-wrap{font-family:'Segoe UI',system-ui,sans-serif;color:var(--bs-text);padding:6px 14px 14px 4px;overflow:visible}
    .bs-opt{font-weight:400;text-transform:none;font-size:11px}

    /* Header */
    .bs-header-card{display:flex;align-items:center;justify-content:space-between;gap:16px;background:linear-gradient(135deg,#ffffff 0%,#f6f9ff 100%);border:1px solid var(--bs-border);border-radius:var(--bs-radius);padding:14px 18px;margin-bottom:14px;box-shadow:var(--bs-shadow)}
    .bs-title-container{background:linear-gradient(135deg,#ffffff 0%,#f6f9ff 100%);border:1px solid var(--bs-border);border-radius:var(--bs-radius);padding:12px 14px;margin-bottom:12px;box-shadow:var(--bs-shadow);overflow:visible}
    .bs-header-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%}
    .bs-title-section{border-top:1px dashed #e2e8f0;padding-top:10px;margin-top:10px;overflow:visible}
    .bs-title-container .bs-find-employees-bar,.bs-title-container .bs-calculation-bar,.bs-title-container .bs-employee-actions-row{background:transparent;border:none;box-shadow:none;padding:0;margin:0;overflow:visible}
    .bs-filter-stack{display:flex;flex-direction:column;gap:6px;overflow:visible}
    .bs-filter-stack .bs-inline-filter-row{align-items:flex-end;overflow:visible}
    .bs-inline-filter-row{display:grid;grid-template-columns:102px minmax(0,1fr);gap:6px;align-items:flex-end;overflow:visible}
    .bs-row-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#475569;white-space:nowrap;padding-bottom:6px;min-width:0;flex:0 0 auto}
    .bs-row-title-spacer{visibility:hidden;padding-bottom:0;min-height:0}
    .bs-find-employees-bar .bs-row-title::before{content:"";display:inline-block;width:6px;height:6px;border-radius:999px;background:#2563eb;margin-right:6px;vertical-align:middle}
    .bs-calculation-bar .bs-row-title::before{content:"";display:inline-block;width:6px;height:6px;border-radius:999px;background:#0f766e;margin-right:6px;vertical-align:middle}
    .bs-row-title-source::before{content:"";display:inline-block;width:6px;height:6px;border-radius:999px;background:#7c3aed;margin-right:6px;vertical-align:middle}
    .bs-inline-filter-fields{display:flex;align-items:flex-end;gap:4px;flex-wrap:wrap;min-width:0;overflow:visible}
    .bs-employee-actions-row .bs-inline-filter-actions{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
    .bs-inline-filter-fields .bs-filter-field,.bs-filter-field-inline{min-width:0;flex:1 1 130px;max-width:220px;position:relative;z-index:1}
    .bs-inline-filter-fields .bs-filter-field:focus-within,.bs-inline-filter-fields .bs-filter-field-inline:focus-within{z-index:12}
    .bs-inline-filter-fields .form-group,.bs-filter-field-inline .form-group{margin:0;width:100%;position:relative}
    .bs-inline-filter-fields .form-control,.bs-filter-field-inline .bs-select-sm{width:100%;min-width:0}
    .bs-inline-filter-fields .link-btn,.bs-inline-filter-fields .awesomplete{width:100%}
    .bs-title-container .awesomplete>ul,.bs-filter-card .awesomplete>ul{z-index:1200!important;max-height:240px;overflow:auto}
    .bs-calculation-bar{display:grid;grid-template-columns:102px minmax(0,1fr);gap:6px;align-items:flex-end}
    .bs-filter-field-inline .form-group{margin:0}
    .bs-source-mapping-panel.is-hidden{display:none!important}
    .bs-source-mapping-row{display:grid;grid-template-columns:102px minmax(0,1fr);gap:6px;align-items:flex-end}
    .bs-filters-area,.bs-filter-card{overflow:visible}
    .bs-source-mapping-fields{display:flex;align-items:flex-end;gap:4px;flex-wrap:nowrap;min-width:0;overflow:visible}
    .bs-source-doctype-cell{flex:1.2 1 0;min-width:140px;position:relative;z-index:4}
    .bs-source-doctype-cell .form-group{margin:0;width:100%}
    .bs-source-doctype-cell .link-btn{display:inline-flex}
    .bs-source-mapping-panel .awesomplete>ul{z-index:1200!important;max-height:240px;overflow:auto}
    .bs-source-map-field{flex:1 1 0;min-width:0}
    .bs-source-map-field select,.bs-source-map-field .form-control{width:100%;min-width:0}
    .bs-source-mapping-actions{flex:0 0 auto;display:flex;align-items:center;gap:6px;white-space:nowrap;padding-bottom:1px;margin-left:auto}
    .bs-source-note{font-size:11px;color:#64748b;margin-top:8px;line-height:1.45;padding-top:8px;border-top:1px dashed #e2e8f0}
    .bs-header-main{display:flex;align-items:center;gap:14px;min-width:0}
    .bs-header-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
    .bs-header-meta{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
    .bs-head-pill{display:inline-flex;align-items:center;min-height:28px;padding:4px 10px;border:1px solid #dbe4f0;border-radius:999px;background:#fff;color:#475569;font-size:11px;font-weight:700;white-space:nowrap}
    .bs-header-icon{background:linear-gradient(135deg,#2563eb,#0f766e);border:none;color:#fff;font-weight:800;font-size:13px;border-radius:10px;min-width:48px;height:48px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 10px 22px rgba(37,99,235,.18)}
    .bs-header-title{font-size:16px;font-weight:700;color:var(--bs-text);margin-bottom:3px}
    .bs-header-sub{font-size:12.5px;color:var(--bs-muted);line-height:1.5}
    .bs-header-period-bar{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
    .bs-find-employees-bar{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);border:1px solid var(--bs-border);border-radius:12px;padding:10px 12px;margin-bottom:10px;box-shadow:var(--bs-shadow);overflow:visible}
    .bs-filter-sections-grid-settings{grid-template-columns:repeat(2,minmax(0,1fr))}
    .bs-filters-area.is-hidden{display:none}
    .bs-filter-card{background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);border:1px solid var(--bs-border);border-radius:12px;padding:10px 12px;margin-bottom:10px;box-shadow:var(--bs-shadow)}
    .bs-filter-sections-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start}
    .bs-filter-section{background:#fff;border:1px solid #e8eef5;border-radius:10px;padding:10px 12px;height:100%}
    .bs-filter-section-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#475569;margin-bottom:8px;display:flex;align-items:center;gap:6px}
    .bs-filter-section-title::before{content:"";width:6px;height:6px;border-radius:999px;background:#93c5fd;flex-shrink:0}
    .bs-filter-section.bs-filter-section-find .bs-filter-section-title::before{background:#2563eb}
    .bs-filter-section.bs-filter-section-calc .bs-filter-section-title::before{background:#0f766e}
    .bs-filter-section.bs-filter-section-source .bs-filter-section-title::before{background:#7c3aed}
    .bs-filter-grid-find{display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .bs-filter-grid-find .bs-filter-field-full{grid-column:1/-1}
    .bs-filter-grid-calc{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    .bs-filter-field-stack{display:flex;flex-direction:column;gap:4px}
    .bs-filter-field-stack .bs-piece-filter-check{margin-bottom:2px;height:22px}
    .bs-filter-grid-source{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
    .bs-filter-grid-source .bs-filter-field-full{grid-column:1/-1}
    .bs-filter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;align-items:end}
    .bs-filter-grid-actions{display:flex;gap:8px;align-items:end;flex-wrap:wrap}
    .bs-filter-field label{display:block;font-size:10px;font-weight:700;color:#64748b;margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px}
    .bs-filter-actions-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0}
    .bs-filter-panel-title{display:none}
    .bs-panel-soft{background:transparent;border:none;box-shadow:none;padding:0}

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
    .bs-btn-ghost.is-active{background:#ede9fe;border-color:#a78bfa;color:#5b21b6}
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
    .bs-linked-docs{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
    .bs-link-chip{display:inline-flex;align-items:center;border:1px solid var(--bs-border);background:#fff;border-radius:999px;padding:1px 7px;font-size:10px;color:var(--bs-muted);cursor:pointer}
    .bs-link-chip-warn{border-color:#fcd34d;background:var(--bs-amber-dim);color:var(--bs-amber)}
    .bs-table-scroll{max-height:72vh;overflow:auto;border:1px solid var(--bs-border);border-radius:var(--bs-radius);background:var(--bs-surface);box-shadow:var(--bs-shadow);position:relative;isolation:isolate}
    .bs-table-scroll > .bs-table-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:0;padding:8px 10px;background:var(--bs-surface);border-bottom:1px solid var(--bs-border);flex-shrink:0}
    .bs-table-wrap{border:none;border-radius:0;overflow:visible;margin-bottom:4px;background:transparent;box-shadow:none}
    .bs-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;table-layout:fixed;margin-left:2px}
    .bs-col-emp{width:14%}
    .bs-col-dept{width:10%}
    .bs-col-ctc{width:7%}
    .bs-col-salary{width:8%}
    .bs-col-work{width:8%}
    .bs-col-comp{width:10%}
    .bs-col-gross{width:8%}
    .bs-col-adv{width:7%}
    .bs-col-net{width:8%}
    .bs-col-status{width:10%}
    .bs-col-menu{width:32px}
    .bs-th,.bs-td{padding-left:7px;padding-right:7px}
    .bs-th:first-child,.bs-td:first-child{padding-left:10px}
    .bs-th:last-child,.bs-td:last-child{padding-right:10px}
    .bs-th.bs-col-comp,.bs-td.bs-col-comp{padding-left:12px;padding-right:12px}
    .bs-th.bs-col-gross,.bs-td.bs-col-gross{padding-left:12px;padding-right:12px}
    .bs-th{background:linear-gradient(180deg,#f8fbff 0%,#eef4ff 100%);padding:10px 12px;text-align:left;font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#475569;border-bottom:1px solid var(--bs-border)}
    .bs-table-scroll thead .bs-th{position:sticky;top:0;z-index:3}
    .bs-th.bs-th-num,.bs-td-num{text-align:right}
    .bs-th.bs-th-sticky,.bs-td-sticky{position:sticky;left:0;z-index:2;background:#fff;box-shadow:1px 0 0 #e9eef5}
    .bs-th.bs-th-sticky{z-index:5;background:linear-gradient(180deg,#f8fbff 0%,#eef4ff 100%)}
    .bs-td{padding:8px 10px;border-bottom:1px solid #e9eef5;vertical-align:middle;background:#fff}
    .bs-row:last-child .bs-td{border-bottom:none}
    .bs-row:nth-child(even) .bs-td{background:#fbfdff}
    .bs-row:nth-child(even) .bs-td-sticky{background:#fbfdff}
    .bs-row:hover .bs-td{background:#f0f7ff}
    .bs-row:hover .bs-td-sticky{background:#f0f7ff}
    .bs-row.is-expanded .bs-td{background:#f8fbff}
    .bs-row.is-expanded .bs-td-sticky{background:#f8fbff}
    .bs-row.has-issue .bs-td-sticky{border-left:3px solid var(--bs-red)}

    /* Completed / report view table — sticky employee, scroll components */
    .bs-report-table-scroll{overflow-x:auto;overflow-y:auto;max-height:68vh;-webkit-overflow-scrolling:touch}
    .bs-table-report{width:max-content;min-width:100%;table-layout:auto;font-size:12px;margin-left:0}
    .bs-table-report .bs-th,.bs-table-report .bs-td{padding:3px 7px;vertical-align:middle;line-height:1.25}
    .bs-table-report thead .bs-th{padding:5px 7px;font-size:10px;letter-spacing:.3px}
    .bs-table-report .bs-report-col-emp{
      position:sticky;left:0;z-index:4;min-width:132px;max-width:148px;width:138px;
      background:#fff;box-shadow:1px 0 0 #e2e8f0
    }
    .bs-table-report thead .bs-report-col-emp{z-index:7;background:linear-gradient(180deg,#f8fbff 0%,#eef4ff 100%)}
    .bs-table-report .bs-row:nth-child(even) .bs-report-col-emp{background:#fbfdff}
    .bs-table-report .bs-row:hover .bs-report-col-emp{background:#f0f7ff}
    .bs-table-report .bs-total-row .bs-report-col-emp{background:#f8fafc;font-weight:700}
    .bs-table-report .bs-report-col-dept{min-width:88px;max-width:110px;white-space:nowrap}
    .bs-table-report .bs-report-col-fixed{min-width:72px;white-space:nowrap}
    .bs-table-report .bs-th-comp,.bs-table-report .bs-td-comp{min-width:76px;max-width:104px;white-space:nowrap}
    .bs-table-report .bs-report-col-action{min-width:64px;white-space:nowrap}
    .bs-table-report .bs-dept-cell{max-width:100px;font-size:10px}
    .bs-table-report .bs-emp-cell-report{gap:5px;align-items:center;min-width:0}
    .bs-table-report .bs-emp-cell-report .bs-emp-avatar{width:22px;height:22px;font-size:8px;flex-shrink:0}
    .bs-table-report .bs-emp-cell-report .bs-emp-meta{min-width:0;overflow:hidden}
    .bs-table-report .bs-emp-cell-report .bs-emp-name-main{font-size:11px;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:108px}
    .bs-table-report .bs-emp-cell-report .bs-emp-id{font-size:9px;line-height:1.1;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:108px}
    .bs-table-report .bs-status-badge{font-size:9px;padding:2px 6px;line-height:1.2}
    .bs-table-report .bs-btn-ghost.bs-btn-sm{padding:1px 6px;font-size:10px;line-height:1.2}
    .bs-table-report .bs-mono{font-size:10px}
    .bs-row-detail .bs-td-detail{padding:4px 6px 6px;border-bottom:1px solid #e9eef5;background:#f8fafc}
    .bs-row-detail-wrap{display:flex;flex-direction:column;gap:4px}
    .bs-expand-columns{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,2.8fr) minmax(0,.55fr);gap:8px;align-items:stretch}
    .bs-expand-panel-side{min-width:0}
    .bs-expand-panel-piece{min-width:0;max-width:none;overflow:hidden}
    .bs-expand-panel-main{min-width:0}
    .bs-expand-panel{background:#fff;border:1px solid var(--bs-border);border-radius:8px;padding:6px 8px;height:100%;min-width:0;overflow:hidden}
    .bs-expand-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px;min-height:18px}
    .bs-expand-panel-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#64748b;flex-shrink:0;white-space:nowrap}
    .bs-expand-panel-formula{font-size:9px;color:#64748b;line-height:1.2;text-align:right;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .bs-expand-panel-compact{padding:6px 8px}
    .bs-comp-split{display:grid;grid-template-columns:1fr 1fr;gap:6px;align-items:start}
    .bs-comp-col{display:flex;flex-direction:column;gap:4px;min-width:0}
    .bs-comp-col-title{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px;width:fit-content}
    .bs-comp-col-title-earn{background:#ecfdf5;color:#166534;border:1px solid #bbf7d0}
    .bs-comp-col-title-ded{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
    .bs-comp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:4px}
    .bs-comp-card{border:1px solid #e2e8f0;border-radius:5px;padding:3px 6px;background:#fff;min-width:0}
    .bs-comp-card-earn{border-color:#bbf7d0;background:#f8fffb}
    .bs-comp-card-ded{border-color:#fecaca;background:#fffafa}
    .bs-comp-card-label{font-size:9px;font-weight:700;color:#64748b;line-height:1.15;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;margin-bottom:1px;min-height:0}
    .bs-comp-card-earn .bs-comp-card-label{color:#166534}
    .bs-comp-card-ded .bs-comp-card-label{color:#b91c1c}
    .bs-comp-card input{width:100%;border:none;background:transparent;padding:0;font-size:12px;font-weight:700;color:inherit;min-height:16px;line-height:1.1;-moz-appearance:textfield;appearance:textfield}
    .bs-comp-card-sub{font-size:9px;font-weight:600;color:#64748b;line-height:1.25;margin-bottom:2px;white-space:nowrap}
    .bs-comp-card input::-webkit-outer-spin-button,.bs-comp-card input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
    .bs-comp-card input:focus{outline:none}
    .bs-comp-card-auto input{color:#64748b;font-weight:600}
    .bs-comp-totals{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
    .bs-meta-compact{display:flex;flex-direction:column;gap:4px;font-size:11px;line-height:1.4;color:#475569}
    .bs-meta-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;font-weight:600;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bs-meta-chip b{font-weight:800;color:#334155}
    .bs-meta-chip-warn{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
    .bs-piece-inline-rows{display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden}
    .bs-piece-inline-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr);gap:4px;align-items:center;font-size:11px;min-width:0}
    .bs-piece-inline-row .bs-input-sm{width:100%;min-width:0;height:24px;min-height:24px;font-size:11px;padding:2px 6px}
    .bs-piece-inline-row label{display:flex;align-items:center;gap:4px;color:#475569;font-weight:600;white-space:nowrap;font-size:11px;min-width:0}
    .bs-piece-inline-sep{color:#94a3b8;text-align:center;font-size:11px;flex-shrink:0}
    .bs-piece-inline-amt{font-weight:800;color:#b45309;text-align:right;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bs-piece-inline-total{margin-top:6px;padding-top:6px;border-top:1px dashed #e2e8f0;font-size:12px;font-weight:800;color:#b45309;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bs-meta-line{font-size:11px;line-height:1.45;color:#475569;margin-bottom:4px}
    .bs-meta-line b{color:var(--bs-text)}
    .bs-meta-actions{margin-top:6px;display:flex;gap:6px;flex-wrap:wrap}
    .bs-emp-cell{display:flex;align-items:center;gap:8px;min-width:0}
    .bs-emp-cell-compact .bs-emp-avatar{width:28px;height:28px;font-size:10px}
    .bs-emp-cell-compact .bs-emp-name-main{font-size:12px}
    .bs-emp-cell-compact .bs-emp-id{font-size:10px}
    .bs-dept-cell{font-size:11px;color:#64748b;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}
    .bs-emp-avatar{width:34px;height:34px;border-radius:999px;background:linear-gradient(135deg,#dbeafe,#dcfce7);color:#1d4ed8;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .bs-emp-meta{min-width:0;flex:1}
    .bs-emp-name-main{font-size:13px;font-weight:700;color:var(--bs-text);line-height:1.2}
    .bs-emp-id{font-size:11px;color:var(--bs-muted)}
    .bs-dept-pill{display:inline-flex;margin-top:4px;padding:1px 7px;border-radius:999px;background:#f1f5f9;border:1px solid #e2e8f0;color:#64748b;font-size:10px;font-weight:700}
    .bs-expand-btn{width:24px;height:24px;border:1px solid var(--bs-border);border-radius:6px;background:#fff;color:#475569;cursor:pointer;font-size:12px;line-height:1;flex-shrink:0}
    .bs-expand-btn:hover{background:#eff6ff;border-color:#93c5fd;color:var(--bs-primary-deep)}
    .bs-comp-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:10px;font-weight:700;white-space:nowrap}
    .bs-comp-pill-earn{background:#ecfdf5;border-color:#bbf7d0;color:#166534}
    .bs-comp-pill-ded{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
    .bs-comp-col-summary{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
    .bs-comp-total-line{font-size:12px;font-weight:800;line-height:1.2;white-space:nowrap}
    .bs-comp-total-earn{color:#166534}
    .bs-comp-total-ded{color:#b91c1c}
    .bs-work-summary{font-size:13px;font-weight:700;color:var(--bs-text)}
    .bs-money-ot{color:var(--bs-amber)}
    .bs-work-sub{font-size:10px;color:var(--bs-muted);margin-top:2px}
    .bs-piece-mini{width:100%;border-collapse:collapse;font-size:11px}
    .bs-piece-mini th,.bs-piece-mini td{padding:5px 8px;border:1px solid #e2e8f0;text-align:right}
    .bs-piece-mini th:first-child,.bs-piece-mini td:first-child{text-align:left}
    .bs-piece-mini th{background:#f8fafc;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#64748b}
    .bs-piece-mini .bs-piece-total-row td{font-weight:800;background:#fffbeb;color:#b45309}
    .bs-table-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
    .bs-menu-wrap{position:relative;display:inline-block}
    .bs-menu-btn{width:28px;height:28px;border:1px solid var(--bs-border);border-radius:6px;background:#fff;cursor:pointer;font-size:16px;line-height:1;color:#475569}
    .bs-menu-btn:hover{background:#eff6ff;border-color:#93c5fd}
    .bs-menu-list{position:absolute;right:0;top:calc(100% + 4px);min-width:180px;background:#fff;border:1px solid var(--bs-border);border-radius:8px;box-shadow:var(--bs-shadow);padding:4px;z-index:20;display:none}
    .bs-menu-wrap.is-open .bs-menu-list{display:block}
    .bs-menu-item{display:block;width:100%;text-align:left;border:none;background:transparent;padding:7px 10px;border-radius:6px;font-size:12px;color:#334155;cursor:pointer}
    .bs-menu-item:hover{background:#eff6ff;color:var(--bs-primary-deep)}
    .bs-menu-item-danger{color:var(--bs-red)}
    .bs-total-row .bs-td{background:var(--bs-surface-strong)!important;font-weight:700;position:sticky;bottom:0;z-index:2;border-top:2px solid var(--bs-border)}
    .bs-total-row .bs-td-sticky{background:var(--bs-surface-strong)!important}
    .bs-adv-summary{font-size:12px;color:var(--bs-muted)}
    .bs-adv-summary-btn{height:24px;padding:0 10px;font-size:11px}
    .bs-formula-line{font-size:9px;color:#64748b;padding:0;line-height:1.2;background:transparent;border:none;white-space:nowrap}
    .bs-manual-days-row{display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:nowrap}
    .bs-manual-days-row .bs-input-sm{width:44px;min-width:44px}
    .bs-manual-days-label{font-size:10px;font-weight:700;color:#64748b;white-space:nowrap}
    .bs-structure-compact{font-size:11px;color:var(--bs-cyan);font-weight:700}
    .bs-structure-compact-warn{color:var(--bs-red)}
    .bs-pipeline{display:flex;align-items:center;gap:0;margin:12px 0 16px;flex-wrap:wrap}
    .bs-pipeline-step{display:flex;align-items:center;gap:8px;flex:1;min-width:120px}
    .bs-pipeline-dot{width:28px;height:28px;border-radius:999px;border:2px solid #cbd5e1;background:#fff;color:#64748b;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .bs-pipeline-step.is-done .bs-pipeline-dot{background:var(--bs-green-dim);border-color:#86efac;color:var(--bs-green)}
    .bs-pipeline-step.is-active .bs-pipeline-dot{background:var(--bs-primary-soft);border-color:#93c5fd;color:var(--bs-primary-deep)}
    .bs-pipeline-label{font-size:11px;font-weight:700;color:#64748b}
    .bs-pipeline-step.is-done .bs-pipeline-label,.bs-pipeline-step.is-active .bs-pipeline-label{color:var(--bs-text)}
    .bs-pipeline-line{flex:1;height:2px;background:#e2e8f0;min-width:16px;margin:0 4px}
    .bs-pipeline-line.is-done{background:#86efac}
    .bs-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px}
    .bs-kpi-card{background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);border:1px solid var(--bs-border);border-radius:10px;padding:12px 14px;box-shadow:var(--bs-shadow)}
    .bs-kpi-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:4px}
    .bs-kpi-value{font-size:18px;font-weight:800;color:var(--bs-text)}
    .bs-kpi-value-green{color:var(--bs-green)}
    .bs-kpi-value-red{color:var(--bs-red)}
    .bs-accounting-panel{background:#fff;border:1px solid var(--bs-border);border-radius:10px;padding:12px 14px;margin-bottom:14px;box-shadow:var(--bs-shadow)}
    .bs-accounting-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#64748b;margin-bottom:8px}
    .bs-accounting-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px}
    .bs-accounting-row:last-child{border-bottom:none}
    .bs-reconcile-panel{background:#fff;border:1px solid var(--bs-border);border-radius:10px;padding:12px 14px;margin-bottom:14px;box-shadow:var(--bs-shadow)}
    .bs-reconcile-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
    .bs-reconcile-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#64748b}
    .bs-reconcile-kpis{display:flex;gap:8px;flex-wrap:wrap}
    .bs-reconcile-kpi{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid #e2e8f0;background:#f8fafc}
    .bs-reconcile-kpi-ok{background:#ecfdf5;border-color:#bbf7d0;color:#166534}
    .bs-reconcile-kpi-bad{background:#fef2f2;border-color:#fecaca;color:#b91c1c}
    .bs-reconcile-kpi-warn{background:#fffbeb;border-color:#fde68a;color:#92400e}
    .bs-reconcile-table{width:100%;border-collapse:collapse;font-size:12px}
    .bs-reconcile-table th,.bs-reconcile-table td{padding:6px 8px;border-bottom:1px solid #e9eef5;text-align:right}
    .bs-reconcile-table th:first-child,.bs-reconcile-table td:first-child{text-align:left}
    .bs-reconcile-table th{background:#f8fafc;font-size:10px;text-transform:uppercase;color:#64748b}
    .bs-reconcile-row-ok td{background:#fafffe}
    .bs-reconcile-row-bad td{background:#fffafa}
    .bs-action-groups{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-left:auto}
    .bs-action-group{display:inline-flex;border:1px solid var(--bs-border);border-radius:8px;overflow:hidden;background:#fff}
    .bs-action-group .bs-btn-secondary{border:none;border-radius:0;border-right:1px solid var(--bs-border)}
    .bs-action-group .bs-btn-secondary:last-child{border-right:none}
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
    .bs-ot-row{display:grid;grid-template-columns:48px minmax(0,56px) minmax(0,1fr);gap:4px;align-items:center;margin-top:4px;min-width:0}
    .bs-input-box-label{display:inline-flex;align-items:center;justify-content:center;width:48px;height:22px;padding:0;border:1px solid var(--bs-border-strong);border-radius:2px;background:#f8fafc;color:#475569;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;flex-shrink:0}
    .bs-input-box-field{display:flex;align-items:center;min-width:0}
    .bs-input-box-field .bs-input-sm,.bs-input-box-field .bs-comp-pill{width:100%;min-width:0;height:22px;min-height:22px}
    .bs-input-box-pill{display:flex;align-items:center;justify-content:flex-end;min-width:0;min-height:22px;overflow:hidden}
    .bs-input-box-pill .bs-comp-pill{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
    .bs-work-rates-footer{margin-top:6px;padding-top:5px;border-top:1px solid #e2e8f0;font-size:9px;color:#64748b;line-height:1.35;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
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
    .bs-status-warn{background:var(--bs-amber-dim);color:var(--bs-amber)}
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

    /* Process window (salary slips, accrual, payment) */
    .bs-process-window{padding:2px 0}
    .bs-process-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
    .bs-process-spinner{width:28px;height:28px;border:3px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:bs-spin .8s linear infinite;flex-shrink:0}
    .bs-process-spinner-done{animation:none;border-color:#bbf7d0;border-top-color:#16a34a}
    .bs-process-spinner-done.bs-process-error{border-color:#fecaca;border-top-color:#dc2626}
    .bs-process-spinner-done.bs-process-warn{border-color:#fde68a;border-top-color:#d97706}
    .bs-process-spinner-done::after{content:"✓";display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:14px;font-weight:700;color:#16a34a;line-height:22px}
    .bs-process-spinner-done.bs-process-error::after{content:"✕";color:#dc2626}
    .bs-process-spinner-done.bs-process-warn::after{content:"!";color:#d97706}
    @keyframes bs-spin{to{transform:rotate(360deg)}}
    .bs-process-title{font-size:15px;font-weight:700;color:var(--bs-text)}
    .bs-process-sub{font-size:12px;color:var(--bs-muted);margin-top:2px}
    .bs-process-result{margin-top:12px}
    .bs-process-actions{display:flex;gap:8px;flex-wrap:wrap}

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
    @media (max-width: 1400px){
      .bs-piece-inline-row{grid-template-columns:1fr 1fr;gap:4px 6px}
      .bs-piece-inline-row label{grid-column:1/-1}
      .bs-piece-inline-sep{display:none}
      .bs-piece-inline-amt{grid-column:2;text-align:right}
    }
    @media (max-width: 1100px){.bs-expand-columns,.bs-filter-sections-grid,.bs-filter-sections-grid-settings{grid-template-columns:1fr}}
    @media (max-width: 900px){.bs-comp-split{grid-template-columns:1fr}}
    @media (max-width: 1280px){.bs-qa-row{grid-template-columns:repeat(3,minmax(0,1fr))}.bs-source-row{grid-template-columns:repeat(3,minmax(0,1fr))}.bs-header-card{align-items:flex-start;flex-direction:column}.bs-header-tools{width:100%;justify-content:space-between}.bs-header-period-bar{width:100%}.bs-piece-total-pill{width:168px;min-width:168px}}
    @media (max-width: 900px){.bs-qa-row,.bs-source-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width: 768px){.bs-source-row,.bs-qa-row{grid-template-columns:repeat(1,minmax(0,1fr))}}
  `;
  document.head.appendChild(s);
}

/** Modal or inline progress window — stays open until complete(), then shows result + action button. */
function bs_create_process_window(opts = {}) {
  const total = parseInt(opts.total || 0, 10);
  const use_modal = opts.modal !== false && !opts.target;
  const uid = `bs-pw-${Date.now()}`;
  const progress_html = total > 0
    ? `<div class="bs-progress-wrap">
        <div class="bs-progress-bar-bg"><div class="bs-progress-bar" id="${uid}-bar" style="width:0%"></div></div>
        <div class="bs-prog-label" id="${uid}-label">0 / ${total}</div>
      </div>`
    : "";

  const body_html = `
    <div class="bs-process-window" id="${uid}">
      <div class="bs-process-header">
        <div class="bs-process-spinner" id="${uid}-spin"></div>
        <div class="bs-process-head-text">
          <div class="bs-process-title" id="${uid}-title">${opts.title || "Processing…"}</div>
          <div class="bs-process-sub" id="${uid}-sub">${opts.subtitle || ""}</div>
        </div>
      </div>
      ${progress_html}
      <div class="bs-log" id="${uid}-log"></div>
      <div class="bs-process-result" id="${uid}-result" style="display:none"></div>
      ${!use_modal ? `<div class="bs-process-actions" id="${uid}-actions" style="display:none;margin-top:14px">
        <button type="button" class="bs-btn-primary" id="${uid}-done">${opts.done_label || "Continue"}</button>
      </div>` : ""}
    </div>`;

  let dialog = null;
  let done_fn = null;
  let finished = false;

  if (use_modal) {
    dialog = new frappe.ui.Dialog({
      title: opts.title || "Processing…",
      size: opts.size || "large",
      fields: [{ fieldtype: "HTML", fieldname: "body", options: body_html }],
      primary_action_label: "Processing…",
      primary_action() {
        if (!finished) return;
        dialog.hide();
        if (done_fn) done_fn();
      },
    });
    dialog.get_primary_btn().prop("disabled", true);
    dialog.$wrapper.find(".btn-modal-close, .close").hide();
    dialog.show();
  } else if (opts.target) {
    opts.target.html(`<div class="bs-wrap">${body_html}</div>`);
  }

  const el = (suffix) => document.getElementById(`${uid}-${suffix}`);

  const log = (msg, type = "info") => {
    const box = el("log");
    if (!box) return;
    const row = document.createElement("div");
    row.className = `bs-log-row bs-log-${type}`;
    row.innerHTML = msg;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  };

  const set_prog = (n) => {
    if (!total) return;
    const b = el("bar");
    const l = el("label");
    const pct = Math.round((parseFloat(n) || 0) / Math.max(total, 1) * 100);
    if (b) b.style.width = `${pct}%`;
    if (l) l.textContent = `${n} / ${total}`;
  };

  const set_title = (t) => {
    const node = el("title");
    if (node) node.textContent = t;
    if (dialog) dialog.set_title(t);
  };

  const set_subtitle = (t) => {
    const node = el("sub");
    if (node) node.textContent = t;
  };

  const finish_ui = (summary_html, indicator, button_label) => {
    finished = true;
    const spin = el("spin");
    if (spin) spin.classList.add("bs-process-spinner-done", `bs-process-${indicator || "success"}`);
    const res = el("result");
    if (res) {
      res.style.display = "";
      res.innerHTML = summary_html;
    }
    const label = button_label || "Close";
    if (use_modal && dialog) {
      const titles = { success: "Complete", error: "Failed", warn: "Complete with issues" };
      dialog.set_title(titles[indicator] || "Complete");
      dialog.get_primary_btn().prop("disabled", false).text(label);
      dialog.$wrapper.find(".btn-modal-close, .close").show();
    } else {
      const actions = el("actions");
      const btn = el("done");
      if (actions) actions.style.display = "";
      if (btn) {
        btn.textContent = label;
        btn.onclick = () => { if (done_fn) done_fn(); };
      }
    }
  };

  return {
    log,
    set_prog,
    set_title,
    set_subtitle,
    complete(summary = {}) {
      finish_ui(summary.html || "", summary.indicator || "success", summary.button_label);
    },
    fail(msg, button_label = "Close") {
      log(msg, "error");
      finish_ui(`<div class="bs-notice bs-notice-error">${msg}</div>`, "error", button_label);
    },
    on_done(fn) {
      done_fn = fn;
    },
    dialog,
  };
}
window.bs_create_process_window = bs_create_process_window;


// style patch marker
