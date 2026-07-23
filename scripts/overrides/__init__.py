"""Overrides package — auto-installs the price-inheritance patch."""
# The try/except is required for the Docker build (compile-translations.py
# runs before erpnext is installed, so the erpnext import below would
# fail and crash the entire build).  At runtime (after erpnext is loaded)
# this always succeeds.
try:
    from scripts.overrides.get_item_details_patch import install

    install()
except Exception:
    pass
