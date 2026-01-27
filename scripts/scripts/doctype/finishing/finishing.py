# Copyright (c) 2026, asd and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname


class Finishing(Document):
	def autoname(self):
		self.name = make_autoname(f"FINISHING-{self.finishing_name.upper().replace(' ', '_')}-.#####")
