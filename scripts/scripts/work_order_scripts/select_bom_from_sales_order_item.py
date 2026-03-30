import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


def is_template_item(item_code):
    if not item_code:
        return False

    item_fields = ["has_variants", "variant_of"]
    if frappe.db.has_column("Item", "is_template"):
        item_fields.append("is_template")

    item = frappe.db.get_value("Item", item_code, item_fields, as_dict=True)
    if not item:
        return False

    is_template_flag = cint(item.get("is_template")) if item.get("is_template") is not None else 0
    return cint(item.get("has_variants")) or (is_template_flag and not item.get("variant_of"))


def get_sales_order_item_fabric(sales_order_item_name):
    if not sales_order_item_name:
        return None

    so_item = frappe.db.get_value(
        "Sales Order Item",
        {"name": sales_order_item_name},
        ["custom_anyag", "fabric"],
        as_dict=True,
    )
    if not so_item:
        return None

    return so_item.custom_anyag or so_item.fabric


def get_sales_order_item_kidolgozas(sales_order_item_name):
    if not sales_order_item_name:
        return None

    so_item = frappe.db.get_value(
        "Sales Order Item",
        {"name": sales_order_item_name},
        ["finishing", "custom_kidolgozasok", "custom_kidolgozas"],
        as_dict=True,
    )
    if not so_item:
        return None

    return so_item.finishing or so_item.custom_kidolgozasok or so_item.custom_kidolgozas


def get_matching_bom_for_item_and_fabric(item_code, fabric_code, kidolgozas=None):
    if not item_code or not fabric_code:
        return None

    if is_template_item(fabric_code):
        return None

    base_filters = {
        "item": item_code,
        "main_fabric": fabric_code,
        "is_active": 1,
        "docstatus": 1,
    }

    if kidolgozas:
        exact_match = frappe.db.get_value(
            "BOM",
            {**base_filters, "kidolgozasok": kidolgozas},
            "name",
        )
        if exact_match:
            return exact_match

    return frappe.db.get_value("BOM", base_filters, "name")


def get_bom_kidolgozas(bom_name):
    if not bom_name:
        return None

    bom = frappe.db.get_value(
        "BOM",
        bom_name,
        ["kidolgozasok", "custom_kidolgozasok"],
        as_dict=True,
    )
    if not bom:
        return None

    return bom.kidolgozasok or bom.custom_kidolgozasok

def set_specific_bom_from_so(doc, method):
    """
    Hooked to Work Order 'before_validate'.
    For a non-template fabric selected on the originating Sales Order Item,
    replace the current/default BOM with the best matching BOM.
    Matching priority: item + fabric + kidolgozas, then item + fabric, else keep default BOM.
    """
    if not doc.sales_order or not doc.sales_order_item:
        return

    if not doc.is_new():
        return

    fabric_code = get_sales_order_item_fabric(doc.sales_order_item)
    kidolgozas = get_sales_order_item_kidolgozas(doc.sales_order_item)
    matching_bom = get_matching_bom_for_item_and_fabric(doc.production_item, fabric_code, kidolgozas)

    if not matching_bom or doc.bom_no == matching_bom:
        return

    doc.bom_no = matching_bom

    # Clear existing items/operations so ERPNext rebuilds them from the replacement BOM.
    doc.set("required_items", [])
    doc.set("operations", [])

    frappe.msgprint(
        _(
            "BOM automatically set to <b>{0}</b> based on item, fabric {1}, and kidolgozas {2}."
        ).format(matching_bom, fabric_code, kidolgozas or _("default")),
        alert=True,
        indicator="green",
    )

def autofill_merettipus_from_so(doc, method):
    """
    Hooked to Work Order 'before_validate'.
    Automatically fills the 'merettipus' child table based on the Sales Order Item's custom_fazon.
    The Fazon's custom_merettabla field contains the link to the Merettabla.
    
    If custom_fazon or its Merettabla is not set, falls back to item_group mapping:
    - Oltonyok -> MT-OLTONY merettabla
    - Nadragok -> MT-NADRAG merettabla
    - Mellenyek -> MT-MELLENY merettabla
    """
    # 1. Ensure this Work Order is linked to a Sales Order Item
    if not doc.sales_order or not doc.sales_order_item:
        return

    # 2. Only run this for new, unsaved Work Orders to avoid overwriting manual changes
    if not doc.is_new():
        return

    # 3. Fetch custom_fazon and item_group from the linked Sales Order Item
    so_item = frappe.db.get_value(
        "Sales Order Item",
        {"name": doc.sales_order_item},
        ["custom_fazon", "item_group"],
        as_dict=True
    )

    if not so_item:
        return

    merettabla_name = None
    
    # 4. Try to get Merettabla from Fazon first
    if so_item.custom_fazon:
        fazon_merettabla = frappe.db.get_value(
            "Fazon",
            so_item.custom_fazon,
            "custom_merettabla"
        )
        if fazon_merettabla:
            merettabla_name = fazon_merettabla

    # 5. Fall back to item_group mapping if no Merettabla from Fazon
    if not merettabla_name:
        merettabla_map = {
            "Oltonyok": "MT-OLTONY",
            "Nadragok": "MT-NADRAG",
            "Mellenyek": "MT-MELLENY",
        }
        merettabla_name = merettabla_map.get(so_item.item_group)

    if not merettabla_name:
        return

    # 6. Fetch the meret rows from the Merettabla
    meret_rows = frappe.db.get_values(
        "Meret",
        {"parent": merettabla_name, "parenttype": "Merettabla"},
        ["size_type_link", "size", "uom"],
        as_dict=True
    )

    if not meret_rows:
        frappe.msgprint(
            f"No Meret rows found in <b>{merettabla_name}</b>.",
            alert=True,
            indicator="orange"
        )
        return

    # 7. Clear existing rows and populate with fetched data
    doc.set("merettipus", [])
    for row in meret_rows:
        doc.append("merettipus", {
            "size_type_link": row.size_type_link,
            "size": row.size,
            "uom": row.uom,
        })

    frappe.msgprint(
        f"Merettipus child table filled with data from <b>{merettabla_name}</b>.",
        alert=True,
        indicator="green"
    )

def propagate_so_item_custom_fields(doc, method):
    """
    Hooked to Work Order 'on_save'.
    Copies custom fields from Sales Order Item to Work Order when:
    - A Work Order is created from a Sales Order Item
    - The SO Item has custom_fazon, custom_szett, custom_meret, custom_anyag, 
      custom_kidolgozasok, custom_merettabla values
    
    Args:
        doc: Work Order document
        method: Hook method (on_save)
    """
    # 1. Ensure this Work Order is linked to a Sales Order Item
    if not doc.sales_order or not doc.sales_order_item:
        return

    # 2. Only run this for new, unsaved Work Orders to avoid overwriting manual changes
    if not doc.is_new():
        return

    # 3. Fetch custom fields from the linked Sales Order Item
    so_item = frappe.db.get_value(
        "Sales Order Item",
        {"name": doc.sales_order_item},
        ["custom_fazon", "custom_szett", "custom_meret", "custom_anyag", "fabric",
         "finishing", "custom_kidolgozasok", "custom_kidolgozas", "custom_merettabla"],
        as_dict=True
    )

    if not so_item:
        return

    # 4. Copy custom_fazon from SO Item to Work Order
    if hasattr(so_item, 'custom_fazon') and so_item.custom_fazon:
        doc.custom_fazon = so_item.custom_fazon

    # 5. Copy custom_szett from SO Item to Work Order
    if hasattr(so_item, 'custom_szett') and so_item.custom_szett:
        doc.custom_szett = so_item.custom_szett

    # 6. Copy custom_meret from SO Item to Work Order
    if hasattr(so_item, 'custom_meret') and so_item.custom_meret:
        doc.custom_meret = so_item.custom_meret

    # 7. Copy custom_anyag (fabric) from SO Item to Work Order
    selected_fabric = getattr(so_item, 'custom_anyag', None) or getattr(so_item, 'fabric', None)
    if selected_fabric:
        doc.custom_anyag = selected_fabric

    # 8. Copy kidolgozas (finishing) from SO Item to Work Order.
    #    Priority: Sales Order Item > matching BOM default.
    selected_kidolgozas = (
        getattr(so_item, 'finishing', None)
        or getattr(so_item, 'custom_kidolgozasok', None)
        or getattr(so_item, 'custom_kidolgozas', None)
    )
    if selected_kidolgozas:
        doc.kidolgozas = selected_kidolgozas
        doc.kidolgozasok = selected_kidolgozas
        doc.custom_kidolgozasok = selected_kidolgozas
    else:
        bom_name = doc.bom_no
        if selected_fabric and doc.production_item:
            bom_name = get_matching_bom_for_item_and_fabric(doc.production_item, selected_fabric) or bom_name

        matched_kidolgozas = get_bom_kidolgozas(bom_name)
        if matched_kidolgozas:
            doc.kidolgozas = matched_kidolgozas
            doc.kidolgozasok = matched_kidolgozas
            doc.custom_kidolgozasok = matched_kidolgozas

    # 9. Copy custom_merettabla from SO Item to Work Order
    if hasattr(so_item, 'custom_merettabla') and so_item.custom_merettabla:
        doc.custom_merettabla = so_item.custom_merettabla