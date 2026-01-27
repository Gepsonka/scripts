frappe.ui.form.on('Project', {
  refresh: function (frm) {
    if (!frm.is_new()) {
      frm.add_custom_button(__('Generate Work Orders for Sales Orders'), function () {
        frappe.confirm(
          __('Are you sure you want to generate Work Orders for all submitted Sales Orders linked to this Project?'),
          function () {
            frappe.call({
              method: 'scripts.api.generate_work_orders_from_project',
              args: {
                project: frm.doc.name
              },
              freeze: true,
              callback: function (r) {
                // Message handled in python
              }
            });
          }
        );
      });
    }
  }
});
