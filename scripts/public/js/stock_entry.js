/**
 * Stock Entry – Print Barcode Labels button.
 *
 * Adds a "Print Barcode Labels" button to every Stock Entry form.
 * Wrapped in an IIFE to avoid polluting global scope and interfering
 * with other doctype scripts (e.g. Item form).
 */
(function () {
  "use strict";

  var _SE_SETTINGS_KEY = "stock_entry_barcode_printer_settings";

  function _loadSettings() {
    try { return JSON.parse(localStorage.getItem(_SE_SETTINGS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function _saveSettings(vals) {
    try { localStorage.setItem(_SE_SETTINGS_KEY, JSON.stringify(vals)); }
    catch (e) { /* ignore */ }
  }

  // ── Translation loader ────────────────────────────────────────────────
  function _loadTranslations(itemCodes) {
    if (!itemCodes || !itemCodes.length) return Promise.resolve({});
    return new Promise(function (resolve) {
      frappe.call({
        method: "scripts.api.get_item_translations_batch",
        args: { item_codes: itemCodes.join(",") },
        callback: function (r) { resolve(r.message || {}); },
        error: function () { resolve({}); },
      });
    });
  }

  // ── Batch price fetcher ───────────────────────────────────────────────
  function _fetchItemPrices(items, priceList) {
    if (!priceList || !items.length) return Promise.resolve({});
    var codes = [], seen = {};
    items.forEach(function (item) {
      if (!Object.prototype.hasOwnProperty.call(seen, item.item_code)) {
        seen[item.item_code] = true;
        codes.push(item.item_code);
      }
    });
    return new Promise(function (resolve) {
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype: "Item Price",
          filters: [["item_code", "in", codes], ["price_list", "=", priceList]],
          fields: ["item_code", "price_list_rate"],
          limit_page_length: codes.length + 10,
        },
        callback: function (r) {
          var prices = {};
          (r.message || []).forEach(function (row) {
            if (row.price_list_rate != null) prices[row.item_code] = row.price_list_rate;
          });
          resolve(prices);
        },
        error: function () { resolve({}); },
      });
    });
  }

  // ── Backend print-count updater ───────────────────────────────────────
  function _updatePrintCount(items) {
    frappe.call({
      method: "scripts.api.update_barcode_print_date",
      args: {
        items: items.map(function (item) {
          return { item_code: item.item_code, warehouse: item.warehouse, count: item.qty };
        }),
      },
      async: true,
    });
  }

  // ── QZ Utils lazy loader (with freshness check) ───────────────────────
  var _qzLoadPromise = null;

  function _isFresh() {
    if (!window.QZBarcodeUtils || typeof window.QZBarcodeUtils.buildZPL !== "function") return false;
    return window.QZBarcodeUtils.buildZPL.toString().indexOf("var barcodeHeight = 65;") !== -1;
  }

  function _reloadQZ() {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "/assets/scripts/js/qz_utils.js?v=" + Date.now();
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Failed to reload qz_utils.js")); };
      document.head.appendChild(s);
    });
  }

  function _ensureQZ() {
    if (_isFresh()) return Promise.resolve();
    if (_qzLoadPromise) return _qzLoadPromise;
    _qzLoadPromise = _reloadQZ();
    return _qzLoadPromise;
  }

  // ── Build dialog ──────────────────────────────────────────────────────
  function _buildDialog(frm, stockItems, saved, plOptions, plCurrencyMap, allCurrencies, defaultPL, defaultCurrency) {
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
      '<div style="max-height:300px;overflow-y:auto;border:1px solid #ddd;padding:8px;border-radius:4px">' +
      rowsHtml.join("") +
      "</div>";

    var d = new frappe.ui.Dialog({
      title: __("Print Barcode Labels – {0}", [frm.doc.name]),
      fields: [
        { fieldtype: "HTML", options: contentHtml },
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
              label_info: item.label_info || "",
            });
          }
        });

        if (!selected.length) {
          frappe.msgprint(__("No items selected."));
          return;
        }

        var printer = d.get_value("printer_name");
        var language = d.get_value("language") || "hu";
        var priceList = d.get_value("price_list");
        var currency = d.get_value("currency") || "HUF";

        _saveSettings({
          printer_name: printer,
          language: language,
          price_list: priceList,
          currency: currency,
        });

        d.hide();

        _fetchItemPrices(selected, priceList).then(function (prices) {
          selected.forEach(function (item) {
            item.currency = currency;
            item.price = prices[item.item_code] != null ? prices[item.item_code] : null;
          });

          var itemCodes = selected.map(function (s) { return s.item_code; });
          _loadTranslations(itemCodes).then(function (translations) {
            _ensureQZ().then(function () {
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
        });
      },
    });

    d.$wrapper.on("click", "#se-check-all", function () {
      d.$wrapper.find(".se-barcode-check").prop("checked", true);
    });
    d.$wrapper.on("click", "#se-uncheck-all", function () {
      d.$wrapper.find(".se-barcode-check").prop("checked", false);
    });

    d.fields_dict.detect_btn.$input.on("click", function () {
      _ensureQZ().then(function () {
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
              fields: [{
                label: __("Printer"),
                fieldname: "chosen",
                fieldtype: "Select",
                options: printers.join("\n"),
                default: printers[0],
                reqd: 1,
              }],
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

  // ── Register the button on Stock Entry form ───────────────────────────
  frappe.ui.form.on("Stock Entry", {
    refresh: function (frm) {
      if (!frm.doc.items || !frm.doc.items.length) return;

      frm.add_custom_button(__("Print Barcode Labels"), function () {
        var saved = _loadSettings();

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

        var itemCodes = stockItems.map(function (it) { return it.item_code; });
        frappe.call({
          method: "frappe.client.get_list",
          args: {
            doctype: "Item",
            filters: [["name", "in", itemCodes]],
            fields: ["name", "label_info"],
            limit_page_length: itemCodes.length + 10,
          },
          callback: function (r) {
            var labelInfoMap = {};
            (r.message || []).forEach(function (row) {
              if (row.label_info) labelInfoMap[row.name] = row.label_info;
            });
            stockItems.forEach(function (item) {
              item.label_info = labelInfoMap[item.item_code] || "";
            });

            frappe.call({
              method: "frappe.client.get_list",
              args: {
                doctype: "Price List",
                filters: { enabled: 1 },
                fields: ["name", "currency"],
                order_by: "name asc",
                limit_page_length: 100,
              },
              callback: function (r2) {
                var priceLists = r2.message || [];
                var plCurrencyMap = {};
                priceLists.forEach(function (pl) { plCurrencyMap[pl.name] = pl.currency; });

                var plOptions = priceLists.map(function (pl) { return pl.name; }).join("\n");
                var defaultPL = saved.price_list || (priceLists.length ? priceLists[0].name : "");
                var allCurrencies = priceLists
                  .map(function (pl) { return pl.currency; })
                  .filter(function (c, i, a) { return c && a.indexOf(c) === i; })
                  .sort();
                if (allCurrencies.indexOf("HUF") === -1) allCurrencies.unshift("HUF");
                var defaultCurrency = saved.currency || plCurrencyMap[defaultPL] || "HUF";

                _buildDialog(frm, stockItems, saved, plOptions, plCurrencyMap, allCurrencies, defaultPL, defaultCurrency);
              },
            });
          },
        });
      });
    },
  });

})();
