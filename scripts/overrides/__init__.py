"""Overrides package — auto-installs the price-inheritance patch."""
try:
    from scripts.overrides.get_item_details_patch import install

    install()
except Exception:
    # Failures during Docker build (compile-translations.py) or early
    # startup are expected — the patch will be re-attempted on the
    # first request that triggers a doctype load.
    pass
