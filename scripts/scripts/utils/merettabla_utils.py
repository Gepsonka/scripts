import frappe


def get_merettabla_for_fazon(fazon_name: str) -> str | None:
    """
    Retrieves the Merettabla (size table) linked to a given Fazon (style).
    
    Args:
        fazon_name: The name of the Fazon record
        
    Returns:
        The name of the linked Merettabla if found, None otherwise
    """
    if not fazon_name:
        return None
    
    merettabla = frappe.db.get_value(
        "Fazon",
        fazon_name,
        "custom_merettabla"
    )
    
    return merettabla


def get_merettabla_sizes(merettabla_name: str) -> list[dict]:
    """
    Retrieves all size rows from a Merettabla.
    
    Args:
        merettabla_name: The name of the Merettabla record
        
    Returns:
        List of dictionaries containing size_type_link, size, and uom
    """
    if not merettabla_name:
        return []
    
    meret_rows = frappe.db.get_values(
        "Meret",
        {"parent": merettabla_name, "parenttype": "Merettabla"},
        ["size_type_link", "size", "uom"],
        as_dict=True
    )
    
    return meret_rows or []


@frappe.whitelist()
def api_get_merettabla_for_fazon(fazon_name: str) -> dict:
    """
    Whitelisted API to get Merettabla and its sizes for a given Fazon.
    
    Args:
        fazon_name: The name of the Fazon record
        
    Returns:
        Dictionary with merettabla_name and sizes list
    """
    merettabla_name = get_merettabla_for_fazon(fazon_name)
    
    if not merettabla_name:
        return {
            "merettabla_name": None,
            "sizes": [],
            "message": f"No Merettabla linked to Fazon {fazon_name}"
        }
    
    sizes = get_merettabla_sizes(merettabla_name)
    
    return {
        "merettabla_name": merettabla_name,
        "sizes": sizes
    }
