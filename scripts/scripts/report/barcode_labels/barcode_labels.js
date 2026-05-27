frappe.query_reports["Barcode Labels"] = {
  filters: [
    {
      fieldname: "warehouse",
      label: __("Warehouse"),
      fieldtype: "Link",
      options: "Warehouse",
    },
    {
      fieldname: "item_group",
      label: __("Item Group"),
      fieldtype: "Link",
      options: "Item Group",
    },
  ],

  // Render a print button in the "Print" column for each row.
  formatter: function (value, row, column, data, default_formatter) {
    if (column.fieldname === "print_btn") {
      return (
        '<button class="btn btn-xs btn-primary qz-print-row" ' +
        'data-item="' + frappe.utils.escape_html(data.item_code) + '" ' +
        'data-name="' + frappe.utils.escape_html(data.item_name || "") + '" ' +
        'data-warehouse="' + frappe.utils.escape_html(data.warehouse) + '" ' +
        'data-printed="' + (data.is_printed ? "1" : "0") + '">' +
        __("Print") +
        "</button>"
      );
    }
    if (column.fieldname === "is_printed") {
      return value
        ? '<span style="color:#28a745">&#10003; ' + __("Printed") + "</span>"
        : '<span style="color:#999">' + __("Not printed") + "</span>";
    }
    if (column.fieldname === "barcode_print_date") {
      if (value) {
        return '<span style="color:#28a745">' + frappe.utils.escape_html(value) + "</span>";
      }
      return '<span style="color:#999">—</span>';
    }
    return default_formatter(value, row, column, data);
  },

  onload: function (report) {
    // ── Toolbar: Print Selected (checklist dialog) ────────────────────────
    report.page.add_button(__("Print Selected (QZ Tray)"), function () {
      var data = report.data;
      if (!data || !data.length) {
        frappe.msgprint(__("No data to print."));
        return;
      }

      // Build checklist HTML — checked state set via JS after show()
      var rows_html = data.map(function (r, idx) {
        var status_label = r.is_printed
          ? ' <small style="color:#28a745">' + __("(printed)") + "</small>"
          : ' <small style="color:#999">' + __("(not printed)") + "</small>";
        return (
          '<div class="checkbox" style="margin:2px 0">' +
          "<label>" +
          '<input type="checkbox" class="barcode-item-check" data-idx="' + idx + '"> ' +
          frappe.utils.escape_html(r.item_code) +
          " — " + frappe.utils.escape_html(r.item_name) +
          status_label +
          "</label>" +
          "</div>"
        );
      });

      var content_html =
        '<div style="margin-bottom:8px">' +
        '<button class="btn btn-xs btn-default" id="check-all-btn">' + __("Check All") + "</button> " +
        '<button class="btn btn-xs btn-default" id="uncheck-all-btn">' + __("Uncheck All") + "</button> " +
        '<button class="btn btn-xs btn-default" id="check-unprinted-btn">' + __("Check Unprinted Only") + "</button>" +
        "</div>" +
        '<div style="max-height:400px;overflow-y:auto;border:1px solid #ddd;padding:8px;border-radius:4px">' +
        rows_html.join("") +
        "</div>";

      var d = new frappe.ui.Dialog({
        title: __("Select Items to Print Barcodes"),
        fields: [
          { fieldtype: "HTML", options: content_html },
          {
            fieldname: "printer_name",
            label: __("Printer"),
            fieldtype: "Data",
            default: (typeof QZBarcodeUtils !== "undefined" && QZBarcodeUtils.defaultPrinter) || "",
          },
        ],
        primary_action_label: __("Print"),
        primary_action: function () {
          var selected_indices = [];
          d.$wrapper.find(".barcode-item-check:checked").each(function () {
            selected_indices.push(parseInt($(this).data("idx")));
          });

          if (!selected_indices.length) {
            frappe.msgprint(__("No items selected."));
            return;
          }

          var printer = d.get_value("printer_name");
          var items_to_print = selected_indices.map(function (idx) {
            var r = data[idx];
            return { item_code: r.item_code, item_name: r.item_name, warehouse: r.warehouse, qty: 1, is_printed: r.is_printed };
          });

          d.hide();

          frappe.show_alert({ message: __("Sending {0} label(s) to printer…", [items_to_print.length]), indicator: "blue" });

          QZBarcodeUtils.printBarcodes(items_to_print, printer ? { printerName: printer } : {})
            .then(function () {
              frappe.show_alert({ message: __("{0} label(s) sent to printer.", [items_to_print.length]), indicator: "green" });

              // Build increments: count newly-printed (not previously printed) per item+warehouse
              var increments = {};
              items_to_print.forEach(function (i) {
                if (!i.is_printed) {
                  var key = i.item_code + "|||" + i.warehouse;
                  increments[key] = (increments[key] || 0) + 1;
                }
              });
              var bin_items = Object.keys(increments).map(function (key) {
                var parts = key.split("|||");
                return { item_code: parts[0], warehouse: parts[1], count: increments[key] };
              });

              if (bin_items.length) {
                frappe.call({
                  method: "scripts.api.update_barcode_print_date",
                  args: { items: JSON.stringify(bin_items) },
                  callback: function () { report.refresh(); },
                });
              } else {
                report.refresh();
              }
            })
            .catch(function (err) {
              frappe.msgprint({ title: __("Print Error"), indicator: "red", message: err.message || __("Failed to print. Please check that QZ Tray is running.") });
            });
        },
      });

      d.show();

      // Apply checked state via JS — unprinted rows checked by default
      d.$wrapper.find(".barcode-item-check").each(function () {
        var r = data[parseInt($(this).data("idx"))];
        $(this).prop("checked", !r.is_printed);
      });

      // Helper buttons
      d.$wrapper.find("#check-all-btn").on("click", function () {
        d.$wrapper.find(".barcode-item-check").prop("checked", true);
      });
      d.$wrapper.find("#uncheck-all-btn").on("click", function () {
        d.$wrapper.find(".barcode-item-check").prop("checked", false);
      });
      d.$wrapper.find("#check-unprinted-btn").on("click", function () {
        d.$wrapper.find(".barcode-item-check").each(function () {
          var r = data[parseInt($(this).data("idx"))];
          $(this).prop("checked", !r.is_printed);
        });
      });
    });

    // ── Event delegation: per-row Print button ────────────────────────────
    // Use $(document) — Frappe DataTable intercepts cell clicks before they reach report.wrapper
    $(document).on("click", ".qz-print-row", function () {
      var itemCode = $(this).data("item");
      var itemName = $(this).data("name") || "";
      var warehouse = $(this).data("warehouse");
      var wasPrinted = $(this).data("printed") === "1" || $(this).data("printed") === 1;

      frappe.show_alert({ message: __("Printing label for {0}…", [itemCode]), indicator: "blue" });

      QZBarcodeUtils.printBarcode(itemCode, 1, {}, itemName)
        .then(function () {
          frappe.show_alert({ message: __("Label sent to printer.", []), indicator: "green" });
          if (!wasPrinted) {
            frappe.call({
              method: "scripts.api.update_barcode_print_date",
              args: { items: JSON.stringify([{ item_code: itemCode, warehouse: warehouse, count: 1 }]) },
              callback: function () { frappe.query_report.refresh(); },
            });
          } else {
            frappe.query_report.refresh();
          }
        })
        .catch(function (err) {
          frappe.msgprint({ title: __("Print Error"), indicator: "red", message: err.message || __("Failed to print. Please check that QZ Tray is running.") });
        });
    });
  },
};
