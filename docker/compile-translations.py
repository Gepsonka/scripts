#!/usr/bin/env python3
"""Compile MO translation files for frappe, erpnext, and the scripts app.

This is a thin wrapper around frappe.gettext.translate that runs sequentially
(using a 1-process multiprocessing.Pool) to avoid the 4-worker pool that
intermittently OOMs or hits fork limits in the constrained docker build
context.

Output is byte-identical to `bench build --production`'s internal
translation step (same library, same arguments).
"""
from babel.messages.mofile import write_mo
from babel.messages.pofile import read_po
from pathlib import Path

import frappe
from frappe.utils import get_bench_path
from frappe.gettext.translate import get_locales


def main() -> int:
    # Explicitly point frappe.init at the bench's sites/ directory.
    # `frappe.init("")` defaults `sites_path="."` (relative to the process
    # CWD), which only works if we happen to be in `<bench>/sites/`. In the
    # Dockerfile we run from `<bench>/`, so we resolve sites_path from
    # get_bench_path() to keep this script cwd-agnostic.
    bench_path = Path(get_bench_path())
    sites_path = str(bench_path / "sites")
    frappe.init("", sites_path=sites_path)
    total = 0
    for app in ("frappe", "erpnext", "scripts"):
        for locale in get_locales(app):
            po_path = Path(frappe.get_app_path(app)) / "locale" / f"{locale}.po"
            mo_path = (
                Path(get_bench_path())
                / "sites"
                / "assets"
                / "locale"
                / locale
                / "LC_MESSAGES"
                / f"{app}.mo"
            )
            if not po_path.exists():
                continue
            mo_path.parent.mkdir(parents=True, exist_ok=True)
            with open(po_path, "rb") as f:
                catalog = read_po(f)
            with open(mo_path, "wb") as f:
                write_mo(f, catalog)
            total += 1
    print(f"Compiled {total} translation files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
