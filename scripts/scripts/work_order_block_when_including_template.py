import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


def work_order_block_when_including_template(doc: Document, method: str | None = None):
	required_items = doc.get("required_items") or []
	item_codes = {row.get("item_code") for row in required_items if row.get("item_code")}
	if not item_codes:
		return

	item_fields = ["name", "has_variants", "variant_of"]
	if frappe.db.has_column("Item", "is_template"):
		item_fields.append("is_template")

	item_records = frappe.get_all(
		"Item",
		filters={"name": ("in", list(item_codes))},
		fields=item_fields,
	)

	template_items = []
	for item in item_records:
		is_template_flag = cint(item.get("is_template")) if item.get("is_template") is not None else 0
		if cint(item.get("has_variants")) or (is_template_flag and not item.get("variant_of")):
			template_items.append(item.get("name"))

	if template_items:
		frappe.throw(
			_(
				"Cannot submit Work Order because the Required Items table includes template items: {0}."
			).format(", ".join(sorted(template_items))),
			title=_("Template Items Not Allowed"),
		)
