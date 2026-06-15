#!/bin/bash
set -e

ASSETS_PATH="/home/frappe/frappe-bench/sites/assets"
BAKED_PATH="/home/frappe/frappe-bench/assets"

echo "Linking fresh assets to volume..."
rm -rf "$ASSETS_PATH"
mkdir -p "$(dirname "$ASSETS_PATH")"
ln -s "$BAKED_PATH" "$ASSETS_PATH"

# Run any site-level setup if a site exists.
# We don't run `bench migrate` here - that's the job of the migrator Job
# in the deploy workflow, which runs before this container is rolled.

exec "$@"
