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
#   - re-runs each site init job as an upgrade: bench migrate, app
#     install, admin password sync, and bench clear-cache (with a direct
#     Redis flush fallback that preserves sessions).
set -euo pipefail

TAG="${1:?usage: $0 <new-image-tag>}"
NAMESPACE=frappe-demo
BENCH=scripts-bench

echo "==> Patching FrappeBench/$BENCH to image tag: $TAG"
kubectl -n "$NAMESPACE" patch frappebench "$BENCH" --type merge \
  -p "{\"spec\":{\"imageConfig\":{\"tag\":\"$TAG\"}}}"

echo "==> Watching bench init job (asset re-sync)"
kubectl -n "$NAMESPACE" get jobs -w &
WATCH_PID=$!
trap 'kill $WATCH_PID 2>/dev/null || true' EXIT

kubectl -n "$NAMESPACE" wait \
  --for=jsonpath='{.status.initializedImage}'=erpnext-scripts-operator:"$TAG" \
  frappebench "$BENCH" --timeout=900s

echo "==> Waiting for site upgrade (migrate + cache clear)"
kubectl -n "$NAMESPACE" wait \
  --for=jsonpath='{.status.phase}'=Ready \
  frappesite demo-site --timeout=900s

echo "==> Rollout complete"
kubectl -n "$NAMESPACE" get pods
