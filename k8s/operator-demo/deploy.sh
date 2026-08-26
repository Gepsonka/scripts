#!/usr/bin/env bash
# One-shot installer for the frappe-operator demo stack on a local k3s
# (OrbStack Kubernetes). Idempotent - safe to re-run.
#
# Prereqs: kubectl pointed at the cluster, helm, docker, and the locally
# built images (see README.md):
#   erpnext-scripts:demo          (docker/Dockerfile)
#   erpnext-scripts-operator:demo (docker/Dockerfile.operator)
#
# What it installs:
#   1. ingress-nginx           (site ingress; OrbStack exposes it on *.k8s.orb.local)
#   2. mariadb-operator + CRDs (provisions per-site databases)
#   3. frappe-operator         (vyogotech, static manifest - no helm needed)
#   4. This directory's kustomization: namespace, MariaDB, FrappeBench, FrappeSite
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_INSTALL_URL="https://raw.githubusercontent.com/vyogotech/frappe-operator/release/install.yaml"
MARIADB_CRD_KUSTOMIZE="github.com/mariadb-operator/mariadb-operator/config/crd?ref=v0.34.0"
MARIADB_OPERATOR_VERSION="0.34.0"
INGRESS_NGINX_URL="https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml"

echo "==> Checking prerequisites"
command -v kubectl >/dev/null || { echo "kubectl not found"; exit 1; }
command -v helm >/dev/null || { echo "helm not found (brew install helm)"; exit 1; }
kubectl cluster-info >/dev/null

echo "==> [1/4] ingress-nginx"
if kubectl get namespace ingress-nginx >/dev/null 2>&1; then
  echo "    already installed, skipping"
else
  kubectl apply -f "$INGRESS_NGINX_URL"
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=300s
fi

echo "==> [2/4] mariadb-operator"
if kubectl get crd mariadbs.k8s.mariadb.com >/dev/null 2>&1; then
  echo "    CRDs already present, skipping CRD install"
else
  kubectl apply --server-side -k "$MARIADB_CRD_KUSTOMIZE"
fi
if helm status mariadb-operator -n mariadb-system >/dev/null 2>&1; then
  echo "    already installed, skipping"
else
  helm repo add mariadb-operator https://helm.mariadb.com/mariadb-operator >/dev/null
  helm repo update mariadb-operator >/dev/null
  helm install mariadb-operator mariadb-operator/mariadb-operator \
    --version "$MARIADB_OPERATOR_VERSION" \
    --namespace mariadb-system --create-namespace \
    --wait --timeout 5m
fi

echo "==> [3/4] frappe-operator"
if kubectl get crd frappebenches.vyogo.tech >/dev/null 2>&1; then
  echo "    already installed, skipping"
else
  kubectl apply --server-side -f "$OPERATOR_INSTALL_URL"
fi
# The static install.yaml is missing cluster-scope pods permissions
# (the helm chart grants them). Without them the operator can't watch
# pods and site deletions/reconciles stall.
if ! kubectl get clusterrole frappe-operator-manager-role -o json | grep -q '"pods"'; then
  echo "    patching ClusterRole: add pods,pods/log permissions"
  kubectl patch clusterrole frappe-operator-manager-role --type json \
    -p '[{"op":"add","path":"/rules/-","value":{"apiGroups":[""],"resources":["pods","pods/log"],"verbs":["create","delete","get","list","patch","update","watch"]}}]'
fi
kubectl wait --namespace frappe-operator-system \
  --for=condition=ready pod \
  --selector=control-plane=controller-manager \
  --timeout=300s

echo "==> [4/4] demo resources (namespace, MariaDB, FrappeBench, FrappeSite)"
kubectl apply -k "$DEMO_DIR"

echo "==> Waiting for MariaDB"
kubectl wait --namespace frappe-demo \
  --for=condition=ready mariadb frappe-mariadb \
  --timeout=300s

echo "==> Waiting for bench to become Ready (init job: assets sync)"
kubectl wait --namespace frappe-demo \
  --for=jsonpath='{.status.phase}'=Ready \
  frappebench scripts-bench \
  --timeout=900s || true

echo "==> Waiting for site to become Ready (bench new-site + app install)"
kubectl wait --namespace frappe-demo \
  --for=jsonpath='{.status.phase}'=Ready \
  frappesite demo-site \
  --timeout=900s || true

echo
echo "==> Status"
kubectl -n frappe-demo get frappebench,frappesite
kubectl -n frappe-demo get pods
echo
echo "Site:  http://demo.k8s.orb.local"
echo "Login: Administrator / $(kubectl -n frappe-demo get secret demo-site-admin-password -o jsonpath='{.data.password}' | base64 -d)"
echo
echo "Follow site creation logs with:"
echo "  kubectl -n frappe-demo logs job/demo-site-init -f"
