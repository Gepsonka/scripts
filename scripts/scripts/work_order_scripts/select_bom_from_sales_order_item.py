import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint

def set_specific_bom_from_so(doc, method):
    """
    Hooked to Work Order 'before_validate'.
    Dynamically selects the correct BOM based on Sales Order Item fields.
    """
    # 1. Ensure this Work Order is linked to a Sales Order Item
    if not doc.sales_order or not doc.sales_order_item:
        frappe.msgprint("not linket to sales order item")
        return

    # 2. Only run this for new, unsaved Work Orders to avoid overwriting manual changes
    if not doc.is_new():
        return

    # 3. Fetch the custom fields from the linked Sales Order Item
    so_item = frappe.db.get_value(
        "Sales Order Item",
        {"name": doc.sales_order_item},
        ["fabric", "finishing"],
        as_dict=True
    )

    if not so_item or not so_item.fabric:
        return

    # 4. Query the BOM table for a match
    matching_bom = frappe.db.get_value(
        "BOM",
        {
            "item": doc.production_item,
            "main_fabric": so_item.fabric,
            "default_finishing": so_item.finishing,
            "is_active": 1,
            "docstatus": 1 # Ensure the BOM is submitted
        },
        "name",
        order_by="creation desc" # Get the latest one if there are multiple
    )

    # 5. Apply the matching BOM
    if matching_bom:
        if doc.bom_no != matching_bom:
            doc.bom_no = matching_bom
            
            # Clear existing items/operations so ERPNext's standard validate logic
            # rebuilds them based on the new BOM we just assigned.
            doc.set("required_items", [])
            doc.set("operations", [])
            
            frappe.msgprint(
                f"BOM automatically set to <b>{matching_bom}</b> based on Sales Order requirements.",
                alert=True,
                indicator="green"
            )
    else:
        # Fallback if no matching BOM exists
        frappe.msgprint(
            f"No matching BOM found for Fabric: {so_item.fabric} and Finishing: {so_item.finishing}. "
            f"Falling back to default BOM.",
            alert=True,
            indicator="orange"
        )

def autofill_merettipus_from_so(doc, method):
    """
    Hooked to Work Order 'before_validate'.
    Automatically fills the 'merettipus' child table based on the Sales Order Item's item_group.
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

    # 3. Fetch the item_group from the linked Sales Order Item
    so_item = frappe.db.get_value(
        "Sales Order Item",
        {"name": doc.sales_order_item},
        ["item_group"],
        as_dict=True
    )

    if not so_item or not so_item.item_group:
        return

    # 4. Map item_group to Merettabla name
    merettabla_map = {
        "Oltonyok": "MT-OLTONY",
        "Nadragok": "MT-NADRAG",
        "Mellenyek": "MT-MELLENY",
    }

    merettabla_name = merettabla_map.get(so_item.item_group)
    if not merettabla_name:
        return

    # 5. Fetch the meret rows from the Merettabla
    meret_rows = frappe.db.get_values(
        "Meret",
        {"parent": merettabla_name, "parenttype": "Merettabla"},
        ["size_type_link", "size", "uom"],
        as_dict=True
    )

    if not meret_rows:
        frappe.msgprint(
            f"No Meret rows found in <b>{merettabla_name}</b> for item group <b>{so_item.item_group}</b>.",
            alert=True,
            indicator="orange"
        )
        return

    # 6. Clear existing rows and populate with fetched data
    doc.set("merettipus", [])
    for row in meret_rows:
        doc.append("merettipus", {
            "size_type_link": row.size_type_link,
            "size": row.size,
            "uom": row.uom,
        })

    frappe.msgprint(
        f"Merettipus child table filled with data from <b>{merettabla_name}</b> based on item group <b>{so_item.item_group}</b>.",
        alert=True,
        indicator="green"
    )