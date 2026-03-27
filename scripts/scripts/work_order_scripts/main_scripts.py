import frappe
from frappe import _
from frappe.model.document import Document
from . import work_order_block_when_including_template
from . import propagate_chosen_fabric
from . import select_bom_from_sales_order_item
from scripts.utils.get_origin_doc import get_origin_doc


def on_submit(doc: Document, method):
    work_order_block_when_including_template.work_order_block_when_including_template(doc, method)


def on_save(doc: Document, method):
    propagate_chosen_fabric.propagate_chosen_fabric(doc, method)


def before_validate(doc: Document, method):
    select_bom_from_sales_order_item.set_specific_bom_from_so(doc, method)
    select_bom_from_sales_order_item.autofill_merettipus_from_so(doc, method)
