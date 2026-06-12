import frappe

# Kubernetes mounts both QZ secrets here as read-only tmpfs files.
# Configure via volumeMounts + secretName in your k3s Deployment.
_QZ_KEY_PATH  = "/run/secrets/qz_private_key"
_QZ_CERT_PATH = "/run/secrets/qz_certificate"


@frappe.whitelist()
def qz_sign(challenge):
    """Sign a QZ Tray challenge with the RSA private key.

    Key lookup order:
      1. /run/secrets/qz_private_key  (k3s/k8s Secret volume mount — preferred)
      2. frappe.conf["qz_private_key"] (fallback: bench --site <s> set-config ...)
    """
    import base64
    import os
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

    if os.path.exists(_QZ_KEY_PATH):
        with open(_QZ_KEY_PATH, "rb") as f:
            private_key_pem: bytes | None = f.read()
    else:
        pem_str = frappe.conf.get("qz_private_key")
        private_key_pem = pem_str.encode() if pem_str else None

    if private_key_pem is None:
        return ""  # no key configured — QZ Tray will fall back to unsigned mode

    loaded = serialization.load_pem_private_key(private_key_pem, password=None)
    if not isinstance(loaded, RSAPrivateKey):
        return ""  # wrong key type — fall back to unsigned
    signature = loaded.sign(
        challenge.encode(),
        padding.PKCS1v15(),
        hashes.SHA512(),
    )
    return base64.b64encode(signature).decode()


@frappe.whitelist(allow_guest=True)
def qz_certificate():
    """Return the QZ Tray digital certificate PEM string.

    The certificate is public data, but managed via k3s so it can be
    rotated without rebuilding or redeploying the image.

    Lookup order:
      1. /run/secrets/qz_certificate  (k3s Secret volume mount)
      2. frappe.conf["qz_certificate"] (fallback: bench set-config)
    """
    import os

    if os.path.exists(_QZ_CERT_PATH):
        with open(_QZ_CERT_PATH, "r") as f:
            return f.read()

    cert = frappe.conf.get("qz_certificate")
    if not cert:
        return ""  # unsigned fallback — QZ Tray must allow unsigned
    return cert


@frappe.whitelist()
def get_item_translations(item_code, languages=None):
    """Fetch item name translations for one or more languages.

    Args:
        item_code: The item code to look up.
        languages: Comma-separated language codes, e.g. "hu,de,fr".
                   If None, returns all available translations for the item.

    Looks in the Translation table for source_text matching the item's
    item_name, returning translated_text keyed by language.
    Returns a dict: { "hu": "Hungarian name", "de": "German name", ... }
    """
    if not item_code:
        return {}

    # Get the item's default name and label_info
    item = frappe.db.get_value("Item", item_code, ["item_name", "label_info"], as_dict=True) or {}
    item_name = item.get("item_name") or ""
    item_label_info = item.get("label_info") or ""
    if not item_name:
        return {}

    lang_list = []
    if languages:
        lang_list = [l.strip() for l in languages.split(",") if l.strip()]

    # Collect source texts to translate: item_name + label_info (if set)
    source_texts_to_fetch = [item_name]
    if item_label_info:
        source_texts_to_fetch.append(item_label_info)

    query_filters = [["source_text", "in", source_texts_to_fetch]]
    if lang_list:
        query_filters.append(["language", "in", lang_list])

    rows = frappe.get_all(
        "Translation",
        filters=query_filters,
        fields=["source_text", "language", "translated_text"],
    )

    translations = {}
    label_info_trans = {}
    for r in rows:
        if r["source_text"] == item_name:
            translations[r["language"]] = r["translated_text"]
        elif r["source_text"] == item_label_info:
            label_info_trans[r["language"]] = r["translated_text"]

    if label_info_trans:
        translations["label_info"] = label_info_trans

    return translations


@frappe.whitelist()
def get_item_translations_batch(item_codes, languages=None):
    """Fetch translations for multiple items at once.

    Returns a dict: { item_code: { lang: translated_text, ... }, ... }
    """
    if not item_codes:
        return {}

    code_list = [c.strip() for c in item_codes.split(",") if c.strip()]
    if not code_list:
        return {}

    lang_list = []
    if languages:
        lang_list = [l.strip() for l in languages.split(",") if l.strip()]

    # Get all item names and label_info fields
    item_rows = frappe.get_all(
        "Item", filters=[["name", "in", code_list]], fields=["name", "item_name", "label_info"]
    )
    items = {r.name: {"item_name": r.item_name or "", "label_info": r.label_info or ""} for r in item_rows}

    result = {}
    for code in code_list:
        result[code] = {}

    if not items:
        return result

    # Build source texts list (item names + label_info values)
    item_names = {d["item_name"] for d in items.values() if d["item_name"]}
    label_infos = {d["label_info"] for d in items.values() if d["label_info"]}
    source_texts = list(item_names | label_infos)

    query_filters = [["source_text", "in", source_texts]]
    if lang_list:
        query_filters.append(["language", "in", lang_list])

    rows = frappe.get_all(
        "Translation",
        filters=query_filters,
        fields=["source_text", "language", "translated_text"],
    )

    # Build lookup: source_text -> {lang: translation}
    trans_map = {}
    for r in rows:
        if r.source_text not in trans_map:
            trans_map[r.source_text] = {}
        trans_map[r.source_text][r.language] = r.translated_text

    for code in code_list:
        item_data = items.get(code, {})
        default_name = item_data.get("item_name", "")
        default_info = item_data.get("label_info", "")

        if default_name and default_name in trans_map:
            result[code] = dict(trans_map[default_name])

        if default_info and default_info in trans_map:
            result[code]["label_info"] = trans_map[default_info]

    return result

def is_template_item(item_code):
    is_stock_item = frappe.db.get_value("Item", item_code, "is_stock_item")
    return not is_stock_item

def _process_reservation(wo_name, target_warehouse, doc):
    # --- 2. ÚJ STOCK ENTRY LÉTREHOZÁSA ---
    se = frappe.new_doc("Stock Entry")
    se.purpose = "Material Transfer"
    se.stock_entry_type = "Material Transfer"
    se.company = doc.company
    
    if doc.docstatus == 1:
        se.work_order = doc.name
        se.remarks = f"Fizikai foglalás a {doc.name} munkalaphoz."
    else:
        se.remarks = f"Előfoglalás (Draft) a {doc.name} munkalaphoz."

    items_to_transfer = []

    for row in doc.required_items:
        if is_template_item(row.item_code):
            continue

        pending_qty = row.required_qty
        if doc.docstatus == 1:
            pending_qty = row.required_qty - row.transferred_qty

        if pending_qty > 0:
            source_wh = row.source_warehouse or doc.source_warehouse
            
            if source_wh == target_warehouse:
                continue

            se.append("items", {
                "item_code": row.item_code,
                "s_warehouse": source_wh,
                "t_warehouse": target_warehouse,
                "qty": pending_qty,
                "transfer_qty": pending_qty,
                "uom": row.stock_uom,
                "conversion_factor": 1,
                "basic_rate": row.rate,
                "allow_zero_valuation_rate": 1,
            })
            
            items_to_transfer.append({
                "item_code": row.item_code,
                "qty": pending_qty,
                "source": source_wh, # Eltároljuk az eredetit, hogy tudjuk honnan jött
                "wo_item_name": row.name
            })

    if not items_to_transfer:
        return {"status": "info", "message": "Nincs átmozgatható tétel."}

    try:
        se.save()
        se.submit()
        
        # --- 3. NAPLÓZÁS ÉS WORK ORDER FRISSÍTÉS ---
        wo_doc = frappe.get_doc("Work Order", wo_name)
        
        for item in items_to_transfer:
            # A. Napló frissítése
            wo_doc.append("custom_reservation_log", {
                "item_code": item["item_code"],
                "qty": item["qty"],
                "source_warehouse": item["source"],
                "target_warehouse": target_warehouse,
                "stock_entry_ref": se.name
            })

            # B. WORK ORDER ITEM FRISSÍTÉSE (ÚJ RÉSZ)
            # Megkeressük a megfelelő sort a Work Orderben és átírjuk a raktárt
            for wo_row in wo_doc.required_items:
                # Prioritás: row.name alapján (ha elérhető)
                if item.get("wo_item_name") and wo_row.name == item.get("wo_item_name"):
                     wo_row.source_warehouse = target_warehouse
                # Fallback: Azonosítás Item Code és Eredeti Raktár alapján (ha nincs row.name vagy nem egyezik)
                elif wo_row.item_code == item["item_code"] and (wo_row.source_warehouse == item["source"] or (not wo_row.source_warehouse and item["source"] == wo_doc.source_warehouse)):
                    wo_row.source_warehouse = target_warehouse # Átállítjuk a Foglalt Raktárra
        
        # Mentés engedélyezése (ignoráljuk a validációt, hogy Submitted állapotban is engedje a raktárcserét)
        wo_doc.flags.ignore_validate_update_after_submit = True
        wo_doc.save(ignore_permissions=True)

        return {
            "status": "success", 
            "message": f"Siker! {len(items_to_transfer)} tétel lefoglalva a '{target_warehouse}' raktárba, WO forrásraktárak frissítve."
        }
        
    except Exception as e:
        frappe.log_error("Foglalási Hiba")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def create_physical_reservation(wo_name, target_warehouse):
    doc = frappe.get_doc("Work Order", wo_name)
    
    # --- 1. FRISSÍTÉSI LOGIKA (Update) ---
    if doc.custom_reservation_log:
        cancel_physical_reservation(wo_name)
        doc.reload() 

    return _process_reservation(wo_name, target_warehouse, doc)

@frappe.whitelist()
def update_physical_reservation(wo_name, target_warehouse):
    doc = frappe.get_doc("Work Order", wo_name)
    return _process_reservation(wo_name, target_warehouse, doc)

@frappe.whitelist()
def cancel_physical_reservation(wo_name):
    doc = frappe.get_doc("Work Order", wo_name)
    
    if not doc.custom_reservation_log:
        return {"status": "info", "message": "Nincs mit visszavonni."}

    se = frappe.new_doc("Stock Entry")
    se.purpose = "Material Transfer"
    se.stock_entry_type = "Material Transfer"
    se.company = doc.company
    se.remarks = f"Foglalás VISSZAVONÁSA: {doc.name}"

    if doc.docstatus == 1:
        se.work_order = doc.name

    items_to_revert = []

    revert_mapping = [] 

    for log_row in doc.custom_reservation_log:
        actual_qty = frappe.db.get_value("Bin", {
            "item_code": log_row.item_code, 
            "warehouse": log_row.target_warehouse
        }, "actual_qty") or 0

        qty_to_move = min(log_row.qty, actual_qty)

        if qty_to_move > 0:
            se.append("items", {
                "item_code": log_row.item_code,
                "s_warehouse": log_row.target_warehouse, 
                "t_warehouse": log_row.source_warehouse,
                "qty": qty_to_move,
                "transfer_qty": qty_to_move,
                "uom": frappe.db.get_value("Item", log_row.item_code, "stock_uom"),
                "conversion_factor": 1,
            })
            items_to_revert.append(log_row)
            
            revert_mapping.append({
                "item_code": log_row.item_code,
                "original_source": log_row.source_warehouse,
                "current_reserved": log_row.target_warehouse
            })

    if items_to_revert:
        se.save()
        se.submit()

    wo_doc = frappe.get_doc("Work Order", wo_name)
    
    wo_doc.custom_reservation_log = []
    
    if revert_mapping:
        for wo_row in wo_doc.required_items:
            for mapping in revert_mapping:
                if wo_row.item_code == mapping["item_code"] and wo_row.source_warehouse == mapping["current_reserved"]:
                    wo_row.source_warehouse = mapping["original_source"]

    wo_doc.flags.ignore_validate_update_after_submit = True
    wo_doc.save(ignore_permissions=True)

    return {"status": "success", "message": "Foglalás visszavonva, raktárak visszaállítva."}



@frappe.whitelist()
def generate_work_orders(sales_order):
    so = frappe.get_doc("Sales Order", sales_order)
    created_wos = _generate_wos_for_so(so)

    if created_wos:
        frappe.msgprint(f"Created Work Orders: {', '.join(created_wos)}")
    else:
        frappe.msgprint("No Work Orders created (maybe already created or no BOMs).")

def _generate_wos_for_so(so):
    from erpnext.manufacturing.doctype.work_order.work_order import get_item_details, make_work_order
    from scripts.scripts.work_order_scripts import select_bom_from_sales_order_item
    
    created_wos = []
    
    for item in so.items:
        # Check if WO exists for this specific item row
        existing_wo = frappe.db.exists("Work Order", {
            "sales_order": so.name,
            "sales_order_item": item.name,
            "docstatus": ["!=", 2] 
        })
        
        if existing_wo:
            continue
            
        # Check if item allows manufacturing 
        try:
            item_details = get_item_details(item.item_code, project=so.project, throw=False)
        except Exception:
             continue 
             
        if not item_details or not item_details.get("bom_no"):
            continue
            
        bom_no = item_details.get("bom_no")
        matching_bom = select_bom_from_sales_order_item.get_matching_bom_for_item_and_fabric(
            item.item_code,
            select_bom_from_sales_order_item.get_sales_order_item_fabric(item.name),
            select_bom_from_sales_order_item.get_sales_order_item_kidolgozas(item.name),
        )
        if matching_bom:
            bom_no = matching_bom

        qty = item.qty 
        
        # Create WO
        wo = make_work_order(bom_no, item.item_code, qty=qty, project=so.project)
        wo.sales_order = so.name
        wo.sales_order_item = item.name
        wo.expected_delivery_date = item.delivery_date
        wo.company = so.company
        
        if item.warehouse:
            wo.fg_warehouse = item.warehouse
            
        wo.save()
        
        # Try to copy finishing details from an existing WO in the same project
        if so.project:
            # Find work orders in the same project for the same item that contain finishing details
            # We look for a "template" that has data.
            potential_templates = frappe.get_all("Work Order", filters={
                "project": so.project,
                "production_item": item.item_code,
                "name": ["!=", wo.name],
                "docstatus": ["<", 2]
            }, pluck="name")

            for temp_name in potential_templates:
                temp_doc = frappe.get_doc("Work Order", temp_name)
                if temp_doc.custom_finishing_detail:
                    # Found one with details! Copy them.
                    for row in temp_doc.custom_finishing_detail:
                        new_row = wo.append("custom_finishing_detail", {})
                        for field in row.as_dict():
                            if field not in ["name", "parent", "parentfield", "parenttype", "creation", "modified", "docstatus", "idx", "owner"]:
                                new_row.set(field, row.get(field))
                    wo.save()
                    break # Stop after finding one valid source and copying

        created_wos.append(wo.name)
    
    return created_wos

@frappe.whitelist()
def generate_work_orders_from_project(project):
    sales_orders = frappe.get_all("Sales Order", filters={"project": project, "docstatus": 1}, pluck="name")
    
    if not sales_orders:
        frappe.msgprint("No submitted Sales Orders found for this Project.")
        return

    total_created_wos = []
    
    for so_name in sales_orders:
        so = frappe.get_doc("Sales Order", so_name)
        created = _generate_wos_for_so(so)
        total_created_wos.extend(created)

    if total_created_wos:
        frappe.msgprint(f"Created {len(total_created_wos)} Work Orders across {len(sales_orders)} Sales Orders.")
    else:
        frappe.msgprint("No new Work Orders created.")

@frappe.whitelist()
def get_related_work_orders(wo_name):
    source_wo = frappe.get_doc("Work Order", wo_name)
    if not source_wo.sales_order:
        return []
    
    target_wos = frappe.get_all("Work Order", filters={
        "production_item": source_wo.production_item,
        "sales_order": source_wo.sales_order,
        "name": ["!=", source_wo.name],
        "docstatus": ["<", 2]
    }, fields=["name", "status", "qty", "produced_qty"])
    
    return target_wos

@frappe.whitelist()
def copy_finishing_details(wo_name, targets=None):
    if isinstance(targets, str):
        import json
        targets = json.loads(targets)

    # Get the source Work Order
    source_wo = frappe.get_doc("Work Order", wo_name)
    
    if not source_wo.sales_order:
        frappe.throw("This Work Order is not linked to a Sales Order.")
        
    if not source_wo.custom_finishing_detail:
        frappe.msgprint("No Finishing Details to copy.")
        return

    # Find target Work Orders
    filters = {
        "production_item": source_wo.production_item,
        "sales_order": source_wo.sales_order,
        "name": ["!=", source_wo.name],
        "docstatus": ["<", 2]
    }

    # If specific targets provided, filter by them
    if targets:
        filters["name"] = ["in", targets]

    target_wos = frappe.get_all("Work Order", filters=filters)
    
    if not target_wos:
        frappe.msgprint("No eligible Work Orders found for this Item and Sales Order.")
        return
    
    count = 0
    for target_data in target_wos:
        target_wo = frappe.get_doc("Work Order", target_data.name)
        
        # Clear existing details
        target_wo.custom_finishing_detail = []
        
        # Copy details
        for row in source_wo.custom_finishing_detail:
            new_row = target_wo.append("custom_finishing_detail", {})
            for field in row.as_dict():
                # Copy all fields except system standard fields
                if field not in ["name", "parent", "parentfield", "parenttype", "creation", "modified", "docstatus", "idx", "owner"]:
                    new_row.set(field, row.get(field))
        
        target_wo.save()
        count += 1

    frappe.msgprint(f"Copied Finishing Details to {count} Work Orders.")

@frappe.whitelist()
def duplicate_sales_orders(source_name, count):
    count = int(count)
    if count < 1:
        return
        
    source_doc = frappe.get_doc("Sales Order", source_name)
    
    if not source_doc.project:
        frappe.throw("Duplication is only allowed for Sales Orders linked to a Project.")

    created_sos = []
    
    for i in range(count):
        new_doc = frappe.copy_doc(source_doc)
        new_doc.amended_from = None
        new_doc.transaction_date = frappe.utils.nowdate()
        
        # Link to Project is maintained by copy_doc
        
        new_doc.insert()
        created_sos.append(new_doc.name)
        
    return f"Created {len(created_sos)} Sales Orders: {', '.join(created_sos)}"


@frappe.whitelist()
def update_barcode_print_date(items):
	"""Increment custom_barcodes_printed_qty for each item+warehouse pair.

	``items`` is a JSON list of dicts with keys:
	  - ``item_code``
	  - ``warehouse``
	  - ``count`` (optional, defaults to 1) — how many new labels were printed
	"""
	import json

	if isinstance(items, str):
		items = json.loads(items)

	# Aggregate counts per unique item+warehouse pair
	counts = {}
	for r in items:
		item_code = r.get("item_code")
		warehouse = r.get("warehouse")
		if not item_code or not warehouse:
			continue
		key = (item_code, warehouse)
		counts[key] = counts.get(key, 0) + int(r.get("count") or 1)

	for (item_code, warehouse), count in counts.items():
		frappe.db.sql(
			"""
			UPDATE `tabBin`
			SET
				custom_barcodes_printed_qty = LEAST(
					COALESCE(custom_barcodes_printed_qty, 0) + %(count)s,
					actual_qty
				)
			WHERE item_code = %(item_code)s
			  AND warehouse = %(warehouse)s
			""",
			{"item_code": item_code, "warehouse": warehouse, "count": count},
		)

	frappe.db.commit()
	return "ok"
