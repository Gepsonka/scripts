#!/usr/bin/env bash
# One-time setup of the secrets. Run inside `nix develop` (needs age, ssh-keygen, openssl, jq).
#
#   scripts/init.sh [--admin-key ~/.ssh/id_ed25519.pub] [--cf-creds ~/.cloudflared/<tunnel-uuid>.json]
#
# --admin-key replaces secrets/admin.pub. Without it an existing admin.pub (several keys, one per line)
# is kept, and only a CHANGEME placeholder is replaced by ~/.ssh/id_ed25519.pub.
#
# Creates:
#   install-root/etc/ssh/ssh_host_ed25519_key   THE decryption key. Back it up. Never commit it.
#   secrets/host.pub, secrets/admin.pub         public keys the secrets are encrypted to
#   secrets/*.age                               encrypted secrets (safe to commit)
# Existing .age files are kept unless you pass --force.
#
# Non-interactive use: export ERP_ADMIN_PASSWORD, ERP_ENCRYPTION_KEY, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
# TAILSCALE_AUTHKEY, HEALTHCHECKS_PING_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."

admin_key=""
cf_creds=""
force=0
while [ $# -gt 0 ]; do
  case "$1" in
    --admin-key) admin_key="$2"; shift 2 ;;
    --cf-creds) cf_creds="$2"; shift 2 ;;
    --force) force=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in age ssh-keygen openssl; do
  command -v "$tool" >/dev/null || { echo "missing '$tool'. Run inside: nix develop" >&2; exit 1; }
done
if [ -z "$admin_key" ] && grep -q CHANGEME secrets/admin.pub 2>/dev/null; then
  admin_key="$HOME/.ssh/id_ed25519.pub"
fi
if [ -n "$admin_key" ]; then
  [ -r "$admin_key" ] || { echo "admin public key not found: $admin_key (use --admin-key)" >&2; exit 1; }
fi

keydir=install-root/etc/ssh
hostkey=$keydir/ssh_host_ed25519_key
mkdir -p "$keydir" secrets
chmod 700 install-root

# 1) the decryption key
if [ ! -f "$hostkey" ]; then
  ssh-keygen -q -t ed25519 -N '' -C "erpnext-host" -f "$hostkey"
  echo ">> generated the decryption key: $hostkey"
  echo "   BACK IT UP NOW (password manager / offline). Without it the secrets cannot be decrypted."
fi
cp "$hostkey.pub" secrets/host.pub
if [ -n "$admin_key" ]; then cp "$admin_key" secrets/admin.pub; fi

# every secret is encrypted to the admin key(s) and the host key.
# age only takes ed25519/rsa ssh keys; other admin keys still get ssh access, they just cannot decrypt.
recipients=$(mktemp)
trap 'rm -f "$recipients"' EXIT
grep -hE '^(ssh-ed25519|ssh-rsa) ' secrets/admin.pub secrets/host.pub > "$recipients"
if ! grep -qE '^(ssh-ed25519|ssh-rsa) ' secrets/admin.pub; then
  echo "   !! no ed25519/rsa key in secrets/admin.pub: only the host key can decrypt, you cannot edit secrets" >&2
fi

# encrypt <name>  (plaintext on stdin)
encrypt() {
  local f="secrets/$1.age"
  if [ -f "$f" ] && [ "$force" -ne 1 ]; then
    echo "   keep   $f (exists, use --force to replace)"
    cat >/dev/null
    return 0
  fi
  age -R "$recipients" -o "$f"
  echo "   wrote  $f"
}

# value <ENV_VAR> <prompt>  : from the environment, else hidden prompt
value() {
  local var="$1" prompt="$2" v
  if [ -n "${!var:-}" ]; then printf '%s' "${!var}"; return; fi
  read -r -s -p "$prompt: " v </dev/tty
  echo >&2
  printf '%s' "$v"
}
random() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }

echo ">> encrypting secrets"

if [ -n "$cf_creds" ]; then
  [ -r "$cf_creds" ] || { echo "cannot read $cf_creds" >&2; exit 1; }
  encrypt cloudflared-credentials < "$cf_creds"
  if command -v jq >/dev/null; then
    echo "   tunnel id: $(jq -r .TunnelID "$cf_creds")  <- put this in settings.nix (cloudflare.tunnelId)"
  fi
elif [ ! -f secrets/cloudflared-credentials.age ]; then
  echo "   !! secrets/cloudflared-credentials.age missing: re-run with --cf-creds ~/.cloudflared/<uuid>.json" >&2
fi

random 32 | encrypt mysql-root-password
random 32 | encrypt site-db-password

if [ ! -f secrets/admin-password.age ] || [ "$force" -eq 1 ]; then
  pw=$(value ERP_ADMIN_PASSWORD "ERPNext Administrator password (empty = generate)")
  if [ -z "$pw" ]; then pw=$(random 20); echo "   generated Administrator password: $pw  (store it now)"; fi
  printf '%s' "$pw" | encrypt admin-password
else encrypt admin-password </dev/null; fi

if [ ! -f secrets/encryption-key.age ] || [ "$force" -eq 1 ]; then
  k=$(value ERP_ENCRYPTION_KEY "Frappe encryption_key (paste the LIVE one to restore data; empty = generate new)")
  if [ -z "$k" ]; then k=$(openssl rand -base64 32 | tr '+/' '-_'); echo "   generated a NEW encryption_key (cannot decrypt data from another site)"; fi
  printf '%s' "$k" | encrypt encryption-key
else encrypt encryption-key </dev/null; fi

if [ ! -f secrets/r2-access-key-id.age ] || [ "$force" -eq 1 ]; then
  value R2_ACCESS_KEY_ID "R2 access key id" | encrypt r2-access-key-id
else encrypt r2-access-key-id </dev/null; fi
if [ ! -f secrets/r2-secret-access-key.age ] || [ "$force" -eq 1 ]; then
  value R2_SECRET_ACCESS_KEY "R2 secret access key" | encrypt r2-secret-access-key
else encrypt r2-secret-access-key </dev/null; fi

# Tailscale admin console > Settings > Keys: a pre-approved auth key (tskey-auth-...)
if [ ! -f secrets/tailscale-authkey.age ] || [ "$force" -eq 1 ]; then
  value TAILSCALE_AUTHKEY "Tailscale auth key (tskey-auth-...)" | encrypt tailscale-authkey
else encrypt tailscale-authkey </dev/null; fi

# Optional. healthchecks.io > project > Settings > API Access: the project "Ping key" (enables email alerts)
if [ ! -f secrets/healthchecks-ping-key.age ] || [ "$force" -eq 1 ]; then
  k=""
  # no terminal to prompt on (non-interactive run) = skip
  if [ -n "${HEALTHCHECKS_PING_KEY:-}" ] || (: </dev/tty) 2>/dev/null; then
    k=$(value HEALTHCHECKS_PING_KEY "healthchecks.io ping key (empty = no email alerts)")
  fi
  if [ -n "$k" ]; then printf '%s' "$k" | encrypt healthchecks-ping-key; else echo "   skip   secrets/healthchecks-ping-key.age"; fi
else encrypt healthchecks-ping-key </dev/null; fi

cat <<'MSG'

Done. Next:
  1. Fill the remaining CHANGEME values in settings.nix
  2. git add -A     (flakes only see tracked files; install-root/ is gitignored on purpose)
  3. scripts/build-iso.sh   (autoinstall stick)
     or: scripts/install.sh --key install-root/etc/ssh/ssh_host_ed25519_key root@<installer-ip>
MSG
