#!/usr/bin/env bash
# Demo upgrade: point the bench at a newly built image tag and let the
# operator roll it out. This is the anti-stale-cache flow:
#
#   1. Build a NEW tag (never reuse tags):
#        docker build -f docker/Dockerfile -t erpnext-scripts:$TAG .
#        docker build -f docker/Dockerfile.operator --build-arg BASE_IMAGE=erpnext-scripts:$TAG \
#          -t erpnext-scripts-operator:$TAG .
#   2. Run this script: ./upgrade.sh $TAG
#
# The operator then:
#   - deletes and re-creates the bench init job with the new image
#     (re-syncs /home/frappe/assets_cache -> sites/assets PVC, fresh
#     Last-Modified on the scripts app's public files thanks to the
#     Dockerfile `touch` step),
#   - rolling-updates gunicorn/nginx/socketio/scheduler/workers,
#   - and once this script bumps the frappe.io/site-version annotation
#     (REQUIRED - a bench image change alone does NOT re-run site
#     init), re-runs the site init job as an upgrade: bench migrate,
#     app install, admin password sync, and bench clear-cache (with a
#     direct Redis flush fallback that preserves sessions).
set -euo pipefail

TAG="${1:?usage: $0 <new-image-tag>}"
NAMESPACE=frappe-demo
BENCH=scripts-bench
SITE=demo-site

echo "==> Patching FrappeBench/$BENCH to image tag: $TAG"
kubectl -n "$NAMESPACE" patch frappebench "$BENCH" --type merge \
  -p "{\"spec\":{\"imageConfig\":{\"tag\":\"$TAG\"}}}"

echo "==> Waiting for bench re-init (asset re-sync) on the new image"
kubectl -n "$NAMESPACE" wait \
  --for=jsonpath='{.status.initializedImage}'=erpnext-scripts-operator:"$TAG" \
  frappebench "$BENCH" --timeout=900s

echo "==> Triggering site upgrade (frappe.io/site-version=$TAG)"
kubectl -n "$NAMESPACE" annotate frappesite "$SITE" \
  "frappe.io/site-version=$TAG" --overwrite

echo "==> Waiting for site upgrade (migrate + cache clear)"
sleep 15
kubectl -n "$NAMESPACE" wait --for=condition=complete \
  job/"$SITE"-init --timeout=900s
kubectl -n "$NAMESPACE" wait \
  --for=jsonpath='{.status.phase}'=Ready \
  frappesite "$SITE" --timeout=300s

echo "==> Rollout complete"
kubectl -n "$NAMESPACE" get pods
