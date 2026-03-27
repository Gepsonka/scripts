# Copyright (c) 2026, asd and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, cint


class WorkOrder(Document):
	@frappe.whitelist()
	def get_items_and_operations_from_bom(self):
		"""Fill required_items and operations from BOM."""
		self.set_required_items()
		self.set_work_order_operations()

	def set_required_items(self, reset_only_qty=False):
		"""Set required_items for production."""
		if not reset_only_qty:
			self.required_items = []

		from erpnext.manufacturing.doctype.bom.bom import get_bom_items_as_dict

		operation = None
		if self.get("operations") and len(self.operations) == 1:
			operation = self.operations[0].operation

		if self.bom_no and self.qty:
			item_dict = get_bom_items_as_dict(
				self.bom_no, self.company, qty=self.qty, fetch_exploded=self.use_multi_level_bom
			)

			if reset_only_qty:
				for d in self.get("required_items"):
					if item_dict.get(d.item_code):
						d.required_qty = item_dict.get(d.item_code).get("qty")
					if not d.operation:
						d.operation = operation
			else:
				for item in sorted(item_dict.values(), key=lambda d: d["idx"] or float("inf")):
					self.append(
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

					if not self.project:
						self.project = item.get("project")

	def set_work_order_operations(self):
		"""Fetch operations from BOM and set in Work Order."""
		if not self.bom_no or not frappe.get_cached_value("BOM", self.bom_no, "with_operations"):
			return

		self.set("operations", [])
		data = frappe.get_all(
			"BOM Operation",
			filters={"parent": self.bom_no},
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
				d.time_in_mins = flt(d.time_in_mins) * flt(self.qty)
			d.status = "Pending"
			self.append("operations", d)

		self.calculate_time()

	def calculate_time(self):
		for d in self.get("operations"):
			if not d.fixed_time:
				d.time_in_mins = flt(d.time_in_mins) * (flt(self.qty) / flt(d.batch_size))
