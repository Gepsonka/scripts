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
  },

  // When Fazon (style) is selected, auto-fill related data
  custom_fazon: function (frm, cdt, cdn) {
    var row = locals[cdt][cdn];
    if (!row.custom_fazon) return;

    // Fetch Fazon details and auto-fill related fields
    frappe.db.get_value("Fazon", row.custom_fazon, [
      "custom_anyag", "custom_kidolgozasok", "custom_merettabla"
    ], function (r) {
      if (!r) return;
      var changed = false;

      if (r.custom_anyag && row.custom_anyag !== r.custom_anyag) {
        frappe.model.set_value(cdt, cdn, "custom_anyag", r.custom_anyag);
        changed = true;
      }
      if (r.custom_kidolgozasok && row.custom_kidolgozasok !== r.custom_kidolgozasok) {
        frappe.model.set_value(cdt, cdn, "custom_kidolgozasok", r.custom_kidolgozasok);
        changed = true;
      }
      if (r.custom_merettabla && row.custom_merettabla !== r.custom_merettabla) {
        frappe.model.set_value(cdt, cdn, "custom_merettabla", r.custom_merettabla);
        changed = true;
      }
    });
  },

  // When Szett / Csomag changes, offer to copy to other rows with same item_code
  custom_szett: function (frm, cdt, cdn) {
    var row = locals[cdt][cdn];
    if (!row.custom_szett || !row.item_code) return;

    // Optionally auto-fill szett for rows with same item_code
    frm.doc.items.forEach(function (item) {
      if (item.name !== cdn && item.item_code === row.item_code && !item.custom_szett) {
        frappe.model.set_value(item.doctype, item.name, "custom_szett", row.custom_szett);
      }
    });
    refresh_field("items");
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
    "kidolgozasok",
    function (r) {
      if (r && r.kidolgozasok) {
        var row = locals[cdt][cdn];
        if (row.finishing !== r.kidolgozasok) {
          frappe.model.set_value(cdt, cdn, "finishing", r.kidolgozasok);
        }
      }
    }
  );
}
