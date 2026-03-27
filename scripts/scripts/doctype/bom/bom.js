// Copyright (c) 2026, asd and contributors
// For license information, please see license.txt

frappe.ui.form.on('BOM', {
  setup: function (frm) {
    frm.set_query("main_fabric", function () {
      return {
        filters: {
          "item_group": "Anyagok"
        }
      };
    });
  }
});
