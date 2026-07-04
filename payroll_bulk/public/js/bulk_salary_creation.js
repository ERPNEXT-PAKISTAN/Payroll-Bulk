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

const BS_BACKGROUND_ROW_THRESHOLD = 20;
window.BS_BACKGROUND_ROW_THRESHOLD = BS_BACKGROUND_ROW_THRESHOLD;

frappe.ui.form.on("Bulk Salary Creation", {
  before_save(frm) {
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
      const was_same_batch = window._bs?.frm?.doc?.name === frm.doc.name && (window._bs?.rows || []).length;
      if (was_same_batch && frm.doc.docstatus === 0 && !bs_is_completed_batch(frm.doc)) {
        window._bs.frm = frm;
        bs_merge_saved_rows_from_frm(frm);
        if (typeof bs_sync_to_frm === "function") bs_sync_to_frm(frm);
        bs_render_table();
        bs_trigger_source_reload().catch((e) => console.warn("Source reload:", e));
        if (typeof bs_tidy_form_after_ui === "function") bs_tidy_form_after_ui(frm);
        return;
      }
      if (frm.doc.docstatus === 1 || bs_is_completed_batch(frm.doc)) {
        render_submitted_view(frm);
      } else {
        bs_bootstrap_main_ui(frm);
      }
    });
  },
});
