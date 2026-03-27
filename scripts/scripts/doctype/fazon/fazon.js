// Copyright (c) 2026, asd and contributors
// For license information, please see license.txt

frappe.ui.form.on("Fazon", {
  refresh(frm) {
    // Get Products lft/rgt and set the query dynamically
    frappe.call({
      method: "frappe.client.get_value",
      args: {
        doctype: "Item Group",
        filters: { name: "Products" },
        fieldname: ["lft", "rgt"]
      },
      callback: function (r) {
        if (r.message) {
          frm.set_query("type", function () {
            return {
              filters: [
                ["Item Group", "lft", ">", r.message.lft],
                ["Item Group", "rgt", "<", r.message.rgt]
              ]
            };
          });
        }
      }
    });
  }
});
