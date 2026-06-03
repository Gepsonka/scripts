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
      JSON.stringify({
        printer_name: values.printer_name || "",
        price_list: values.price_list || "",
        currency: values.currency || "",
        language: values.language || "",
      })
    );
  } catch (e) { }
}

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
        message: err.message || __("Could not connect to QZ Tray. Make sure it is running."),
      });
    });
}

function _fetchItemPrice(item_code, price_list, dialog) {
  if (!price_list) return;
  frappe.call({
    method: "frappe.client.get_value",
    args: {
      doctype: "Item Price",
      filters: { item_code: item_code, price_list: price_list },
      fieldname: "price_list_rate",
    },
    callback: function (r) {
      var rate = r.message && r.message.price_list_rate;
      dialog.set_value("price", rate != null ? rate : "");
    },
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

      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype: "Price List",
          filters: { enabled: 1 },
          fields: ["name", "currency"],
          order_by: "name asc",
          limit_page_length: 100,
        },
        callback: function (r) {
          var priceLists = r.message || [];
          var plOptions = priceLists.map(function (pl) { return pl.name; }).join("\n");
          var plCurrencyMap = {};
          priceLists.forEach(function (pl) { plCurrencyMap[pl.name] = pl.currency; });

          var defaultPL = saved.price_list || (priceLists.length ? priceLists[0].name : "");
          var allCurrencies = priceLists
            .map(function (pl) { return pl.currency; })
            .filter(function (c, i, a) { return c && a.indexOf(c) === i; })
            .sort();
          if (allCurrencies.indexOf("HUF") === -1) allCurrencies.unshift("HUF");
          var defaultCurrency = saved.currency || plCurrencyMap[defaultPL] || "HUF";

          // Default language — prefer Hungarian
          var defaultLang = saved.language || "hu";
          var languageOptions = "hu\nen\nde\nro\nfr\nit\nes";
          var translationsMap = {};

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
              { fieldtype: "Section Break", label: __("Price") },
              {
                label: __("Price List"),
                fieldname: "price_list",
                fieldtype: "Select",
                options: plOptions,
                default: defaultPL,
                onchange: function () {
                  var pl = d.get_value("price_list");
                  d.set_value("currency", plCurrencyMap[pl] || "HUF");
                  _fetchItemPrice(item_code, pl, d);
                },
              },
              {
                label: __("Currency"),
                fieldname: "currency",
                fieldtype: "Select",
                options: allCurrencies.join("\n"),
                default: defaultCurrency,
                reqd: 1,
              },
              {
                label: __("Price"),
                fieldname: "price",
                fieldtype: "Float",
                description: __("Auto-fetched from the selected price list."),
              },
              { fieldtype: "Section Break", label: __("Language") },
              {
                label: __("Label Language"),
                fieldname: "language",
                fieldtype: "Select",
                options: languageOptions,
                default: defaultLang,
                description: __("Item name will be translated to this language on the label."),
              },
              { fieldtype: "Section Break", label: __("Printer") },
              {
                label: __("Printer Name"),
                fieldname: "printer_name",
                fieldtype: "Data",
                default: saved.printer_name || "",
                description: __("Exact CUPS printer name. Leave blank to auto-detect Zebra."),
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

              // Use translated item name if available, otherwise fallback
              var translatedName = translationsMap[values.language] || frm.doc.item_name || "";

              frappe.show_alert({
                message: __("Sending {0} label(s) to printer...", [values.qty]),
                indicator: "blue",
              });

              QZBarcodeUtils.printBarcodes(
                [{
                  item_code: item_code,
                  item_name: translatedName,
                  qty: values.qty,
                  price: values.price || null,
                  currency: values.currency || "HUF",
                  label_info: frm.doc.label_info || null,
                }],
                { printerName: values.printer_name }
              )
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
                    message: err.message || __("Failed to print."),
                  });
                });
            },
          });

          d.get_field("detect_btn").$input.on("click", function () {
            _showPrinterPicker(d.get_field("printer_name"));
          });

          d.show();

          // Fetch translations for the default language
          frappe.call({
            method: "scripts.api.get_item_translations",
            args: { item_code: item_code, languages: "hu,en,de,ro,fr,it,es" },
            callback: function (r) {
              translationsMap = r.message || {};
              // Auto-display translated name if the default language has one
              var initialLang = d.get_value("language");
              if (translationsMap[initialLang] && translationsMap[initialLang] !== frm.doc.item_name) {
                // Optionally show the translated name — currently we just store it
              }
            },
          });

          if (defaultPL) {
            _fetchItemPrice(item_code, defaultPL, d);
          }
        },
      });
    });
  },
});
