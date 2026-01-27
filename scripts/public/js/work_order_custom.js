frappe.ui.form.on('Work Order', {
  refresh: function (frm) {
    // Define has_reservation at the top level of the function
    let has_reservation = frm.doc.custom_reservation_log && frm.doc.custom_reservation_log.length > 0;

    // MOST MÁR Draft (0) és Submitted (1) állapotban is engedjük
    // De Cancelled (2)-ben nem.
    if (frm.doc.docstatus < 2 && frm.doc.status !== "Completed") {

      // Van-e már foglalás?
      // let has_reservation = frm.doc.custom_reservation_log && frm.doc.custom_reservation_log.length > 0;

      // Gomb felirat és szín logika
      let label = '';
      let btn_class = '';

      if (has_reservation) {
        // Ha van foglalás, de a WO Draft, akkor ez "Frissítés" lesz
        if (frm.doc.docstatus === 0) {
          label = __('Foglalás Frissítése'); // Revert + New Reserve
          btn_class = 'btn-warning'; // Narancs szín a figyelemfelkeltéshez
        } else {
          // Ha Submitted és van foglalás, akkor inkább Visszavonást kínálunk fel
          // (De dönthetsz úgy is, hogy itt is engeded a frissítést)
          label = __('Foglalás Visszavonása');
          btn_class = 'btn-danger';
        }
      } else {
        label = __('Anyagok Lefoglalása');
        btn_class = 'btn-primary';
      }

      // GOMB HOZZÁADÁSA
      frm.add_custom_button(label, function () {

        // Ha Visszavonás (Csak Submitted állapotban, meglévő foglalásnál)
        if (has_reservation && frm.doc.docstatus === 1) {
          frappe.confirm('Biztosan vissza akarja mozgatni az anyagokat?', function () {
            call_api('scripts.api.cancel_physical_reservation', { wo_name: frm.doc.name });
          });
        }
        // Ha Foglalás vagy Frissítés (Draft vagy Üres Submitted)
        else {
          let fields = [
            {
              label: 'Cél Raktár',
              fieldname: 'target_warehouse',
              fieldtype: 'Link',
              options: 'Warehouse',
              reqd: 1
            }
          ];

          if (has_reservation) {
            fields.push({
              label: 'Előző foglalás törlése (Teljes újragenerálás)',
              fieldname: 'reset_reservation',
              fieldtype: 'Check',
              default: 0,
              description: 'Ha be van pipálva, a rendszer visszavonja a jelenlegi foglalást és újra lefoglal mindent. Ha nincs, csak a hiányzó tételeket foglalja le.'
            });
          }

          let d = new frappe.ui.Dialog({
            title: has_reservation ? 'Foglalás Frissítése' : 'Fizikai Foglalás',
            fields: fields,
            primary_action_label: has_reservation ? 'Frissítés' : 'Lefoglalás',
            primary_action: function (values) {
              d.hide();

              let method = 'scripts.api.create_physical_reservation';
              // Ha van foglalás ÉS NEM kértük a resetet, akkor update (additive)
              if (has_reservation && !values.reset_reservation) {
                method = 'scripts.api.update_physical_reservation';
              }

              call_api(method, {
                wo_name: frm.doc.name,
                target_warehouse: values.target_warehouse
              });
            }
          });

          d.fields_dict.target_warehouse.get_query = function () {
            return {
              filters: {
                'is_group': 0
              }
            };
          };

          d.show();
        }

      }).addClass(btn_class);
    }


    let label = "Foglalas torlese"
    let btn_class = "btn-primary"

    let btn = frm.add_custom_button(label, function () {
      frappe.confirm("Biztonsan torolni akarod a foglalast?", () => {
        call_api("scripts.api.cancel_physical_reservation", { wo_name: frm.doc.name })
      })
    })

    if (!has_reservation) {
      btn.prop('disabled', true)
    } else {
      btn.addClass(btn_class)
    }

    frm.add_custom_button(__('Copy Finishing Details'), function () {
      frappe.call({
        method: "scripts.api.get_related_work_orders",
        args: { wo_name: frm.doc.name },
        freeze: true,
        callback: function (r) {
          if (!r.message || r.message.length === 0) {
            frappe.msgprint(__("No other Work Orders found for this Item and Sales Order."));
            return;
          }

          let work_orders = r.message;

          let d = new frappe.ui.Dialog({
            title: __('Select Work Orders'),
            fields: [
              {
                fieldtype: 'HTML',
                fieldname: 'wo_list'
              }
            ],
            primary_action_label: __('Copy to Selected'),
            primary_action: function () {
              let selected_wos = [];
              d.$wrapper.find('.wo-checkbox:checked').each(function () {
                selected_wos.push($(this).val());
              });

              if (selected_wos.length === 0) {
                frappe.msgprint(__("Please select at least one Work Order."));
                return;
              }

              frappe.confirm(__("Copy finishing details to {0} Work Orders? This will overwrite existing details.", [selected_wos.length]), () => {
                call_copy_api(selected_wos);
                d.hide();
              });
            }
          });

          let html = `
            <style>
              .wo-select-table th, .wo-select-table td { padding: 8px; }
              .wo-select-table { width: 100%; border-collapse: collapse; }
              .wo-select-table thead { background-color: var(--control-bg); font-weight: bold; }
            </style>
            <div style="max-height: 400px; overflow-y: auto;">
              <table class="wo-select-table table table-bordered table-hover">
                <thead>
                  <tr>
                    <th style="width: 30px; text-align: center;"><input type="checkbox" id="select-all-wos"></th>
                    <th>${__("Work Order")}</th>
                    <th>${__("Status")}</th>
                    <th>${__("Qty")}</th>
                  </tr>
                </thead>
                <tbody>
          `;

          work_orders.forEach(wo => {
            html += `
              <tr>
                <td style="text-align: center;"><input type="checkbox" class="wo-checkbox" value="${wo.name}"></td>
                <td><a href="/app/work-order/${wo.name}" target="_blank">${wo.name}</a></td>
                <td>${wo.status}</td>
                <td>${wo.qty}</td>
              </tr>
            `;
          });

          html += `</tbody></table></div>`;

          d.fields_dict.wo_list.$wrapper.html(html);

          d.$wrapper.on('change', '#select-all-wos', function () {
            let checked = $(this).prop('checked');
            d.$wrapper.find('.wo-checkbox').prop('checked', checked);
          });

          d.add_custom_action(__('Copy to All'), () => {
            frappe.confirm(__("Copy finishing details to ALL {0} related Work Orders? This will overwrite existing details.", [work_orders.length]), () => {
              call_copy_api(null);
              d.hide();
            });
          });

          d.show();

          function call_copy_api(targets) {
            frappe.call({
              method: "scripts.api.copy_finishing_details",
              args: {
                wo_name: frm.doc.name,
                targets: targets
              },
              freeze: true,
              callback: function (r) {
                // Message handled in python
              }
            });
          }
        }
      });
    });

  }
});


// frappe.ui.form.on("Work Order", {
//   refresh: function (frm) {
//     if (frm.doc.docstatus < 2 && frm.doc.status !== "Completed") {
//       let has_reservation = frm.doc.custom_reservation_log && frm.dov.custom_reservation_log.length > 0



//     }
//   }
// })

// Segédfüggvény a híváshoz
function call_api(method, args) {
  frappe.call({
    method: method,
    args: args,
    freeze: true,
    freeze_message: "Készlet művelet folyamatban...",
    callback: function (r) {
      if (r.message && r.message.status === "success") {
        frappe.msgprint(r.message.message);
        cur_frm.reload_doc();
      } else {
        frappe.msgprint({
          title: 'Hiba / Info',
          message: r.message ? r.message.message : "Hiba történt",
          indicator: r.message && r.message.status === "info" ? "orange" : "red"
        });
      }
    }
  });
}