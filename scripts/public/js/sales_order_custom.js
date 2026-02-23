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

    frm.set_query("fabric", "items", function (doc, cdt, cdn) {
      return {
        filters: {
          "item_group": ["descendants of", "Anyagok"]
        }
      };
    });

  }
});
