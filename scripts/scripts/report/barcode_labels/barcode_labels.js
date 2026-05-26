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
      var qty = Math.max(1, Math.ceil(data.actual_qty) || 1);
      return (
        '<button class="btn btn-xs btn-primary qz-print-row" ' +
        'data-item="' +
        frappe.utils.escape_html(data.item_code) +
        '" ' +
        'data-qty="' +
        qty +
        '">' +
        __("Print") +
        "</button>"
      );
    }
    return default_formatter(value, row, column, data);
  },

  onload: function (report) {
    // ── Toolbar: Print all visible rows via QZ Tray ───────────────────────
    report.page.add_inner_button(__("Print All (QZ Tray)"), function () {
      var data = report.data;
      if (!data || !data.length) {
        frappe.msgprint(__("No data to print."));
        return;
      }

      var items = data.map(function (r) {
        return {
          item_code: r.item_code,
          qty: Math.max(1, Math.ceil(r.actual_qty) || 1),
        };
      });

      var total = items.reduce(function (sum, i) {
        return sum + i.qty;
      }, 0);

      frappe.confirm(
        __("Print {0} barcode label(s) for {1} item(s)?", [total, items.length]),
        function () {
          frappe.show_alert({ message: __("Sending to printer…"), indicator: "blue" });
          QZBarcodeUtils.printBarcodes(items)
            .then(function () {
              frappe.show_alert({
                message: __("{0} label(s) sent to printer.", [total]),
                indicator: "green",
              });
            })
            .catch(function (err) {
              frappe.msgprint({
                title: __("Print Error"),
                indicator: "red",
                message:
                  err.message ||
                  __("Failed to print. Please check that QZ Tray is running."),
              });
            });
        }
      );
    });

    // ── Event delegation: per-row Print button ────────────────────────────
    $(report.wrapper).on("click", ".qz-print-row", function () {
      var itemCode = $(this).data("item");
      var qty = parseInt($(this).data("qty")) || 1;

      frappe.show_alert({
        message: __("Printing {0} label(s) for {1}…", [qty, itemCode]),
        indicator: "blue",
      });

      QZBarcodeUtils.printBarcode(itemCode, qty)
        .then(function () {
          frappe.show_alert({
            message: __("{0} label(s) sent to printer.", [qty]),
            indicator: "green",
          });
        })
        .catch(function (err) {
          frappe.msgprint({
            title: __("Print Error"),
            indicator: "red",
            message:
              err.message ||
              __("Failed to print. Please check that QZ Tray is running."),
          });
        });
    });
  },
};
