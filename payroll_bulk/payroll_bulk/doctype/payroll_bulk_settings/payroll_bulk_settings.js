frappe.ui.form.on("Payroll Bulk Settings", {
  refresh(frm) {
    pb_bind_doctype_query(frm);
    pb_refresh_source_fields(frm);
    pb_bind_component_rule_query(frm);
    pb_bind_component_queries(frm);
    pb_toggle_source_fields(frm);
    if (!frm.is_new()) {
      frm.add_custom_button(__("Load Components from Structures"), async () => {
        const company = frm.doc.company || frappe.defaults.get_default("company");
        frappe.dom.freeze(__("Loading components from salary structures..."));
        try {
          await frappe.call({
            method: "payroll_bulk.api.sync_payroll_bulk_component_rules",
            args: { company },
          });
          await frm.reload_doc();
          frappe.show_alert({
            message: __("Component rules loaded from salary structures"),
            indicator: "green",
          }, 4);
        } finally {
          frappe.dom.unfreeze();
        }
      });
    }
  },

  overtime_doctype(frm) {
    pb_refresh_source_fields(frm);
  },

  default_calculation_mode(frm) {
    pb_sync_legacy_piece_flags(frm);
    pb_toggle_source_fields(frm);
  },

  default_per_piece_basis(frm) {
    pb_sync_legacy_piece_flags(frm);
  },

  default_overtime_source(frm) {
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

function pb_bind_doctype_query(frm) {
  frm.set_query("overtime_doctype", () => ({
    filters: {
      issingle: 0,
    },
  }));
}

function pb_bind_component_rule_query(frm) {
  const grid = frm.get_field("component_rules")?.grid;
  if (!grid) return;
  grid.get_field("salary_component").get_query = function () {
    return {
      filters: {
        disabled: 0,
      },
    };
  };
}

function pb_bind_component_queries(frm) {
  ["hours_component", "qty_component"].forEach((fieldname) => {
    frm.set_query(fieldname, () => ({
      filters: {
        disabled: 0,
        type: "Earning",
      },
    }));
  });
}

async function pb_refresh_source_fields(frm) {
  const doctype_name = frm.doc.overtime_doctype;
  const fields = doctype_name
    ? await frappe.call({
        method: "payroll_bulk.api.get_doctype_field_options",
        args: { doctype_name },
      }).then((r) => r.message || [])
    : [];

  pb_set_field_options(frm, "overtime_employee_field", pb_filter_source_fields(fields, "employee"), "Employee Field");
  pb_set_field_options(frm, "overtime_date_field", pb_filter_source_fields(fields, "date"), "Date Field");
  pb_set_field_options(frm, "overtime_hours_field", pb_filter_source_fields(fields, "number"), "Hours Field");
  pb_set_field_options(frm, "overtime_qty_field", pb_filter_source_fields(fields, "number"), "Qty Field");
  pb_set_field_options(frm, "overtime_rate_field", pb_filter_source_fields(fields, "rate"), "Rate Field");
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
  return (fields || []).filter((df) => (by_kind[kind] ? by_kind[kind](df) : true));
}

function pb_sync_legacy_piece_flags(frm) {
  const basis = frm.doc.default_per_piece_basis || "Total Hours";
  frm.set_value({
    default_use_hours: basis === "Total Hours" ? 1 : 0,
    default_use_qty: basis === "Total Qty" ? 1 : 0,
  });
}

function pb_toggle_source_fields(frm) {
  const mode = frm.doc.default_calculation_mode || "Manual";
  const ot_source = frm.doc.default_overtime_source || "Manual";
  const piece_mode = mode === "Per Piece or Per Hour";
  const show_source = ot_source === "Custom DocType" || piece_mode;

  frm.toggle_display("default_manual_salary_basis", mode === "Manual");
  frm.toggle_display("default_per_piece_basis", piece_mode);

  ["overtime_doctype", "overtime_employee_field", "overtime_date_field", "overtime_hours_field"].forEach((fieldname) => {
    frm.toggle_display(fieldname, show_source);
  });
  frm.toggle_display("overtime_qty_field", show_source && piece_mode);
  frm.toggle_display("overtime_rate_field", show_source && piece_mode);
}
