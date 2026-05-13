import frappe
from frappe import _, _dict
from frappe.model.document import Document
from frappe.utils import flt


_LINK_FIELDS = [
    "sales_order_item",
    "sales_order_detail",
    "so_detail",
    "voucher_detail_no",
    "item_row_name",
]

_ITEM_TABLES = [
    "items",
    "sales_order_items",
]

_GUEST_MATERIAL_TABLE_FIELDS = [
    "guest_material",
    "guest_materials",
    "custom_guest_material",
    "custom_guest_materials",
    "custom_vendeganyag",
]


def _resolve_target_warehouse(company: str, explicit_warehouse: str | None) -> str | None:
    """Return the warehouse to use, falling back gracefully if defaults are missing."""
    if explicit_warehouse:
        return explicit_warehouse

    default_warehouse = None
    try:
        if frappe.db.has_column("Company", "default_warehouse"):
            default_warehouse = frappe.db.get_value("Company", company, "default_warehouse")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Guest Material Reservation: default warehouse lookup failed")

    if not default_warehouse:
        default_warehouse = frappe.db.get_single_value("Stock Settings", "default_warehouse")

    return default_warehouse


def _resolve_voucher_detail_no(so_item: Document, guest_material: dict) -> str | None:
    """Determine which Sales Order Item row this reservation should link to."""
    for field in _LINK_FIELDS:
        value = guest_material.get(field)
        if value:
            return value

    return so_item.get("name")


def _fetch_table_rows_from_db(parent: Document, fieldname: str) -> list[_dict]:
    """Load table field rows directly from the database in case the doc was trimmed."""
    try:
        meta = frappe.get_meta(parent.doctype)
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"Guest Material Reservation: meta load failed for {parent.doctype}")
        return []

    df = meta.get_field(fieldname)
    if not df or df.fieldtype != "Table" or not df.options:
        return []

    try:
        rows = frappe.get_all(
            df.options,
            filters={
                "parent": parent.name,
                "parenttype": parent.doctype,
                "parentfield": fieldname,
            },
            fields="*",
            order_by="idx asc",
        )
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"Guest Material Reservation: failed to load child table {fieldname}",
        )
        return []

    return [_dict(row) for row in rows]


def _fetch_child_rows_for_item(so_item: Document, fieldname: str) -> list[_dict]:
    so_item_doctype = so_item.get("doctype") or "Sales Order Item"
    try:
        meta = frappe.get_meta(so_item_doctype)
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"Guest Material Reservation: meta load failed for {so_item_doctype}",
        )
        return []

    df = meta.get_field(fieldname)
    if not df or df.fieldtype != "Table" or not df.options:
        return []

    try:
        rows = frappe.get_all(
            df.options,
            filters={
                "parent": so_item.get("name"),
                "parenttype": so_item_doctype,
                "parentfield": fieldname,
            },
            fields="*",
            order_by="idx asc",
        )
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"Guest Material Reservation: failed to load child rows for {so_item.get('name')}",
        )
        return []

    return [_dict(row) for row in rows]


def _match_rows_to_item(rows: list[dict], so_item: Document) -> list[dict]:
    if not rows:
        return []

    candidates = {so_item.get("name")}
    for field in _LINK_FIELDS:
        value = so_item.get(field)
        if value:
            candidates.add(value)

    matched: list[dict] = []
    for row in rows:
        for field in _LINK_FIELDS:
            if row.get(field) in candidates:
                matched.append(row)
                break
    return matched


def _get_guest_material_rows(parent_doc: Document, so_item: Document) -> list[dict]:
    """Return guest material rows for a Sales Order Item with multiple fallback strategies."""
    for field in _GUEST_MATERIAL_TABLE_FIELDS:
        rows = so_item.get(field)
        if rows:
            return rows

    for field in _GUEST_MATERIAL_TABLE_FIELDS:
        parent_rows = parent_doc.get(field)
        if not parent_rows:
            parent_rows = _fetch_table_rows_from_db(parent_doc, field)
        matched = _match_rows_to_item(parent_rows, so_item)
        if matched:
            return matched

    for field in _GUEST_MATERIAL_TABLE_FIELDS:
        rows = _fetch_child_rows_for_item(so_item, field)
        if rows:
            return rows

    return []


def _ensure_sales_order_items(doc: Document) -> Document:
    if doc.get("items"):
        return doc

    try:
        doc.reload()
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "Guest Material Reservation: reload failed; falling back to direct query",
        )

    if doc.get("items"):
        return doc

    for table_field in _ITEM_TABLES:
        try:
            table_rows = doc.get(table_field)
            if table_rows:
                doc.set("items", table_rows)
                return doc
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"Guest Material Reservation: failed reading {table_field} from doc",
            )

    try:
        doc_data = doc.as_dict()
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "Guest Material Reservation: as_dict() fallback failed",
        )
        doc_data = {}

    if doc_data:
        child_rows = doc_data.get("items") or []
        if child_rows:
            prepared_from_dict = []
            for row in child_rows:
                data = dict(row)
                data.setdefault("doctype", "Sales Order Item")
                prepared_from_dict.append(_dict(data))

            doc.set("items", prepared_from_dict)
            return doc

    try:
        items = frappe.get_all(
            "Sales Order Item",
            filters={"parent": doc.name},
            fields="*",
            order_by="idx asc",
        )
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "Guest Material Reservation: failed to load Sales Order items",
        )
        return doc

    if items:
        prepared = []
        for row in items:
            data = dict(row)
            data.setdefault("doctype", "Sales Order Item")
            prepared.append(_dict(data))
        doc.set("items", prepared)

    return doc


def guest_material_reservation(doc: Document, method: str):
    doc = _ensure_sales_order_items(doc)


    for so_item in doc.as_dict().get("items"):
        frappe.msgprint(f"item: {so_item}")

        so_item = frappe.get_doc("Sales Order Item", so_item["name"])

        guest_material_rows = _get_guest_material_rows(doc, so_item)
        if not guest_material_rows:
            continue

        so_item_name = so_item.get("name")
        so_item_code = so_item.get("item_code")
        so_item_project = so_item.get("project") or doc.get("project")
        default_warehouse = so_item.get("warehouse") or doc.get("set_warehouse")

        for guest_material in guest_material_rows:
            item_code = guest_material.get("item_code") or so_item_code
            qty_to_reserve = guest_material.get("qty_to_reserve", 0)
            warehouse = guest_material.get("warehouse") or default_warehouse

            if not item_code or qty_to_reserve <= 0:
                continue

            try:
                sr_doc = frappe.new_doc("Stock Reservation Entry")

                sr_doc.item_code = item_code
                target_warehouse = _resolve_target_warehouse(doc.company, warehouse)
                if not target_warehouse:
                    frappe.throw(
                        _("Nincs beállítva raktár a vendéganyag foglaláshoz."),
                        title=_("Hiányzó raktár"),
                    )

                sr_doc.warehouse = target_warehouse
                sr_doc.company = doc.company
                sr_doc.voucher_type = "Sales Order"
                sr_doc.voucher_no = doc.name
                voucher_detail_no = _resolve_voucher_detail_no(so_item, guest_material)
                if not voucher_detail_no:
                    frappe.throw(
                        _(
                            "Nem található megfelelő Sales Order tételsor a(z) {0} anyaghoz."
                        ).format(item_code),
                        title=_("Hiányzó tételsor"),
                    )
                sr_doc.voucher_detail_no = voucher_detail_no
                sr_doc.voucher_qty = qty_to_reserve
                sr_doc.reserved_qty = qty_to_reserve
                sr_doc.stock_uom = (
                    guest_material.get("stock_uom")
                    or so_item.get("stock_uom")
                    or frappe.db.get_value("Item", item_code, "stock_uom")
                )
                sr_doc.project = guest_material.get("project") or so_item_project

                sr_doc.quantity = qty_to_reserve
                sr_doc.reference_doctype = "Sales Order Item"
                sr_doc.reference_name = voucher_detail_no
                sr_doc.save()
                sr_doc.submit()

                frappe.msgprint(
                    _("Sikeresen lefoglalva: {0} db/méter {1} anyag (SO sor: {2}).").format(
                        qty_to_reserve, item_code, so_item_name
                    ),
                    title="Vendéganyag Foglalás",
                )

            except Exception as e:
                frappe.log_error(
                    f"Vendéganyag foglalása sikertelen (Sales Order Item: {so_item_name}, Item: {item_code}): {e}",
                    "Vendéganyag Foglalás Hiba",
                )
                frappe.throw(
                    _("HIBA történt a(z) {0} anyag foglalása közben. Ellenőrizze a készletet!").format(
                        item_code
                    ),
                    title=_("Kritikus Hiba!"),
                )