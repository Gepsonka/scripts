#!/bin/bash
set -e

ASSETS_PATH="/home/frappe/frappe-bench/sites/assets"
BAKED_PATH="/home/frappe/frappe-bench/assets"

echo "Linking fresh assets to volume..."
rm -rf "$ASSETS_PATH"
mkdir -p "$(dirname "$ASSETS_PATH")"
ln -s "$BAKED_PATH" "$ASSETS_PATH"

# Clear all Frappe caches so the new code/assets take effect immediately.
# This runs on every pod start (deployments, restarts) and ensures stale
# Python bytecode, Redis keys and asset version maps are purged.
echo "Clearing Frappe caches..."
bench clear-cache || true

exec "$@"
