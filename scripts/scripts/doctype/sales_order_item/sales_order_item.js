// Copyright (c) 2026, asd and contributors
// For license information, please see license.txt

frappe.ui.form.on('Sales Order Item', {
  item_code: function (frm, cdt, cdn) {
    var row = locals[cdt][cdn];
    if (!row.item_code) return;

    // Set delivery_date from parent (mirrors ERPNext Sales Order behaviour)
    if (frm.doc.delivery_date) {
      row.delivery_date = frm.doc.delivery_date;
      refresh_field("delivery_date", cdn, "items");
    } else {
      frm.script_manager.copy_from_first_row("items", row, ["delivery_date"]);
    }

    // item_name / UOM / conversion_factor are filled by SellingController
    // (TransactionController.item_code → get_item_details)

    // Fabric/BOM lookup for Products group items
    frappe.db.get_value("Item", row.item_code, "item_group", function (r) {
      if (!r || r.item_group !== "Products") return;
      if (row.fabric) {
        lookup_bom_for_fabric(frm, cdt, cdn, row.item_code, row.fabric);
      }
    });
  },

  // When a row's delivery_date changes, propagate to all rows if no parent date
  delivery_date: function (frm, cdt, cdn) {
    if (!frm.doc.delivery_date) {
      erpnext.utils.copy_value_in_all_rows(frm.doc, cdt, cdn, "items", "delivery_date");
    }
  },


  fabric: function (frm, cdt, cdn) {
    var row = locals[cdt][cdn];
    if (!row.item_code || !row.fabric) return;

    frappe.db.get_value("Item", row.item_code, "item_group", function (r) {
      if (!r || r.item_group !== "Products") return;
      lookup_bom_for_fabric(frm, cdt, cdn, row.item_code, row.fabric);
    });
  }
});

function lookup_bom_for_fabric(frm, cdt, cdn, item_code, fabric) {
  frappe.db.get_value(
    "BOM",
    {
      "item": item_code,
      "main_fabric": fabric,
      "is_active": 1,
      "docstatus": 1
    },
    "default_finishing",
    function (r) {
      if (r && r.default_finishing) {
        var row = locals[cdt][cdn];
        if (row.finishing !== r.default_finishing) {
          frappe.model.set_value(cdt, cdn, "finishing", r.default_finishing);
        }
      }
    }
  );
}
