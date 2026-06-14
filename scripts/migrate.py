"""
Migration helpers for the scripts app.
These are designed to be run via `bench execute scripts.migrate.<function>`.
"""
import frappe


def remove_custom_item_doctype():
    """
    Removes the custom Item doctype that previously lived in the scripts app
    before the migration to ERPNext's standard Item.

    Background: This app originally shipped a custom Item doctype in module
    'Scripts'. It was deleted in favor of ERPNext's standard Item plus a
    Custom Field. `bench migrate` only adds updates - it does not delete
    custom doctypes - so we need this helper.

    Safe to run multiple times - it short-circuits when the standard Item is
    already in place.
    """
    meta = frappe.get_meta("Item")
    print(f"Item module={meta.module} custom={meta.custom}")

    if meta.module == "Stock":
        print("Item is already ERPNext standard - nothing to do")
        return

    n = frappe.db.count("tabItem")
    print(f"Found {n} rows in tabItem")

    if n == 0:
        print("Deleting custom Item doctype (no data to lose)...")
        frappe.delete_doc("DocType", "Item", force=True, ignore_permissions=True)
        frappe.db.commit()
        print("Custom Item deleted. Migrate will restore ERPNext Item.")
    else:
        print(f"WARNING: {n} rows exist in tabItem - keeping data, just fixing module field")
        # Re-point module to Stock so Frappe loads ERPNext's standard Item
        frappe.db.sql("UPDATE tabDocType SET module='Stock', custom=0 WHERE name='Item'")
        frappe.db.commit()
        frappe.clear_cache(doctype="Item")
        print("Updated Item.module=Stock - data preserved")
