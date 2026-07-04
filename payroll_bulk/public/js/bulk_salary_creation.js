// Bulk Salary Creation — form entry point (loads desk UI modules).
const BS_COMPLETED_STATUSES = ["Completed", "Completed With Errors"];

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
      frm.fields_dict.employees && frm.fields_dict.employees.$wrapper.hide();
      if (frm.doc.docstatus === 1 || bs_is_completed_batch(frm.doc)) {
        render_submitted_view(frm);
      } else {
        bs_bootstrap_main_ui(frm);
      }
    });
  },
});
