import frappe
from frappe import _
from frappe.model.document import Document
from scripts.utils.get_origin_doc import get_origin_doc

def _item_batch_values(item):
    # read common batch fields from a child row
    if hasattr(item, "get"):
        return item.get("batch_no") or item.get("batch_id") or item.get("batch")
    return getattr(item, "batch_no", None) or getattr(item, "batch_id", None) or getattr(item, "batch", None)
   
def propagate_fabric_length(doc: Document, method):
    try:
        origin: Document = get_origin_doc(doc)
    except Exception:
        frappe.throw(
            _("Origin document not found for Batch {0}").format(getattr(doc, "name", "<unknown>"))
        )
        
    if origin.doctype == "Purchase Receipt":
        batch_name = _item_batch_values(doc)
        frappe.msgprint(_("batch_name: {0}").format(batch_name))

        # Iterate items on the Purchase Receipt and find the one that created/links to this batch
        for item in origin.get("items", []) or []:
            # item can be a dict-like row or a Document-like object
            item_batch_value = None
            if hasattr(item, "get"):
                item_batch_value = item.get("batch_no") or item.get("batch") or item.get("batch_id")
            else:
                item_batch_value = getattr(item, "batch_no", None) or getattr(item, "batch", None) or getattr(item, "batch_id", None)

            # debug
            frappe.msgprint(_("Checking item {0}: batch_value={1}").format(
                getattr(item, "item_code", "<unknown>"), item_batch_value
            ))

            # match by batch id/name
            if item_batch_value and str(item_batch_value) == str(batch_name):
                # Read custom_width_cm from the item (field may be present on the item row)
                custom_width = None
                if hasattr(item, "get"):
                    custom_width = item.get("custom_width_cm")
                else:
                    custom_width = getattr(item, "custom_width_cm", None)

                frappe.msgprint(_("Found matching item {0} with custom_width_cm={1}").format(
                    getattr(item, "item_code", "<unknown>"), custom_width
                ))

                # If we have a value, propagate it to the Batch
                if custom_width is not None:
                    # Use direct DB update to ensure value is written even inside hooks
                    try:
                        batch_name = getattr(doc, "name", None) or getattr(doc, "batch_id", None) or getattr(doc, "batch_no", None)
                        if not batch_name:
                            # fallback: use the doc itself
                            batch_name = getattr(doc, "name", None)

                        frappe.db.set_value("Batch", batch_name, "custom_width_cm", custom_width, update_modified=False)
                        frappe.db.commit()
                        frappe.msgprint(_("Propagated custom_width_cm={0} to Batch {1}").format(custom_width, batch_name))
                    except Exception as e:
                        frappe.log_error(frappe.get_traceback(), "fabric_length_propagation: failed to update batch via db.set_value")
                        frappe.throw(_("Failed to propagate custom_width_cm to Batch {0}: {1}").format(getattr(doc, "name", "<unknown>"), e))

                # done — stop after first matching item
                return