// Client script for the standard ERPNext Item doctype.
// Adds a "Print Barcode" button that sends ZPL to the Zebra ZD220 via QZ Tray.

var _QZ_SETTINGS_KEY = "qz_printer_settings";

function _loadPrinterSettings() {
  try {
    return JSON.parse(localStorage.getItem(_QZ_SETTINGS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function _savePrinterSettings(values) {
  try {
    localStorage.setItem(
      _QZ_SETTINGS_KEY,
      JSON.stringify({ printer_name: values.printer_name || "" })
    );
  } catch (e) {}
}

// Open a small dialog that lists all printers QZ Tray can see
// and lets the user pick one, which gets written into target_field.
function _showPrinterPicker(target_field) {
  frappe.show_alert({ message: __("Connecting to QZ Tray..."), indicator: "blue" });

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
          target_field.set_value(vals.chosen);
          picker.hide();
        },
      });
      picker.show();
    })
    .catch(function (err) {
      frappe.msgprint({
        title: __("QZ Tray Error"),
        indicator: "red",
        message:
          err.message ||
          __("Could not connect to QZ Tray. Make sure it is running."),
      });
    });
}

frappe.ui.form.on("Item", {
  refresh: function (frm) {
    frm.add_custom_button(__("Print Barcode"), function () {
      var item_code = frm.doc.name;

      if (!item_code || frm.is_new()) {
        frappe.msgprint(__("Please save the item before printing a barcode."));
        return;
      }

      var saved = _loadPrinterSettings();

      var d = new frappe.ui.Dialog({
        title: __("Print Barcode Label"),
        fields: [
          {
            label: __("Item Code"),
            fieldname: "item_code",
            fieldtype: "Data",
            read_only: 1,
            default: item_code,
          },
          {
            label: __("Quantity"),
            fieldname: "qty",
            fieldtype: "Int",
            default: 1,
            reqd: 1,
          },
          {
            label: __("Printer Name"),
            fieldname: "printer_name",
            fieldtype: "Data",
            default: saved.printer_name || "",
            description: __(
              "Exact CUPS printer name. Leave blank to auto-detect Zebra. " +
                "Use the Detect button to list all available printers."
            ),
          },
          {
            label: __("Detect Available Printers"),
            fieldname: "detect_btn",
            fieldtype: "Button",
          },
        ],
        primary_action_label: __("Print"),
        primary_action: function (values) {
          if (!values.qty || values.qty < 1) {
            frappe.msgprint(__("Please enter a valid quantity (minimum 1)."));
            return;
          }

          _savePrinterSettings(values);
          d.hide();

          frappe.show_alert({
            message: __("Sending {0} label(s) to printer...", [values.qty]),
            indicator: "blue",
          });

          QZBarcodeUtils.printBarcode(item_code, values.qty, {
            printerName: values.printer_name,
          })
            .then(function () {
              frappe.show_alert({
                message: __("{0} label(s) sent to printer.", [values.qty]),
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
        },
      });

      // Wire up the Detect button after the dialog renders
      d.get_field("detect_btn").$input.on("click", function () {
        _showPrinterPicker(d.get_field("printer_name"));
      });

      d.show();
    });
  },
});
