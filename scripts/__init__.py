__version__ = "0.0.1"

# Patch get_item_price for variant->template price inheritance.
# Wrapped in try/except because this module may be imported during
# the Docker build (compile-translations.py) before erpnext is ready.
try:
    from scripts.overrides.get_item_details_patch import install

    install()
except Exception:
    pass

