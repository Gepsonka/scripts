frappe.listview_settings["Bin"] = {
  onload: function (listview) {
    listview.page.add_button(__("Print Barcodes (QZ Tray)"), function () {
      var selected = listview.get_checked_items();
      if (!selected.length) {
        frappe.msgprint(__("Please select at least one row first."));
        return;
      }

      // Fetch item names for label display, then open dialog
      var item_codes = [...new Set(selected.map(function (r) { return r.item_code; }))];

      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype: "Item",
          filters: [["name", "in", item_codes]],
          fields: ["name", "item_name"],
          limit: item_codes.length,
        },
        callback: function (r) {
          var name_map = {};
          (r.message || []).forEach(function (i) { name_map[i.name] = i.item_name; });

          var items = selected.map(function (row) {
            return {
              item_code: row.item_code,
              item_name: name_map[row.item_code] || row.item_code,
              warehouse: row.warehouse,
              qty: Math.max(1, Math.ceil(parseFloat(row.actual_qty) || 1)),
            };
          });

          _openBinPrintDialog(items, listview);
        },
      });
    });
  },
};

function _openBinPrintDialog(items, listview) {
  // Build checklist — items without barcode_print_date are checked by default
  var rows_html = items.map(function (item, idx) {
    var printed_label = item.barcode_print_date
      ? ' <small style="color:#28a745">(' + __("last: ") + item.barcode_print_date + ")</small>"
      : ' <small style="color:#999">(' + __("never printed") + ")</small>";
    return (
      '<div class="checkbox" style="margin:4px 0">' +
      "<label>" +
      '<input type="checkbox" class="bin-item-check" data-idx="' + idx + '"> ' +
      frappe.utils.escape_html(item.item_code) +
      " — " + frappe.utils.escape_html(item.item_name) +
      " (" + __("qty: ") + item.qty + ")" +
      printed_label +
      "</label>" +
      "</div>"
    );
  });

  var content_html =
    '<div style="margin-bottom:8px">' +
    '<button class="btn btn-xs btn-default" id="bin-check-all">' + __("Check All") + "</button> " +
    '<button class="btn btn-xs btn-default" id="bin-uncheck-all">' + __("Uncheck All") + "</button>" +
    "</div>" +
    '<div style="max-height:400px;overflow-y:auto;border:1px solid #ddd;padding:8px;border-radius:4px">' +
    rows_html.join("") +
    "</div>";

  var d = new frappe.ui.Dialog({
    title: __("Print Barcodes for Selected Bins"),
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
      d.$wrapper.find(".bin-item-check:checked").each(function () {
        selected_indices.push(parseInt($(this).data("idx")));
      });

      if (!selected_indices.length) {
        frappe.msgprint(__("No items selected."));
        return;
      }

      var printer = d.get_value("printer_name");
      var opts = printer ? { printerName: printer } : {};

      var items_to_print = selected_indices.map(function (idx) { return items[idx]; });
      var total = items_to_print.reduce(function (s, i) { return s + i.qty; }, 0);

      d.hide();

      frappe.show_alert({ message: __("Sending {0} label(s) to printer…", [total]), indicator: "blue" });

      QZBarcodeUtils.printBarcodes(items_to_print, opts)
        .then(function () {
          frappe.show_alert({ message: __("{0} label(s) sent to printer.", [total]), indicator: "green" });

          var bin_items = items_to_print.map(function (i) {
            return { item_code: i.item_code, warehouse: i.warehouse };
          });
          frappe.call({
            method: "scripts.api.update_barcode_print_date",
            args: { items: JSON.stringify(bin_items) },
            callback: function () { listview && listview.refresh(); },
          });
        })
        .catch(function (err) {
          frappe.msgprint({
            title: __("Print Error"),
            indicator: "red",
            message: err.message || __("Failed to print. Please check that QZ Tray is running."),
          });
        });
    },
  });

  d.show();

  // Set check states via JS (not HTML attribute — sanitizer may strip it)
  d.$wrapper.find(".bin-item-check").each(function () {
    var item = items[parseInt($(this).data("idx"))];
    $(this).prop("checked", !item.barcode_print_date);
  });

  d.$wrapper.find("#bin-check-all").on("click", function () {
    d.$wrapper.find(".bin-item-check").prop("checked", true);
  });
  d.$wrapper.find("#bin-uncheck-all").on("click", function () {
    d.$wrapper.find(".bin-item-check").prop("checked", false);
  });
}
