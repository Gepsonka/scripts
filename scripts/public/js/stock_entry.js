/**
 * Stock Entry – Print Barcode Labels button.
 *
 * Adds a "Print Barcode Labels" button to every Stock Entry form.
 * Clicking it opens a dialog showing all items in the stock entry
 * (preserving the order of the items table) and sends the labels
 * to the Zebra printer via QZ Tray.
 */

frappe.ui.form.on("Stock Entry", {
  refresh: function (frm) {
    // Only show the button when the document has items
    if (!frm.doc.items || !frm.doc.items.length) return;

    frm.add_custom_button(__("Print Barcode Labels"), function () {
      _showStockEntryBarcodeDialog(frm);
    });
  },
});

// ── Settings persistence ──────────────────────────────────────────────────
var _SE_SETTINGS_KEY = "stock_entry_barcode_printer_settings";

function _loadSettings() {
  try { return JSON.parse(localStorage.getItem(_SE_SETTINGS_KEY)) || {}; }
  catch (e) { return {}; }
}
function _saveSettings(vals) {
  try { localStorage.setItem(_SE_SETTINGS_KEY, JSON.stringify(vals)); }
  catch (e) { /* ignore */ }
}

// ── Translation loader ────────────────────────────────────────────────────
function _loadTranslations(itemCodes) {
  if (!itemCodes || !itemCodes.length) return Promise.resolve({});
  return new Promise(function (resolve) {
    frappe.call({
      method: "scripts.api.get_item_translations_batch",
      args: {
        item_codes: itemCodes.join(","),
      },
      callback: function (r) {
        resolve(r.message || {});
      },
      error: function () {
        resolve({});
      },
    });
  });
}

// ── Main dialog ───────────────────────────────────────────────────────────
function _showStockEntryBarcodeDialog(frm) {
  var saved = _loadSettings();

  // Build the item list in the SAME ORDER as the Stock Entry items table
  var stockItems = frm.doc.items.map(function (row) {
    return {
      item_code: row.item_code,
      item_name: row.item_name || row.item_code,
      qty: Math.max(1, Math.floor(Math.abs(row.qty || row.transfer_qty || 1))),
      warehouse: row.s_warehouse || row.t_warehouse || "",
    };
  });

  if (!stockItems.length) {
    frappe.msgprint(__("No items to print."));
    return;
  }

  // ── Build the item checklist HTML ──────────────────────────────────
  var rowsHtml = stockItems.map(function (item, idx) {
    return (
      '<div class="checkbox" style="margin:2px 0">' +
      "<label>" +
      '<input type="checkbox" class="se-barcode-check" checked data-idx="' + idx + '"> ' +
      frappe.utils.escape_html(item.item_code) +
      " — " + frappe.utils.escape_html(item.item_name) +
      ' <small style="color:#888">(' + __("Qty: {0}", [item.qty]) + ")</small>" +
      "</label>" +
      "</div>"
    );
  });

  var contentHtml =
    '<div style="margin-bottom:8px">' +
    '<button class="btn btn-xs btn-default" id="se-check-all">' + __("Check All") + "</button> " +
    '<button class="btn btn-xs btn-default" id="se-uncheck-all">' + __("Uncheck All") + "</button>" +
    "</div>" +
    '<div style="max-height:350px;overflow-y:auto;border:1px solid #ddd;padding:8px;border-radius:4px">' +
    rowsHtml.join("") +
    "</div>";

  var d = new frappe.ui.Dialog({
    title: __("Print Barcode Labels – {0}", [frm.doc.name]),
    fields: [
      { fieldtype: "HTML", options: contentHtml },
      { fieldtype: "Section Break", label: __("Printer") },
      {
        fieldname: "printer_name",
        label: __("Printer Name"),
        fieldtype: "Data",
        default: saved.printer_name || "",
        description: __("Exact CUPS printer name. Leave blank to auto-detect Zebra printer."),
      },
      {
        label: __("Detect Available Printers"),
        fieldname: "detect_btn",
        fieldtype: "Button",
      },
      { fieldtype: "Section Break", label: __("Language") },
      {
        fieldname: "language",
        label: __("Label Language"),
        fieldtype: "Select",
        options: "hu\nen\nde\nro\nfr\nit\nes",
        default: saved.language || "hu",
        description: __("Item name translation language on labels."),
      },
    ],
    primary_action_label: __("Print"),
    primary_action: function () {
      var selected = [];
      d.$wrapper.find(".se-barcode-check:checked").each(function () {
        var idx = parseInt($(this).data("idx"));
        if (idx >= 0 && idx < stockItems.length) {
          var item = stockItems[idx];
          selected.push({
            item_code: item.item_code,
            item_name: item.item_name,
            qty: item.qty,
            warehouse: item.warehouse,
            currency: "",
          });
        }
      });

      if (!selected.length) {
        frappe.msgprint(__("No items selected."));
        return;
      }

      var printer = d.get_value("printer_name");
      var language = d.get_value("language") || "hu";

      _saveSettings({ printer_name: printer, language: language });

      d.hide();

      // Load translations for selected items, then print
      var itemCodes = selected.map(function (s) { return s.item_code; });
      _loadTranslations(itemCodes).then(function (translations) {
        // Wait for QZBarcodeUtils to be available
        _ensureQZUtils().then(function () {
          frappe.show_alert({
            message: __("Sending {0} label(s) to printer…", [selected.length]),
            indicator: "blue",
          });

          QZBarcodeUtils.printBarcodes(
            selected,
            printer ? { printerName: printer } : {},
            translations,
            language
          ).then(function () {
            frappe.show_alert({
              message: __("{0} label(s) printed successfully.", [selected.length]),
              indicator: "green",
            });

            // Update printed counter on the backend
            _updatePrintCount(selected);
          }).catch(function (err) {
            frappe.msgprint({
              title: __("Print Error"),
              indicator: "red",
              message: err.message || __("Failed to print. Make sure QZ Tray is running."),
            });
          });
        }).catch(function (err) {
          frappe.msgprint({
            title: __("QZ Tray Error"),
            indicator: "red",
            message: err.message || __("Could not connect to QZ Tray."),
          });
        });
      });
    },
  });

  // ── Dialog event handlers ──────────────────────────────────────────
  d.$wrapper.on("click", "#se-check-all", function () {
    d.$wrapper.find(".se-barcode-check").prop("checked", true);
  });
  d.$wrapper.on("click", "#se-uncheck-all", function () {
    d.$wrapper.find(".se-barcode-check").prop("checked", false);
  });

  // Printer detection button
  d.fields_dict.detect_btn.$input.on("click", function () {
    _ensureQZUtils().then(function () {
      frappe.show_alert({ message: __("Connecting to QZ Tray…"), indicator: "blue" });
      QZBarcodeUtils.listPrinters()
        .then(function (printers) {
          if (!Array.isArray(printers)) printers = [printers];
          if (!printers.length) {
            frappe.msgprint(__("No printers found via QZ Tray."));
            return;
          }
          var picker = new frappe.ui.Dialog({
            title: __("Select Printer"),
            fields: [
              {
                label: __("Printer"),
                fieldname: "chosen",
                fieldtype: "Select",
                options: printers.join("\n"),
                default: printers[0],
                reqd: 1,
              },
            ],
            primary_action_label: __("Select"),
            primary_action: function (vals) {
              d.set_value("printer_name", vals.chosen);
              picker.hide();
            },
          });
          picker.show();
        })
        .catch(function (err) {
          frappe.msgprint({
            title: __("QZ Tray Error"),
            indicator: "red",
            message: err.message || __("Could not connect to QZ Tray."),
          });
        });
    });
  });

  d.show();
}

// ── QZ Utils lazy loader ──────────────────────────────────────────────────
var _qzUtilsLoadPromise = null;

function _ensureQZUtils() {
  if (window.QZBarcodeUtils) return Promise.resolve();
  if (_qzUtilsLoadPromise) return _qzUtilsLoadPromise;

  _qzUtilsLoadPromise = new Promise(function (resolve, reject) {
    // qz_utils.js is already included via app_include_js,
    // but ensure it's fully loaded
    var check = function () {
      if (window.QZBarcodeUtils) {
        resolve();
      } else {
        setTimeout(check, 200);
      }
    };
    check();
    // Timeout after 10 seconds
    setTimeout(function () {
      if (!window.QZBarcodeUtils) {
        reject(new Error("QZ Tray utilities did not load in time."));
      }
    }, 10000);
  });

  return _qzUtilsLoadPromise;
}

// ── Backend print-count updater ───────────────────────────────────────────
function _updatePrintCount(items) {
  frappe.call({
    method: "scripts.api.update_barcode_print_date",
    args: {
      items: items.map(function (item) {
        return {
          item_code: item.item_code,
          warehouse: item.warehouse,
          count: item.qty,
        };
      }),
    },
    async: true,
  });
}
