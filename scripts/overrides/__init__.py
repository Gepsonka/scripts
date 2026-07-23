"""Overrides package."""
import logging

_logger = logging.getLogger(__name__)

try:
    from scripts.overrides.get_item_details_patch import install

    install()
    _logger.info("Price inheritance patch installed successfully")
except Exception:
    _logger.exception("Failed to install price inheritance patch")
