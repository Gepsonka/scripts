# Copyright (c) 2026, asd and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname
from frappe.utils import strip


class Item(Document):
	def autoname(self):
		if not self.item_code:
			series = self.naming_series or ".######"
			self.item_code = make_autoname(series, doc=self)

		self.item_code = strip(self.item_code)
		self.name = self.item_code

	def validate(self):
		if not self.item_name:
			self.item_name = self.item_code
