# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
Work Order logic ported from `scripts.doctype.work_order.work_order`
after we deleted that duplicate doctype folder.

The `set_required_items`, `set_work_order_operations`, and `calculate_time`
methods used to live on a `WorkOrder(Document)` subclass; now they run as
`validate` doc_event handlers so they apply to the standard ERPNext
Work Order DocType without us owning a custom copy of it.
"""
import frappe
from frappe.utils import flt


def set_required_items(doc, method=None, reset_only_qty=False):
	"""Set required_items for production."""
	if not reset_only_qty:
		doc.required_items = []

	from erpnext.manufacturing.doctype.bom.bom import get_bom_items_as_dict

	operation = None
	if doc.get("operations") and len(doc.operations) == 1:
		operation = doc.operations[0].operation

	if doc.bom_no and doc.qty:
		item_dict = get_bom_items_as_dict(
			doc.bom_no,
			doc.company,
			qty=doc.qty,
			fetch_exploded=doc.use_multi_level_bom,
		)

		if reset_only_qty:
			for d in doc.get("required_items"):
				if item_dict.get(d.item_code):
					d.required_qty = item_dict.get(d.item_code).get("qty")
				if not d.operation:
					d.operation = operation
		else:
			for item in sorted(
				item_dict.values(), key=lambda d: d["idx"] or float("inf")
			):
				doc.append(
					"required_items",
					{
						"rate": item.rate,
						"amount": item.rate * item.qty,
						"operation": item.operation or operation,
						"item_code": item.item_code,
						"item_name": item.item_name,
						"description": item.description,
						"allow_alternative_item": item.allow_alternative_item,
						"required_qty": item.qty,
						"source_warehouse": item.source_warehouse or item.default_warehouse,
						"include_item_in_manufacturing": item.include_item_in_manufacturing,
					},
				)

				if not doc.project:
					doc.project = item.get("project")


def set_work_order_operations(doc, method=None):
	"""Fetch operations from BOM and set in Work Order."""
	if not doc.bom_no or not frappe.get_cached_value(
		"BOM", doc.bom_no, "with_operations"
	):
		return

	doc.set("operations", [])
	data = frappe.get_all(
		"BOM Operation",
		filters={"parent": doc.bom_no},
		fields=[
			"operation",
			"description",
			"workstation",
			"idx",
			"workstation_type",
			"time_in_mins",
			"batch_size",
			"sequence_id",
			"fixed_time",
		],
		order_by="idx",
	)

	for d in data:
		if not d.fixed_time:
			d.time_in_mins = flt(d.time_in_mins) * flt(doc.qty)
		d.status = "Pending"
		doc.append("operations", d)

	calculate_time(doc)


def calculate_time(doc, method=None):
	for d in doc.get("operations"):
		if not d.fixed_time:
			d.time_in_mins = flt(d.time_in_mins) * (
				flt(doc.qty) / flt(d.batch_size)
			)


def work_order_validate(doc, method=None):
	"""
	Single entry point for the Work Order `validate` doc_event. Runs the
	required-items + operations derivation that used to live on the
	subclass, so the behaviour is preserved.
	"""
	set_required_items(doc, method=method)
	set_work_order_operations(doc, method=method)