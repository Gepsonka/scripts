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

  // ── Security (unsigned / internal use) ──────────────────────────────────
  function setupSecurity() {
    qz.security.setCertificatePromise(function (resolve) {
      resolve(""); // unsigned – QZ Tray must have "Allow unsigned" enabled
    });
    qz.security.setSignatureAlgorithm("SHA512");
    qz.security.setSignaturePromise(function () {
      return function (resolve) { resolve(""); };
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
   * Default media: 40 mm × 30 mm
   *   ^PW320  → 400 dots wide   (40 mm × 8 dots/mm)
   *   ^LL240  → 240 dots tall   (30 mm × 8 dots/mm)
   *
   * Barcode type is chosen automatically based on the item code:
   *   12–13 digits (numeric) → EAN-13  (European retail standard)
   *   7–8   digits (numeric) → EAN-8   (compact European variant)
   *   anything else          → Code 128 (fallback, alphanumeric)
   *
   * All barcode types print the item code as human-readable text below
   * the bars (built-in HRI for EAN; enabled via Y parameter for Code 128).
   *
   * Label layout (203 DPI, 40 mm × 30 mm):
   *   Item name   → centered text at top (~30 dots high)
   *   Barcode     → 10 dots below text
   *   HRI text    → 5 dots below barcode
   *
   * @param {string} itemCode   Any non-empty string (ZPL control chars ^ and ~ are stripped).
   * @param {number} qty       Number of copies (uses ^PQ).
   * @param {string} [itemName] Optional item name to print above the barcode.
   * @returns {string}          ZPL label string.
   * @throws {Error}           If itemCode is empty after sanitisation.
   */
  function buildZPL(itemCode, qty, itemName) {
    qty = Math.max(1, Math.floor(qty) || 1);
    var code = String(itemCode).replace(/[\^~]/g, "").trim();
    var name = itemName ? String(itemName).replace(/[\^~]/g, "").trim() : "";

    if (!code) {
      throw new Error("Cannot print: item code is empty.");
    }

    var label =
      "^XA" +
      "^LH0,0" +                       // reset label-home offset
      "^PW320" +                       // label width  (40 mm = 320 dots)
      "^LL240";                        // label length (30 mm = 240 dots)

    // ── Item name (above barcode, centered) ──────────────────────────
    if (name) {
      label +=
        "^FO0,15" +                    // x=0 for ^FB centering, y=15 from top (extra top margin)
        "^A0N,28,28" +                // scalable font 28×28 dots (~3.5 mm)
        "^FB320,1,0,C,0" +           // field block: 320 wide, 1 line, 1-line spacing, centred
        "^FD" + name + "^FS";
    }

    // ── Barcode (below item name, with HRI below bars) ────────────
    var barcodeY = name ? 50 : 20;
    label +=
      "^FO20," + barcodeY + "" +       // 20-dot left margin
      "^BY2" +                         // 2-dot module width
      "^BCN,70,Y,N,N" +               // Code 128, 70-dot height, HRI below bars
      "^FD" + code + "^FS";

    label +=
      // ── Copies & end ─────────────────────────────────────────────
      "^PQ" + qty +
      "^XZ";

    return label;
  }

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
   * @returns {Promise}
   */
  function printBarcode(itemCode, qty, opts, itemName) {
    return connect()
      .then(function () { return resolveConfig(opts); })
      .then(function (config) {
        return qz.print(config, [{ type: "raw", format: "command", data: buildZPL(itemCode, qty, itemName) }]);
      });
  }

  /**
   * Print barcodes for multiple items in sequence.
   *
   * @param {Array<{item_code: string, qty: number, item_name?: string}>} items
   * @param {string|object} [opts]
   * @returns {Promise}
   */
  function printBarcodes(items, opts) {
    return connect()
      .then(function () { return resolveConfig(opts); })
      .then(function (config) {
        // Aggregate items with the same item_code so we use ^PQ<n> for copies
        // instead of repeating the same ZPL block N times.
        var seen = {};
        var aggregated = [];
        items.forEach(function (item) {
          var key = item.item_code;
          if (Object.prototype.hasOwnProperty.call(seen, key)) {
            aggregated[seen[key]].qty += (item.qty || 1);
          } else {
            seen[key] = aggregated.length;
            aggregated.push({
              item_code: item.item_code,
              item_name: item.item_name || "",
              qty: item.qty || 1,
            });
          }
        });

        // Build one concatenated ZPL string and send as a single print job
        var zpl = aggregated.map(function (item) {
          return buildZPL(item.item_code, item.qty, item.item_name);
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

  return {
    printBarcode: printBarcode,
    printBarcodes: printBarcodes,
    buildZPL: buildZPL,
    listPrinters: listPrinters,
  };
})();
