import frappe
from frappe import _
from frappe.model.document import Document

def get_origin_doc(batch: Document):
    # common field names used for the source doc on Batch
    ref_doctype = getattr(batch, "reference_document_type", None) or getattr(batch, "reference_doctype", None)
    ref_name = (
        getattr(batch, "reference_document_name", None)
        or getattr(batch, "reference_name", None)
        or getattr(batch, "reference_document", None)
    )
    if not (ref_doctype and ref_name):
        raise frappe.DoesNotExistsError
    
    return frappe.get_doc(ref_doctype, ref_name)


def get_batches_for_purchase_receipt(purchase_receipt_doc: Document):
    # Query the Batches linked to the given Purchase Receipt
    batches = frappe.get_all(
        "Batch",
        filters={"reference_doctype": purchase_receipt_doc.doctype, "reference_name": purchase_receipt_doc.name},
        fields=["name", "item", "batch_qty"]
    )
    
    return batches