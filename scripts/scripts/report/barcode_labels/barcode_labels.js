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
        'data-printed="' + (data.is_printed ? "1" : "0") + '" ' +
        'data-labelinfo="' + frappe.utils.escape_html(data.label_info || "") + '">' +
        __("Print") +
        "</button>"
      );
    }
    if (column.fieldname === "is_printed") {
      return value
        ? '<span style="color:#28a745">&#10003; ' + __("Printed") + "</span>"
        : '<span style="color:#999">' + __("Not printed") + "</span>";
    }
    return default_formatter(value, row, column, data);
  },

  onload: function (report) {
    var _QZ_SETTINGS_KEY = "qz_printer_settings";

    function _loadSettings() {
      try { return JSON.parse(localStorage.getItem(_QZ_SETTINGS_KEY)) || {}; }
      catch (e) { return {}; }
    }
    function _saveSettings(vals) {
      try {
        localStorage.setItem(_QZ_SETTINGS_KEY, JSON.stringify({
          printer_name: vals.printer_name || "",
          price_list: vals.price_list || "",
          currency: vals.currency || "",
          language: vals.language || "hu",
        }));
      } catch (e) { }
    }

    // Fetch enabled price lists once on load
    var _priceLists = [];
    var _plCurrencyMap = {};
    var _allCurrencies = ["HUF"];
    var _plOptions = "";

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
        _priceLists = r.message || [];
        _priceLists.forEach(function (pl) { _plCurrencyMap[pl.name] = pl.currency; });
        _plOptions = _priceLists.map(function (pl) { return pl.name; }).join("\n");
        _allCurrencies = _priceLists
          .map(function (pl) { return pl.currency; })
          .filter(function (c, i, a) { return c && a.indexOf(c) === i; })
          .sort();
        if (_allCurrencies.indexOf("HUF") === -1) _allCurrencies.unshift("HUF");
      },
    });

    // ── Toolbar: Print Selected (checklist dialog) ────────────────────────
    report.page.add_button(__("Print Selected (QZ Tray)"), function () {
      var data = report.data;
      if (!data || !data.length) {
        frappe.msgprint(__("No data to print."));
        return;
      }

      var saved = _loadSettings();
      var defaultPL = saved.price_list || (_priceLists.length ? _priceLists[0].name : "");
      var defaultCurrency = saved.currency || _plCurrencyMap[defaultPL] || "HUF";

      // Build checklist HTML
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
          { fieldtype: "Section Break", label: __("Price") },
          {
            fieldname: "price_list",
            label: __("Price List"),
            fieldtype: "Select",
            options: _plOptions,
            default: defaultPL,
            onchange: function () {
              var pl = d.get_value("price_list");
              d.set_value("currency", _plCurrencyMap[pl] || "HUF");
            },
          },
          {
            fieldname: "currency",
            label: __("Currency"),
            fieldtype: "Select",
            options: _allCurrencies.join("\n"),
            default: defaultCurrency,
            reqd: 1,
          },
          { fieldtype: "Section Break", label: __("Printer") },
          {
            fieldname: "printer_name",
            label: __("Printer"),
            fieldtype: "Data",
            default: saved.printer_name || "",
            description: __("Exact CUPS printer name. Leave blank to auto-detect Zebra."),
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
            description: __("Item name will be translated to this language on the label."),
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

          var price_list = d.get_value("price_list");
          var currency = d.get_value("currency") || "HUF";
          var printer = d.get_value("printer_name");
          var language = d.get_value("language") || "hu";

          _saveSettings({ printer_name: printer, price_list: price_list, currency: currency, language: language });

          var items_to_print = selected_indices.map(function (idx) {
            var r = data[idx];
            return { item_code: r.item_code, item_name: r.item_name, warehouse: r.warehouse, qty: 1, is_printed: r.is_printed, currency: currency, label_info: r.label_info || "" };
          });

          d.hide();

          function _doPrint(items, translations) {
            _ensureFreshQZUtils()
              .then(function () {
                frappe.show_alert({ message: __("Sending {0} label(s) to printer…", [items.length]), indicator: "blue" });
                return QZBarcodeUtils.printBarcodes(items, printer ? { printerName: printer } : {}, translations, language);
              })
              .then(function () {
                frappe.show_alert({ message: __("{0} label(s) sent to printer.", [items.length]), indicator: "green" });

                var increments = {};
                items.forEach(function (i) {
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
          }

          // Fetch translations for all selected items
          var item_codes = items_to_print.map(function (i) { return i.item_code; });
          frappe.call({
            method: "scripts.api.get_item_translations_batch",
            args: { item_codes: item_codes.join(","), languages: "hu,en,de,ro,fr,it,es" },
            callback: function (r) {
              var translations = r.message || {};

              if (price_list) {
                frappe.call({
                  method: "frappe.client.get_list",
                  args: {
                    doctype: "Item Price",
                    filters: [["item_code", "in", item_codes], ["price_list", "=", price_list]],
                    fields: ["item_code", "price_list_rate"],
                    limit_page_length: 500,
                  },
                  callback: function (r2) {
                    var priceMap = {};
                    (r2.message || []).forEach(function (p) { priceMap[p.item_code] = p.price_list_rate; });
                    items_to_print.forEach(function (i) { i.price = priceMap[i.item_code] || null; });
                    _doPrint(items_to_print, translations);
                  },
                });
              } else {
                _doPrint(items_to_print, translations);
              }
            },
          });
        },
      });

      d.get_field("detect_btn").$input.on("click", function () {
        _showPrinterPicker(d.get_field("printer_name"));
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

    // ── Shared helpers (same logic as the Item form Print Barcode button) ────
    function _isFreshQZUtils() {
      if (!window.QZBarcodeUtils || typeof window.QZBarcodeUtils.buildZPL !== "function") {
        return false;
      }
      var src = window.QZBarcodeUtils.buildZPL.toString();
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

    // ── Event delegation: per-row Print button ────────────────────────────
    if (window._qzBarcodeRowHandler) {
      document.removeEventListener("click", window._qzBarcodeRowHandler, true);
    }
    window._qzBarcodeRowHandler = function (e) {
      var btn = e.target.closest(".qz-print-row");
      if (!btn) return;
      e.stopPropagation();

      var itemCode = btn.getAttribute("data-item");
      var itemName = btn.getAttribute("data-name") || "";
      var warehouse = btn.getAttribute("data-warehouse");
      var wasPrinted = btn.getAttribute("data-printed") === "1";
      var rowLabelInfo = btn.getAttribute("data-labelinfo") || "";

      var saved = _loadSettings();
      var defaultPL = saved.price_list || (_priceLists.length ? _priceLists[0].name : "");
      var defaultCurrency = saved.currency || _plCurrencyMap[defaultPL] || "HUF";
      var defaultLang = saved.language || "hu";

      // Same dialog as the Item form Print Barcode button
      var d = new frappe.ui.Dialog({
        title: __("Print Barcode Label"),
        fields: [
          {
            label: __("Item Code"),
            fieldname: "item_code",
            fieldtype: "Data",
            read_only: 1,
            default: itemCode,
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
            options: _plOptions,
            default: defaultPL,
            onchange: function () {
              var pl = d.get_value("price_list");
              d.set_value("currency", _plCurrencyMap[pl] || "HUF");
              _fetchItemPrice(itemCode, pl, d);
            },
          },
          {
            label: __("Currency"),
            fieldname: "currency",
            fieldtype: "Select",
            options: _allCurrencies.join("\n"),
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
            options: "hu\nen\nde\nro\nfr\nit\nes",
            default: defaultLang,
            description: __("Item name will be translated to this language on the label."),
          },
          {
            label: __("Label Info"),
            fieldname: "label_info",
            fieldtype: "Data",
            default: rowLabelInfo,
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
          _saveSettings(values);
          d.hide();

          var selectedPrice =
            values.price !== null && values.price !== undefined && values.price !== ""
              ? values.price
              : null;
          var selectedLabelInfo = values.label_info || rowLabelInfo;

          var translationsMap = {};

          // Fetch translations for this item
          frappe.call({
            method: "scripts.api.get_item_translations",
            args: { item_code: itemCode, languages: "hu,en,de,ro,fr,it,es" },
            callback: function (r) {
              translationsMap = r.message || {};
              var translatedName = translationsMap[values.language] || itemName;

              _ensureFreshQZUtils()
                .then(function () {
                  frappe.show_alert({
                    message: __("Sending {0} label(s) to printer...", [values.qty]),
                    indicator: "blue",
                  });

                  return QZBarcodeUtils.printBarcodes(
                    [{
                      item_code: itemCode,
                      item_name: translatedName,
                      qty: values.qty,
                      price: selectedPrice,
                      currency: values.currency || "HUF",
                      label_info: selectedLabelInfo,
                    }],
                    { printerName: values.printer_name },
                    { [itemCode]: translationsMap },
                    values.language
                  );
                })
                .then(function () {
                  frappe.show_alert({
                    message: __("{0} label(s) sent to printer.", [values.qty]),
                    indicator: "green",
                  });
                  if (!wasPrinted) {
                    frappe.call({
                      method: "scripts.api.update_barcode_print_date",
                      args: { items: JSON.stringify([{ item_code: itemCode, warehouse: warehouse, count: values.qty }]) },
                      callback: function () { frappe.query_report.refresh(); },
                    });
                  } else {
                    frappe.query_report.refresh();
                  }
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
        },
      });

      d.get_field("detect_btn").$input.on("click", function () {
        _showPrinterPicker(d.get_field("printer_name"));
      });

      d.show();

      // Fetch translations for the default language (for preview)
      frappe.call({
        method: "scripts.api.get_item_translations",
        args: { item_code: itemCode, languages: "hu,en,de,ro,fr,it,es" },
        callback: function () { },  // silently cache
      });

      if (defaultPL) {
        _fetchItemPrice(itemCode, defaultPL, d);
      }
    };
    document.addEventListener("click", window._qzBarcodeRowHandler, true);
  },
};
