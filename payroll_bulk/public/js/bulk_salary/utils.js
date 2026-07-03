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
