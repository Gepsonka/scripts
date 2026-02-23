import frappe
from frappe import _
from frappe.model.document import Document
from . import work_order_block_when_including_template
from . import propagate_chosen_fabric
from scripts.utils.get_origin_doc import get_origin_doc


def on_submit(doc: Document, method):
    work_order_block_when_including_template.work_order_block_when_including_template(doc, method)


def on_save(doc: Document, method):
    propagate_chosen_fabric.propagate_chosen_fabric(doc, method)