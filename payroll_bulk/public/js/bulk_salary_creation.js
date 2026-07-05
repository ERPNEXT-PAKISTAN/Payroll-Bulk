// Bulk Salary Creation — form entry point (loads desk UI modules).
const BS_COMPLETED_STATUSES = ["Completed", "Completed With Errors"];

function bs_get_form_page(frm) {
  if (!frm?.layout?.wrapper?.find) return $();
  return frm.layout.wrapper.find(".form-page").first();
}

function bs_hide_standard_form_fields(frm) {
  (frm.fields || []).forEach((field) => {
    if (field?.$wrapper) field.$wrapper.hide();
  });
  const $root = frm.$wrapper?.find ? frm.$wrapper : $(frm.wrapper || []);
  $root.find(".form-footer, .timeline-section, .comment-box, .form-dashboard-section").hide();
  bs_get_form_page(frm).children().not("#bs-main-wrap").hide();
}

function bs_tidy_form_after_ui(frm) {
  const $page = bs_get_form_page(frm);
  if (!$page.length) return;
  $page.closest(".form-layout").show();
  $page.show();
  $page.children().not("#bs-main-wrap").hide();
  $page.find("#bs-main-wrap").show();
  (frm.fields || []).forEach((field) => {
    if (field?.$wrapper) field.$wrapper.hide();
  });
}
window.bs_tidy_form_after_ui = bs_tidy_form_after_ui;

function bs_is_completed_batch(doc) {
  return BS_COMPLETED_STATUSES.includes(doc?.processing_status || "");
}

function bs_has_linked_slips(doc) {
  return (doc?.employees || []).some((row) => row.salary_slip);
}

function bs_should_show_report_view(doc) {
  if (!doc) return false;
  if (doc.docstatus === 1) return true;
  if (bs_is_completed_batch(doc)) return true;
  return bs_has_linked_slips(doc);
}
window.bs_should_show_report_view = bs_should_show_report_view;

const BS_BACKGROUND_ROW_THRESHOLD = 20;
window.BS_BACKGROUND_ROW_THRESHOLD = BS_BACKGROUND_ROW_THRESHOLD;

frappe.ui.form.on("Bulk Salary Creation", {
  before_save(frm) {
    if (typeof bs_sync_period_from_header === "function" && !window._bs?._lock_batch_period) {
      bs_sync_period_from_header(frm);
    }
    if (typeof bs_sync_source_doc === "function" && window._bs?.frm === frm && window._bs?.source_ctrls) {
      const values = bs_collect_source_values(frm);
      Object.assign(frm.doc, values);
    }
    if (typeof bs_sync_to_frm === "function" && window._bs?.frm === frm && (window._bs?.rows || []).length) {
      bs_sync_to_frm(frm);
    }
    frm.doc.employees = (frm.doc.employees || []).filter((row) => row.employee);
    frm.doc.component_entries = (frm.doc.component_entries || []).filter(
      (row) => row.employee && row.salary_component,
    );
  },
  refresh(frm) {
    frappe.require([
      "/assets/payroll_bulk/js/bulk_salary/utils.js",
      "/assets/payroll_bulk/js/bulk_salary/ui.js",
      "/assets/payroll_bulk/js/bulk_salary/process.js",
      "/assets/payroll_bulk/js/bulk_salary/payment.js",
    ], () => {
      inject_bs_styles();
      bs_hide_standard_form_fields(frm);
      frm.fields_dict.employees && frm.fields_dict.employees.$wrapper.hide();
      if (window._bs?._force_edit_mode && frm.doc.docstatus === 0) {
        window._bs._force_edit_mode = false;
        window._bs.frm = frm;
        bs_bootstrap_main_ui(frm);
        return;
      }
      const was_same_batch = window._bs?.frm?.doc?.name === frm.doc.name && (window._bs?.rows || []).length;
      if (was_same_batch && frm.doc.docstatus === 0 && !bs_should_show_report_view(frm.doc)) {
        window._bs.frm = frm;
        bs_sync_period_from_header(frm);
        bs_merge_saved_rows_from_frm(frm);
        if (typeof bs_restore_source_controls_from_doc === "function") {
          bs_restore_source_controls_from_doc(frm).then(async () => {
            bs_merge_saved_rows_from_frm(frm);
            window._bs.rows.forEach(recalc_row);
            await bs_trigger_source_reload({ force: true });
            if (typeof bs_tidy_form_after_ui === "function") bs_tidy_form_after_ui(frm);
          });
        } else {
          bs_render_table();
          if (typeof bs_tidy_form_after_ui === "function") bs_tidy_form_after_ui(frm);
        }
        return;
      }
      if (frm.doc.docstatus === 1 || bs_should_show_report_view(frm.doc)) {
        render_submitted_view(frm);
      } else {
        bs_bootstrap_main_ui(frm);
      }
    });
  },
});
