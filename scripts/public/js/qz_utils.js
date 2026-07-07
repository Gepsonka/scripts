/**
 * QZ Tray utility for Zebra ZD220 (and compatible) barcode printing.
 *
 * Prerequisites on the client machine:
 *  1. QZ Tray must be installed and running.
 *  2. In QZ Tray settings → Security, enable "Allow unsigned" (for internal/development use).
 *
 * TWO connection modes are supported:
 *
 *  A) TCP/IP direct  (RECOMMENDED – bypasses the OS print driver entirely)
 *     Pass opts.tcpHost = "<printer IP>" (e.g. "192.168.1.100").
 *     The printer must be reachable on TCP port 9100 (ZPL raw port).
 *     This is the fix when the printer outputs raw ZPL text instead of a barcode.
 *
 *  B) OS printer queue  (fallback)
 *     Leave tcpHost blank; pass opts.printerName or let it auto-detect.
 *     Requires the Zebra ZPL driver to be installed in Windows/Linux.
 *
 * QZ Tray JS is loaded lazily from CDN on first use.
 */
window.QZBarcodeUtils = (function () {
  "use strict";

  var QZ_CDN = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";

  // ── Library loading ──────────────────────────────────────────────────────
  function loadQZScript() {
    if (window.qz) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = QZ_CDN;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("Failed to load QZ Tray library from CDN."));
      };
      document.head.appendChild(s);
    });
  }

  // ── Security ─────────────────────────────────────────────────────────────
  //
  // Two modes:
  //
  //  A) SIGNED (recommended for production — no dialog ever)
  //     1. Generate a key pair:
  //          openssl genrsa -out private-key.pem 2048
  //          openssl req -new -x509 -key private-key.pem -out digital-certificate.txt -days 3650
  //     2. Place digital-certificate.txt in:
  //          apps/scripts/scripts/public/digital-certificate.txt
  //        It will be served at /assets/scripts/digital-certificate.txt
  //     3. Store the private key in site config:
  //          bench --site <site> set-config qz_private_key "$(awk 'NF {sub(/\r/, ""); printf "%s\n", $0}' private-key.pem)"
  //     4. Install digital-certificate.txt in QZ Tray:
  //          Tray icon → Preferences → Advanced → Site Certificate → import file.
  //
  //  B) UNSIGNED (development / internal only)
  //     If the k3s secret is not mounted, enable "Allow unsigned" in QZ Tray:
  //          Tray icon → Preferences → Advanced → uncheck "Block unsigned requests"

  function setupSecurity() {
    // Fetch the certificate from the server (reads from k3s secret mount).
    // Falls back to unsigned mode if the endpoint returns empty.
    qz.security.setCertificatePromise(function (resolve) {
      frappe.call({
        method: "scripts.api.qz_certificate",
        callback: function (r) { resolve(r.message || ""); },
        error: function () { resolve(""); }
      });
    });

    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(function (toSign) {
      return function (resolve, reject) {
        frappe.call({
          method: "scripts.api.qz_sign",
          args: { challenge: toSign },
          callback: function (r) { resolve(r.message || ""); },
          error: function () { resolve(""); }
        });
      };
    });
  }

  // ── Connection ───────────────────────────────────────────────────────────
  function connect() {
    return loadQZScript().then(function () {
      if (qz.websocket.isActive()) return;
      setupSecurity();
      return qz.websocket.connect().catch(function () {
        return Promise.reject(
          new Error(
            "Could not connect to QZ Tray. " +
            "Please make sure QZ Tray is installed and running, " +
            'then enable \"Allow unsigned\" in QZ Tray → Advanced → Security.'
          )
        );
      });
    });
  }

  // ── ZPL builder ─────────────────────────────────────────────────────────
  /**
   * Build a ZPL II label string for a Zebra ZD220 at 203 DPI.
   *
   * Default media: 60 mm × 35 mm
   *   ^PW480  → 480 dots wide   (60 mm × 8 dots/mm)
   *   ^LL280  → 280 dots tall   (35 mm × 8 dots/mm)
   *
   * Label layout (203 DPI, 60 mm × 35 mm):
   *   Item name   → centered, font 28×28
   *   Barcode     → Code 128, 60 dots tall, HRI below
   *   Item code   → small centered text below barcode
   *   Price       → bottom-left, font 22×22
   *   Label info  → below item code, centered, font 22×22, translatable via translations[language + "_info"]
   *
   * @param {string} itemCode    Any non-empty string (ZPL control chars ^ and ~ are stripped).
   * @param {number} qty         Number of copies (uses ^PQ).
   * @param {string} [itemName]  Optional item name to print above the barcode.
   * @param {number|string} [price]    Optional price value.
   * @param {string} [currency]  Currency code: "RON", "HUF", or "EUR".
   * @param {string} [labelInfo] Optional label info (style/size/colour) printed below price.
   * @returns {string}           ZPL label string.
   * @throws {Error}            If itemCode is empty after sanitisation.
   */
  function buildZPL(itemCode, qty, itemName, price, currency, labelInfo, translations, language) {
    qty = Math.max(1, Math.floor(qty) || 1);
    var code = String(itemCode).replace(/[\^~]/g, "").trim();

    // Resolve item name: try translation, then original, then item code
    var name = itemName ? String(itemName).replace(/[\^~]/g, "").trim() : "";
    if (translations && language && translations[language]) {
      name = translations[language].replace(/[\^~]/g, "").trim();
    }
    if (!name) {
      name = code;
    }

    // Resolve label info: try translation, then original
    var info = labelInfo ? String(labelInfo).replace(/[\^~]/g, "").trim() : "";
    if (translations && language && translations.label_info && translations.label_info[language]) {
      info = String(translations.label_info[language]).replace(/[\^~]/g, "").trim();
    }

    // ── Format price string ───────────────────────────────────────────
    var priceText = "";
    if (price !== null && price !== undefined && price !== "") {
      var numPrice = parseFloat(price);
      if (!isNaN(numPrice)) {
        var parts = numPrice.toFixed(2).split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        priceText = parts.join(".") + (currency ? " " + currency : "");
      }
    }

    var label =
      "^XA" +
      "^LH0,0" +                       // reset label-home offset
      "^PW480" +                       // label width  (60 mm = 480 dots)
      "^LL240";                        // label length (30 mm = 240 dots at 203 DPI)

    // ── Label info (centered, top, big font) ────────────────────
    if (info) {
      label +=
        "^FO0,2" +
        "^A0N,32,32" +
        "^FB480,1,0,C,0" +
        "^FD" + info + "^FS";
    }

    // ── Barcode (centered, no built-in HRI) ──────────────────────
    var barcodeHeight = 65;
    var barcodeY = info ? 36 : 2;
    var barcodeWidth = Math.floor(480 * 0.66); // 66% of label width = 317 dots
    var barcodeMargin = Math.floor((480 - barcodeWidth) / 2) + 11; // center + 11 right shift
    label +=
      "^FO" + barcodeMargin + "," + barcodeY +
      "^BY2.5,3.0," + barcodeHeight +
      "^BCN," + barcodeHeight + ",N,N,N,N" +
      "^FD" + code + "^FS";

    // ── Item code text (explicit, centered, below barcode) ───────
    var codeY = barcodeY + barcodeHeight + 4;
    label +=
      "^FO0," + codeY +
      "^A0N,24,24" +
      "^FB480,1,0,C,0" +
      "^FD" + code + "^FS";

    // ── Item name (centered below item code, small font) ─────────
    var nameY = codeY + 28;
    if (name) {
      label +=
        "^FO0," + nameY +
        "^A0N,24,24" +
        "^FB480,1,0,C,0" +
        "^FD" + name + "^FS";
    }

    // ── Price (bottom-left, a few points from edge) ──────────────
    if (priceText) {
      label +=
        "^FO12,172" +
        "^A0N,26,26" +
        "^FB460,1,0,L,0" +
        "^FD" + priceText + "^FS";
    }

    label +=
      "^PQ" + qty +
      "^XZ";

    return label;
  }


  // // ── ZPL builder ─────────────────────────────────────────────────────────
  // /**
  //  * Build a ZPL II label string for a Zebra ZD220 at 203 DPI.
  //  *
  //  * Default media: 60 mm × 35 mm
  //  *   ^PW480  → 480 dots wide   (60 mm × 8 dots/mm)
  //  *   ^LL280  → 280 dots tall   (35 mm × 8 dots/mm)
  //  *
  //  * Label layout (203 DPI, 60 mm × 35 mm):
  //  *   Item name   → centered, font 28×28
  //  *   Barcode     → Code 128, 60 dots tall, HRI below
  // *   Item code   → native ^BC interpretation line (HRI) below barcode
  //  *   Price       → bottom-left, font 22×22
  //  *   Label info  → below item code, centered, font 22×22, translatable via translations[language + "_info"]
  //  *
  //  * @param {string} itemCode    Any non-empty string (ZPL control chars ^ and ~ are stripped).
  //  * @param {number} qty         Number of copies (uses ^PQ).
  //  * @param {string} [itemName]  Optional item name to print above the barcode.
  //  * @param {number|string} [price]    Optional price value.
  //  * @param {string} [currency]  Currency code: "RON", "HUF", or "EUR".
  //  * @param {string} [labelInfo] Optional label info (style/size/colour) printed below price.
  //  * @returns {string}           ZPL label string.
  //  * @throws {Error}            If itemCode is empty after sanitisation.
  //  */
  // function buildZPL(itemCode, qty, itemName, price, currency, labelInfo, translations, language) {
  //   qty = Math.max(1, Math.floor(qty) || 1);
  //   var code = String(itemCode).replace(/[\^~]/g, "").trim();

  //   // Resolve item name: try translation, then original, then item code
  //   var name = itemName ? String(itemName).replace(/[\^~]/g, "").trim() : "";
  //   if (translations && language && translations[language]) {
  //     name = translations[language].replace(/[\^~]/g, "").trim();
  //   }
  //   if (!name) {
  //     name = code;
  //   }

  //   // Resolve label info: try translation, then original
  //   var info = labelInfo ? String(labelInfo).replace(/[\^~]/g, "").trim() : "";
  //   if (translations && language && translations.label_info && translations.label_info[language]) {
  //     info = String(translations.label_info[language]).replace(/[\^~]/g, "").trim();
  //   }

  //   // ── Format price string ───────────────────────────────────────────
  //   var priceText = "";
  //   if (price !== null && price !== undefined && price !== "") {
  //     var numPrice = parseFloat(price);
  //     if (!isNaN(numPrice)) {
  //       var parts = numPrice.toFixed(2).split(".");
  //       parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  //       priceText = parts.join(".") + (currency ? " " + currency : "");
  //     }
  //   }

  //   var label =
  //     "^XA" +
  //     "^LH0,0" +                       // reset label-home offset
  //     "^PW480" +                       // label width  (60 mm = 480 dots)
  //     "^LL280";                        // label length (35 mm = 280 dots)

  //   // ── Item name (centered, top) ───────────────────────────────────
  //   if (name) {
  //     var currentY = 0;
  //     label +=
  //       "^FO0," + currentY +
  //       "^A0N,28,28" +
  //       "^FB480,1,0,C,0" +
  //       "^FD" + name + "^FS";
  //   }

  //   // ── Barcode (centered, 60% width) ─────────────────────────────────
  //   var barcodeHeight = 135;
  //   var barcodeY = 24;
  //   var barcodeWidth = Math.floor(480 * 0.6); // 60% of label width = 288 dots
  //   var barcodeMargin = Math.floor((480 - barcodeWidth) / 2); // center: 96 dots
  //   label +=
  //     "^FO" + barcodeMargin + "," + barcodeY +
  //     "^BY3,3.0," + barcodeHeight +
  //     "^BCN," + barcodeHeight + ",Y,N" +
  //     "^FD" + code + "^FS";

  //   // ── Label info (centered; placed clear of ^BC HRI text) ───────
  //   if (info) {
  //     var infoY = barcodeY + barcodeHeight + 34;
  //     label +=
  //       "^FO0," + infoY +
  //       "^A0N,22,22" +
  //       "^FB480,1,0,C,0" +
  //       "^FD" + info + "^FS";
  //   }

  //   // ── Price (bottom-left) ────────────────────────────────────────
  //   if (priceText) {
  //     label +=
  //       "^FO0,256" +
  //       "^A0N,24,24" +
  //       "^FB460,1,0,L,0" +
  //       "^FD" + priceText + "^FS";
  //   }

  //   label +=
  //     "^PQ" + qty +
  //     "^XZ";

  //   return label;
  // }

  // ── Config factory ───────────────────────────────────────────────────────
  /**
   * Resolve a QZ Tray print config from opts.
   *
   * @param {object|string} opts
   *   string         → treated as printerName (backward compat)
   *   opts.tcpHost   → direct TCP/IP connection (bypasses OS driver)
   *   opts.tcpPort   → TCP port, defaults to 9100
   *   opts.printerName → named OS printer queue
   * @returns {Promise<object>} QZ Tray config
   */
  function resolveConfig(opts) {
    if (!opts) opts = {};
    if (typeof opts === "string") opts = { printerName: opts };

    // ── TCP/IP mode ──
    if (opts.tcpHost && opts.tcpHost.trim()) {
      var endpoint = { host: opts.tcpHost.trim(), port: opts.tcpPort || 9100 };
      return Promise.resolve(qz.configs.create(endpoint));
    }

    // ── OS printer queue mode ──
    var printerName = opts.printerName && opts.printerName.trim();
    var printerPromise;
    if (printerName) {
      printerPromise = qz.printers.find(printerName);
    } else {
      // Auto-detect by common Zebra name fragments
      printerPromise = qz.printers
        .find("Zebra")
        .catch(function () { return null; })
        .then(function (p) {
          if (p && (!Array.isArray(p) || p.length > 0)) return Array.isArray(p) ? p[0] : p;
          return qz.printers.find("ZD").catch(function () { return null; });
        })
        .then(function (p) {
          if (p && (!Array.isArray(p) || p.length > 0)) return Array.isArray(p) ? p[0] : p;
          return qz.printers.getDefault();
        });
    }
    return printerPromise.then(function (printer) {
      return qz.configs.create(printer);
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────
  /**
   * Print one item's barcode label.
   *
   * @param {string} itemCode
   * @param {number} qty
   * @param {string|object} [opts]  printerName string, or options object:
   *                                  { printerName, tcpHost, tcpPort }
   * @param {string} [itemName]     Optional item name to print above the barcode.
   * @param {number|string} [price] Optional price to display on the label.
   * @param {string} [currency]     Currency code: "RON", "HUF", or "EUR".
   * @returns {Promise}
   */
  function printBarcode(itemCode, qty, opts, itemName, price, currency) {
    return connect()
      .then(function () { return resolveConfig(opts); })
      .then(function (config) {
        return qz.print(config, [{ type: "raw", format: "command", data: buildZPL(itemCode, qty, itemName, price, currency) }]);
      });
  }

  /**
   * Print barcodes for multiple items in sequence.
   *
   * @param {Array<{item_code: string, qty: number, item_name?: string, price?: number, currency?: string, label_info?: string}>} items
   * @param {string|object} [opts]
   * @returns {Promise}
   */
  function printBarcodes(items, opts, translations, language) {
    return connect()
      .then(function () { return resolveConfig(opts); })
      .then(function (config) {
        // Aggregate items with the same item_code + currency so we use ^PQ<n> for copies
        // instead of repeating the same ZPL block N times.
        var seen = {};
        var aggregated = [];
        items.forEach(function (item) {
          var key = item.item_code + "|" + (item.currency || "");
          if (Object.prototype.hasOwnProperty.call(seen, key)) {
            aggregated[seen[key]].qty += (item.qty || 1);
          } else {
            seen[key] = aggregated.length;
            aggregated.push({
              item_code: item.item_code,
              item_name: item.item_name || "",
              qty: item.qty || 1,
              price: item.price,
              currency: item.currency || "",
              label_info: item.label_info || "",
            });
          }
        });

        // Build one concatenated ZPL string and send as a single print job
        var zpl = aggregated.map(function (item) {
          var itemTrans = (translations && typeof translations === 'object' && !Array.isArray(translations))
            ? (translations[item.item_code] || {})
            : {};
          return buildZPL(item.item_code, item.qty, item.item_name, item.price, item.currency, item.label_info, itemTrans, language);
        }).join("");
        return qz.print(config, [{ type: "raw", format: "command", data: zpl }]);
      });
  }

  /**
   * List all printers visible to QZ Tray.
   * @returns {Promise<string[]>}
   */
  function listPrinters() {
    return connect().then(function () {
      return qz.printers.find(); // no argument → all printers
    });
  }

  /**
   * Fetch which of the supported currencies (RON, HUF, EUR) have a price
   * defined in the Item Price list for the given item.
   *
   * Only currencies with price_list_rate > 0 are returned, so the caller can
   * disable/hide the others in the currency selector.
   *
   * @param {string} itemCode
   * @returns {Promise<Array<{currency: string, price: number, price_list: string}>>}
   *   Resolves to an array of objects for each available currency, e.g.:
   *   [ { currency: "RON", price: 12.50, price_list: "Standard Selling" }, ... ]
   */
  function getAvailableCurrencies(itemCode) {
    return new Promise(function (resolve, reject) {
      frappe.call({
        method: "frappe.client.get_list",
        args: {
          doctype: "Item Price",
          filters: [
            ["item_code", "=", itemCode],
            ["currency", "in", ["RON", "HUF", "EUR"]],
            ["price_list_rate", ">", 0],
          ],
          fields: ["currency", "price_list_rate", "price_list"],
          limit: 100,
        },
        callback: function (r) {
          if (!r || !r.message) { resolve([]); return; }
          // Deduplicate: if the same currency appears in multiple price lists
          // keep the first occurrence (lowest price_list_rate by default sort).
          var seen = {};
          var result = [];
          r.message.forEach(function (row) {
            if (!Object.prototype.hasOwnProperty.call(seen, row.currency)) {
              seen[row.currency] = true;
              result.push({
                currency: row.currency,
                price: row.price_list_rate,
                price_list: row.price_list,
              });
            }
          });
          resolve(result);
        },
        error: function (err) { reject(err); },
      });
    });
  }

  return {
    printBarcode: printBarcode,
    printBarcodes: printBarcodes,
    buildZPL: buildZPL,
    listPrinters: listPrinters,
    getAvailableCurrencies: getAvailableCurrencies,
  };
})();
