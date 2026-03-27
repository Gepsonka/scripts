// Copyright (c) 2026, asd and contributors
// For license information, please see license.txt

// Load ERPNext's SellingController (defines item_code auto-fill, UOM, pricing, etc.)
erpnext.sales_common.setup_selling_controller();

frappe.ui.form.on('Sales Order', {
  refresh: function (frm) {
    if (frm.doc.docstatus === 1) {
      frm.add_custom_button(__('Generate Work Orders'), function () {
        frappe.call({
          method: "scripts.api.generate_work_orders",
          args: {
            sales_order: frm.doc.name
          },
          freeze: true,
          callback: function (r) {
            // Success message is handled by python side
          }
        });
      });

      if (frm.doc.project) {
        frm.add_custom_button(__('Duplicate Sales Order'), function () {
          frappe.prompt([
            {
              label: 'Number of Copies',
              fieldname: 'count',
              fieldtype: 'Int',
              reqd: 1,
              default: 1,
              description: "How many times do you want to duplicate this Sales Order?"
            }
          ], (values) => {
            if (values.count > 0) {
              frappe.call({
                method: "scripts.api.duplicate_sales_orders",
                args: {
                  source_name: frm.doc.name,
                  count: values.count
                },
                freeze: true,
                callback: function (r) {
                  if (r.message) {
                    frappe.msgprint(r.message);
                  }
                }
              });
            }
          }, __('Duplicate Sales Order'), __('Duplicate'));
        });
      }
    }
  },
  setup: function (frm) {
    frm.set_query("fabric", "items", function () {
      return {
        query: "scripts.api.get_fabric_items"
      };
    });
  },

  // Propagate the parent delivery_date to any items that don't have one set
  delivery_date: function (frm) {
    $.each(frm.doc.items || [], function (i, d) {
      if (!d.delivery_date) d.delivery_date = frm.doc.delivery_date;
    });
    refresh_field("items");
  },
});

// Wire up ERPNext's SellingController so it handles item_code auto-fill
// (item_name, UOM, conversion_factor, pricing) for this form
extend_cscript(cur_frm.cscript, new erpnext.selling.SellingController({ frm: cur_frm }));
