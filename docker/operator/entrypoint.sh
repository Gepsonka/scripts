#!/bin/bash
# Vendored from vyogotech/frappe-erpnext-images-for-operator (Apache-2.0)
# https://github.com/vyogotech/frappe-erpnext-images-for-operator
#
# Generic entrypoint expected by the frappe-operator: it maps an arbitrary
# runtime UID into /etc/passwd (OpenShift-style) when needed, then execs
# whatever command/args the operator configured for the container
# (gunicorn CMD, nginx-entrypoint.sh, "bench schedule", "bench worker ...").
set -e

# if the running uid is not in /etc/passwd, create it
# This is required for OpenShift compatibility
if ! whoami &> /dev/null; then
  if [ -w /etc/passwd ]; then
    echo "Mapping arbitrary UID $(id -u) to frappe user in /etc/passwd"
    echo "${USER_NAME:-frappe}:x:$(id -u):0:${USER_NAME:-frappe} user:${HOME}:/sbin/nologin" >> /etc/passwd
  else
    echo "Warning: /etc/passwd is not writable. Cannot map UID $(id -u)."
  fi
fi

echo "Current User: $(id -u), Group: $(id -g)"
echo "Home Directory: ${HOME}"

exec "$@"
