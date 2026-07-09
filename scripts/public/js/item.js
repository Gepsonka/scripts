// Client script for the standard ERPNext Item doctype.
// Adds a "Print Barcode" button that sends ZPL to the Zebra ZD220 via QZ Tray.

(function () {
  frappe.provide("erpnext.item");

  if (erpnext.item._scripts_form_patch) {
    return;
  }
  erpnext.item._scripts_form_patch = true;

  // Safely read a section from fields_dict, returning its $wrapper or null.
  // This prevents the entire refresh handler chain from aborting with
  // "TypeError: can't access property '$wrapper', ... is undefined"
  // when a field (e.g. stock_levels_html, prices_html) is absent from
  // the production site's Item doctype meta.
  function _safe_section(frm, fieldname) {
    var f = frm.fields_dict && frm.fields_dict[fieldname];
    return f && f.$wrapper ? f.$wrapper : null;
  }

  // --- make_dashboard ---
  erpnext.item.make_dashboard = function (frm) {
    if (frm.doc.__islocal || !frm.doc.is_stock_item) return;

    frappe.require("item-dashboard.bundle.js", function () {
      var section = _safe_section(frm, "stock_levels_html");

      if (!section && frm.dashboard && typeof frm.dashboard.add_section === "function") {
        section = frm.dashboard.add_section("", __("Stock Levels"));
      }

      if (!section) {
        console.warn("Item stock dashboard skipped: stock_levels_html field is missing.");
        return;
      }

      section.empty();

      erpnext.item.item_dashboard = new erpnext.stock.ItemDashboard({
        parent: section,
        item_code: frm.doc.name,
        page_length: 20,
        method: "erpnext.stock.dashboard.item_dashboard.get_data",
        template: "item_dashboard_list",
      });
      erpnext.item.item_dashboard.refresh();
    });
  };

  // --- render_item_prices ---
  erpnext.item.render_item_prices = function (frm) {
    if (frm.doc.__islocal) return;

    var container = _safe_section(frm, "prices_html");
    if (!container) {
      console.warn("Item prices section skipped: prices_html field is missing.");
      return;
    }

    var requested_item = frm.doc.name;

    container.html(
      '<div class="text-muted text-center" style="padding: 20px;">' +
      __("Loading...") +
      "</div>"
    );

    frappe.call({
      method: "erpnext.stock.doctype.item.item.get_item_prices",
      args: { item_code: requested_item },
      callback: function (r) {
        if (requested_item !== frm.doc.name) return;
        if (!r.message) return;

        var data = r.message;
        var html = frappe.render_template("item_prices", {
          prices: data.prices,
          has_more: data.has_more,
          item_code: requested_item,
          stock_uom: frm.doc.stock_uom,
        });

        container.html(html);

        container.find(".add-price-btn").on("click", function () {
          var filters = {};
          if (frm.doc.is_sales_item && !frm.doc.is_purchase_item) {
            filters.selling = 1;
          } else if (frm.doc.is_purchase_item && !frm.doc.is_sales_item) {
            filters.buying = 1;
          }
          frappe.new_doc(
            "Item Price",
            { item_code: requested_item, uom: frm.doc.stock_uom },
            function (dialog) {
              if (Object.keys(filters).length) {
                dialog.fields_dict.price_list.get_query = function () {
                  return { filters: filters };
                };
              }
            }
          );
        });

        container.find(".price-row").on("click", function (e) {
          if ($(e.target).is("a")) return;
          frappe.set_route("Form", "Item Price", $(this).data("name"));
        });
      },
    });
  };
})();

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

function _isFreshQZUtils() {
  if (!window.QZBarcodeUtils || typeof window.QZBarcodeUtils.buildZPL !== "function") {
    return false;
  }

  var src = window.QZBarcodeUtils.buildZPL.toString();
  // Check for NEW code signatures — these only exist in the current version
  return (
    src.indexOf("var barcodeHeight = 65;") !== -1
    || src.indexOf('"^BCN," + barcodeHeight + ",N,N,N,N"') !== -1
  );
}

function _reloadQZUtils() {
  return new Promise(function (resolve, reject) {
    var s = document.createElement("script");
    s.src = "/assets/scripts/js/qz_utils.js?v=" + Date.now();
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error("Failed to reload qz_utils.js")); };
    document.head.appendChild(s);
  });
}

function _ensureFreshQZUtils() {
  if (_isFreshQZUtils()) return Promise.resolve();
  return _reloadQZUtils();
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
              {
                label: __("Label Info"),
                fieldname: "label_info",
                fieldtype: "Data",
                default: frm.doc.label_info || "",
                description: __("Optional text printed under the barcode."),
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

              var selectedPrice =
                values.price !== null && values.price !== undefined && values.price !== ""
                  ? values.price
                  : null;
              var selectedLabelInfo = values.label_info || frm.doc.label_info || null;

              // Use translated item name if available, otherwise fallback
              var translatedName = translationsMap[values.language] || frm.doc.item_name || "";

              _ensureFreshQZUtils()
                .then(function () {
                  frappe.show_alert({
                    message: __("Sending {0} label(s) to printer...", [values.qty]),
                    indicator: "blue",
                  });

                  return QZBarcodeUtils.printBarcodes(
                    [{
                      item_code: item_code,
                      item_name: translatedName,
                      qty: values.qty,
                      price: selectedPrice,
                      currency: values.currency || "HUF",
                      label_info: selectedLabelInfo,
                    }],
                    { printerName: values.printer_name },
                    { [item_code]: translationsMap },
                    values.language
                  );
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
