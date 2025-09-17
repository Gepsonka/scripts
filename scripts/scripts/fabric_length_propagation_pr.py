import frappe
from frappe import _
from frappe.model.document import Document
from scripts.utils.get_origin_doc import get_origin_doc, get_batches_for_purchase_receipt


def propagate_fabric_length(doc: Document, method: str):
    """
    When a Purchase Receipt is saved, find the batch associated with each item
    and propagate the `custom_width_cm` from the item to the batch.
    """
    frappe.msgprint(f"{doc.doctype}")
    if doc.doctype != "Purchase Receipt":
        return

    # We will not rely on item.batch_no. Instead, fetch Batches whose 
    # purchase_receipt references this Purchase Receipt and order them so 
    # we can map widths by item and (optionally) by length.
    try:
        batches = get_batches_for_purchase_receipt(doc)
        frappe.msgprint(f"len: {len(batches)}")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Fabric Length Propagation: failed to fetch batches")
        return

    # Normalize batches into a mapping by item -> list of batches ordered by length desc
    batches_by_item = {}
    for b in batches:
        item_code = b.get("item")
        # try to use a length field on the Batch if present, fall back to qty
        length_val = b.get("length") if b.get("length") is not None else b.get("qty")
        batches_by_item.setdefault(item_code, []).append({"name": b.get("name"), "length": length_val})

    # Order each item's batches by length descending (longer pieces first)
    for item_code, blist in batches_by_item.items():
        blist.sort(key=lambda x: (x["length"] is None, -(x["length"] or 0)))

    # For each item row on the Purchase Receipt, propagate its custom_width_cm
    # to one or more batches of the same item. We'll assign widths to batches
    # in the order described by the user: ordered by item and length.
    for pr_item in doc.get("items", []):
        item_code = pr_item.get("item_code") or pr_item.get("item")
        custom_width = pr_item.get("custom_width_cm")
        if custom_width is None:
            continue

        target_batches = batches_by_item.get(item_code, [])
        if not target_batches:
            # nothing to propagate for this item
            frappe.log_error(f"No batches found for Purchase Receipt {doc.name} item {item_code}", "Fabric Length Propagation")
            continue

        # propagate to batches in the established order
        for b in target_batches:
            try:
                frappe.db.set_value("Batch", b["name"], "custom_width_cm", custom_width)
                frappe.msgprint(_("Propagated width {0} to batch {1} for item {2}").format(custom_width, b["name"], item_code))
            except Exception:
                frappe.log_error(frappe.get_traceback(), "Fabric Length Propagation Failed")
