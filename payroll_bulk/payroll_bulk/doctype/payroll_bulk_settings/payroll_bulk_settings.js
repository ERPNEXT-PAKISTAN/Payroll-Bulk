frappe.ui.form.on("Payroll Bulk Settings", {
  refresh(frm) {
    pb_refresh_source_fields(frm);
  },

  overtime_doctype(frm) {
    pb_refresh_source_fields(frm);
  },

  default_calculation_mode(frm) {
    pb_toggle_source_fields(frm);
  },

  default_per_piece_basis(frm) {
    pb_toggle_source_fields(frm);
  },

  enable_filter_fetch(frm) {
    if (!frm.doc.enable_filter_fetch) {
      frm.set_value({
        show_department_filter: 0,
        show_branch_filter: 0,
        show_designation_filter: 0,
      });
    }
  },

  show_employee_filter(frm) {
    if (!frm.doc.show_employee_filter) {
      frm.set_value("enable_manual_add", 0);
    }
  },
});

async function pb_refresh_source_fields(frm) {
  const doctype_name = frm.doc.overtime_doctype;
  const fields = doctype_name
    ? await frappe.call({
        method: "payroll_bulk.api.get_doctype_field_options",
        args: { doctype_name },
      }).then((r) => r.message || [])
    : [];

  pb_set_field_options(frm, "overtime_employee_field", pb_filter_source_fields(fields, "employee"), "Select employee field");
  pb_set_field_options(frm, "overtime_date_field", pb_filter_source_fields(fields, "date"), "Select date field");
  pb_set_field_options(frm, "overtime_hours_field", pb_filter_source_fields(fields, "number"), "Select total hours field");
  pb_set_field_options(frm, "overtime_qty_field", pb_filter_source_fields(fields, "number"), "Select total qty field");
  pb_set_field_options(frm, "overtime_rate_field", pb_filter_source_fields(fields, "number"), "Select rate per piece field");
  pb_toggle_source_fields(frm);
}

function pb_set_field_options(frm, fieldname, fields, placeholder) {
  const current = frm.doc[fieldname] || "";
  const options = [""].concat((fields || []).map((df) => df.fieldname));
  frm.set_df_property(fieldname, "options", options.join("\n"));
  if (current && !options.includes(current)) {
    frm.set_value(fieldname, "");
  }
  frm.set_df_property(fieldname, "description", placeholder);
}

function pb_filter_source_fields(fields, kind) {
  const by_kind = {
    employee: (df) => (df.fieldtype === "Link" && df.options === "Employee") || ["Data", "Dynamic Link", "Select"].includes(df.fieldtype),
    date: (df) => ["Date", "Datetime"].includes(df.fieldtype),
    number: (df) => ["Float", "Currency", "Int", "Percent"].includes(df.fieldtype),
  };
  return (fields || []).filter((df) => (by_kind[kind] ? by_kind[kind](df) : true));
}

function pb_toggle_source_fields(frm) {
  const piece_mode = frm.doc.default_calculation_mode === "Per Piece or Per Hour";
  const qty_mode = piece_mode && frm.doc.default_per_piece_basis === "Total Qty";

  frm.toggle_display("default_per_piece_basis", piece_mode);
  frm.toggle_display("overtime_qty_field", qty_mode);
  frm.toggle_display("overtime_rate_field", qty_mode);
}
