import frappe
from scripts.utils import barcode_svg


def execute(filters=None):
	filters = filters or {}

	columns = [
		{"label": "Item Code", "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 150},
		{"label": "Item Name", "fieldname": "item_name", "fieldtype": "Data", "width": 200},
		{"label": "Item Group", "fieldname": "item_group", "fieldtype": "Link", "options": "Item Group", "width": 130},
		{"label": "Warehouse", "fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse", "width": 150},
		{"label": "Qty", "fieldname": "actual_qty", "fieldtype": "Float", "width": 80},
		{"label": "Printed", "fieldname": "is_printed", "fieldtype": "Check", "width": 70},
		{"label": "Print", "fieldname": "print_btn", "fieldtype": "Data", "width": 90},
	]

	conditions = "bin.actual_qty > 0 AND item.disabled = 0 AND item.is_stock_item = 1"
	values = {}

	if filters.get("warehouse"):
		conditions += " AND bin.warehouse = %(warehouse)s"
		values["warehouse"] = filters["warehouse"]

	if filters.get("item_group"):
		conditions += " AND item.item_group = %(item_group)s"
		values["item_group"] = filters["item_group"]

	data = frappe.db.sql(
		f"""
		SELECT
			item.name AS item_code,
			item.item_name,
			item.item_group,
			bin.warehouse,
			bin.actual_qty,
			COALESCE(bin.custom_barcodes_printed_qty, 0) AS barcodes_printed_qty
		FROM
			`tabBin` bin
		JOIN
			`tabItem` item ON bin.item_code = item.name
		WHERE
			{conditions}
		ORDER BY
			item.item_group, item.name
		""",
		values,
		as_dict=True,
	)

	import math

	rows = []
	for r in data:
		count = max(1, math.ceil(r.actual_qty))
		printed = int(r.barcodes_printed_qty or 0)
		for i in range(count):
			is_printed = i < printed
			rows.append({
				"item_code": r.item_code,
				"item_name": r.item_name,
				"item_group": r.item_group,
				"warehouse": r.warehouse,
				"actual_qty": r.actual_qty,
				"is_printed": 1 if is_printed else 0,
			})

	return columns, rows


@frappe.whitelist()
def get_barcode_html(items):
	if isinstance(items, str):
		import json
		items = json.loads(items)

	labels = []
	for item_code in items:
		item = frappe.db.get_value("Item", item_code, ["item_name", "item_group"], as_dict=True)
		if not item:
			continue
		svg = barcode_svg(item_code)
		labels.append(f"""
			<div class="barcode-label">
				<div class="item-code">{frappe.utils.escape_html(item_code)}</div>
				<div class="barcode-center">{svg}</div>
				<div class="item-name">{frappe.utils.escape_html(item.item_name)}</div>
			</div>
		""")

	html = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@page {{ size: A4; margin: 10mm; }}
body {{ font-family: Arial, sans-serif; margin: 0; }}
.barcode-grid {{ display: flex; flex-wrap: wrap; gap: 3mm; }}
.barcode-label {{ width: 56mm; padding: 2mm; border: 0.5px solid #ccc; text-align: center; page-break-inside: avoid; }}
.item-code {{ font-size: 10px; font-weight: bold; margin-bottom: 1mm; }}
.item-name {{ font-size: 8px; color: #555; margin-top: 1mm; }}
.barcode-center {{ display: flex; justify-content: center; align-items: center; }}
</style>
</head>
<body>
<div class="barcode-grid">
{labels}
</div>
</body>
</html>""".format(labels="\n".join(labels))

	return html
