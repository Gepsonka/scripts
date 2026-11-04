# ERPNext server (NixOS)

This folder is a self-contained flake inside the `scripts` repo (the app and image build live one level up).
Every path and command below is relative to this folder: `cd nixos` first. `install-root/` (the decryption key,
the ISO) is gitignored: keep it here, never commit it.

On-prem **ERPNext (frappe-operator) on k3s on NixOS**, mirror of the live `frappe-prod` deployment.

## What you get

- **No open ports, except one you opted into.** Firewall is default-deny, k3s `servicelb` is off, Traefik is a ClusterIP (no host ports, no NodePorts). The single exception is **TCP 22 from the local network, key-only** (see below), switchable with `localSsh.enable` in `settings.nix`. With it off, `sshd` listens on `127.0.0.1` only.
- **Web only through Cloudflare: tunnel (outbound only) + Zero Trust Access.** The ERP origin also rejects any request without a valid Cloudflare Access JWT. No SSH goes through Cloudflare.
- **From outside: Tailscale SSH.** No open port, no VPN server: tailscaled serves SSH on the Tailscale IP, and the tailnet policy decides who gets in. Tailscale does not touch the firewall, which opens nothing on `tailscale0`, so the ERP web and k3s are never reachable over the tailnet.
- **USB closed.** Kernel `nousb`, devices never authorized, every USB/Thunderbolt/FireWire/Bluetooth driver blacklisted and un-loadable, udev deauthorizes stragglers.
- **Secrets with agenix.** Encrypted in git, decrypted at boot with one key, never in the nix store.
- **Self-assembling.** After install, first boot creates the secrets, operator, MariaDB, bench, site and backups on its own.
- **Autoinstall ISO.** Boot the stick, walk away: it picks the disk, wipes it, installs offline and reboots.
- **Weekly auto-update** (Sunday 20:00): security fixes, kernel, k3s. Rolled back on its own if ERPNext is not healthy afterwards.
- **New ERPNext builds deploy themselves.** Every master build of the `scripts` app (its CI moves the `latest` tag) is rolled out within 5 minutes: migrate, cache clear, smoke test.
- **Email alerts** when a service goes down, the server goes offline, or an update or deploy fails.

```
Browser --> Cloudflare (Access login) --> tunnel (outbound from the box) --> Traefik ClusterIP 10.43.0.80 --> ERPNext

LAN      --> TCP 22, sshd (private source addresses only; key-only)
Outside  --> Tailscale (outbound from the box) --> Tailscale SSH (tailnet login + policy)
```

## Layout

| Path | Purpose |
|---|---|
| `settings.nix` | All non-secret, site-specific values. `CHANGEME` blocks the build. |
| `secrets/` | agenix rules, public keys, encrypted `*.age` files |
| `modules/hardening.nix` | USB, firewall, sysctl |
| `modules/ssh.nix` | key-only accounts, sshd (loopback by default) |
| `modules/local-ssh.nix` | SSH from the local network (port 22) |
| `modules/cloudflared.nix` | tunnel unit + Access enforcement at the origin |
| `modules/tailscale.nix` | tailnet join (auth key), Tailscale SSH for access from outside |
| `modules/k3s.nix` | k3s, Traefik as ClusterIP |
| `modules/erpnext/` | operator, MariaDB, bench/site CRs, R2 backups, bootstrap service |
| `modules/maintenance/` | weekly auto-update, health watchdog, healthchecks.io alerts |
| `scripts/init.sh` | generate the decryption key, encrypt all secrets |
| `hosts/installer/` | autoinstall ISO (boots, wipes the disk, installs offline, reboots) |
| `scripts/build-iso.sh` | build the autoinstall ISO |
| `scripts/install.sh` | alternative: install over ssh (nixos-anywhere + disko) |

## SSH from the local network

Controlled by `localSsh` in `settings.nix` (on by default). Gates, all three apply:

- **Interface:** `interface = null` (default) opens port 22 on every interface. `"en+"` limits it to wired ethernet.
- **Source:** only the networks in `allowedCidrs`. Default: every private range (`10/8`, `172.16/12`, `192.168/16`, `fd00::/8`), plus IPv6 link-local if `linkLocalIPv6 = true`. Connections from public internet addresses are dropped, even if the router forwards port 22. Narrow it to your LAN, e.g. `[ "192.168.1.0/24" ]`.
- **Auth:** ssh key only, 3 tries, no root, only the admin user. The keys are the lines of `secrets/admin.pub` (any type: ed25519, rsa, ecdsa, security keys).

Connect:

```bash
# The server's LAN address (DHCP from your router)
ssh admin@<server-lan-ip>

# Laptop cabled straight to the server, no IP setup (IPv6 link-local)
ping -6 ff02::1%<your-nic>            # find the server's fe80:: address
ssh admin@fe80::<server>%<your-nic>

# Laptop cabled straight to the server, fixed IPs: set localSsh.static, give the laptop 192.168.77.2/24
ssh admin@192.168.77.1
```

The server side must be a built-in NIC. USB ethernet adapters will not work on it because USB is disabled.

## SSH from outside: Tailscale SSH

The box joins your tailnet on first boot (auth key in `secrets/tailscale-authkey.age`) as `erpnext`, with Tailscale SSH on. Logins are decided by the **tailnet policy**, not by `secrets/admin.pub`. Add an `ssh` rule in the Tailscale admin console (Access controls), e.g. with the auth key tagged `tag:erpnext`:

```jsonc
"tagOwners": { "tag:erpnext": ["autogroup:admin"] },
"ssh": [
  {
    "action": "check",                          // browser re-login every 12h; "accept" = no re-check
    "src":    ["<botond's tailnet login>", "<beni's tailnet login>"],
    "dst":    ["tag:erpnext"],
    "users":  ["admin"]                         // log in as admin (passwordless sudo), never root
  }
]
```

With the default "allow all" access rules nothing else is needed. With restricted rules, also grant the same users `tcp:22` on `tag:erpnext`.

Connect from anywhere on the tailnet:

```bash
tailscale ssh admin@erpnext        # or plain: ssh admin@erpnext (MagicDNS name)
```

## 1. One-time Cloudflare setup (cannot be declared in Nix)

```bash
nix develop
cloudflared tunnel login
cloudflared tunnel create erpnext                      # prints the tunnel UUID, writes ~/.cloudflared/<uuid>.json
cloudflared tunnel route dns erpnext erp.d-trend.com   # at cutover time, see note below
```

In **Zero Trust > Access > Applications** create a *self-hosted* app for the ERP hostname with an allow policy (your IdP or emails), and copy its **AUD tag** into `settings.nix` (`cloudflare.erpAccessAudTag`).

Set `cloudflare.accessTeamName` (your `<team>.cloudflareaccess.com` prefix) and `cloudflare.tunnelId`.

**Cutover note:** `erp.d-trend.com` currently points at the Hetzner box. `route dns` refuses to overwrite it. Switch the record only when you are ready to move traffic.

## 2. Secrets

```bash
nix develop
scripts/init.sh --cf-creds ~/.cloudflared/<uuid>.json
```

This creates **the decryption key** at `install-root/etc/ssh/ssh_host_ed25519_key` (gitignored). **Back it up.** It is also sshd's host key. Then fill remaining `CHANGEME`s in `settings.nix` and `git add -A`.

`secrets/admin.pub` holds your ssh public keys, one per line. Put them there before running `init.sh` (or pass a single one with `--admin-key`). Only ed25519 and rsa keys can also decrypt secrets, age does not support the other types.

| Secret | Note |
|---|---|
| `encryption-key` | Paste the **live** Frappe `encryption_key` to restore existing data, otherwise stored passwords in a restored DB are unreadable |
| `admin-password` | ERPNext `Administrator` login |
| `r2-*` | Cloudflare R2 backup credentials |
| `tailscale-authkey` | Tailscale admin console > Settings > Keys: **pre-approved**, ideally **tagged** (tagged devices do not expire). One-time use is enough, it is only needed for the first join |
| `healthchecks-ping-key` | optional, turns on the email alerts (see [Updates and alerts](#updates-and-alerts)) |
| `mysql-root-password`, `site-db-password` | generated for you |

Edit later: `cd secrets && agenix -e admin-password.age`. Add a machine or admin key: edit `secrets/*.pub`, then `agenix -r`.

## 3. Install

### Option A: autoinstall ISO

```bash
nix develop
scripts/build-iso.sh                      # -> erpnext-autoinstall.iso
sudo dd if=erpnext-autoinstall.iso of=/dev/sdX bs=4M conv=fsync status=progress
```

Boot the target from the stick in **UEFI** mode (USB boot is fine, only the *installed* system disables USB). The default menu entry:

1. picks the disk: `settings.disk = "auto"` takes the only internal, non-USB disk of 16 GiB or more. With several it lists them and asks. A fixed `/dev/disk/by-id/...` path skips the question.
2. shows the disk and counts down **15 s. Any key aborts**, nothing is written.
3. wipes the disk, installs the system from the stick (no network needed), reboots. Remove the stick.

If the stick boots again after a finished install, it sees the existing install and asks you to type `WIPE` instead of erasing it. The second menu entry, *rescue shell (no install)*, boots the same live system without installing. Watch an install remotely: `ssh root@<installer-ip>` (your `admin.pub` keys), `journalctl -ft erpnext-autoinstall`.

**The ISO contains the decryption key.** Anyone with the image or the stick can decrypt every secret. Keep it like the key, wipe the stick after the install.

The ISO uses the generic `hosts/erpnext/hardware-configuration.nix`. To tune it later, run `nixos-generate-config --show-hardware-config` on the box and commit the result.

### Option B: over ssh (nixos-anywhere)

Needs a fixed `settings.disk` path. Boot the target from any NixOS installer (USB is fine, only the *installed* system disables USB) with root ssh, then:

```bash
scripts/install.sh --key install-root/etc/ssh/ssh_host_ed25519_key root@<installer-ip>
```

That key is the only secret you provide. The script refuses a key that does not match `secrets/host.pub`.

First boot (watch over LAN ssh or `tailscale ssh admin@erpnext`): `journalctl -fu erpnext-bootstrap`, then `kubectl -n frappe-prod get pods,frappesite`.

Commit the generated `hosts/erpnext/hardware-configuration.nix`.

## 4. Verify the claims

```bash
# from another machine on the LAN: only 22/tcp may answer (or nothing if localSsh.enable = false)
nmap -Pn -p- <server-ip>; sudo nmap -Pn -sU --top-ports 200 <server-ip>   # UDP must be all filtered
# from the internet (public source address), 22 must be filtered too
# over the tailnet: only Tailscale SSH answers, nothing else
nmap -Pn -p- erpnext

# on the server
sudo iptables -S nixos-fw | head          # only established/related + trusted pod interfaces
ls /sys/bus/usb/devices                    # empty or missing
sudo modprobe usb_storage                  # must fail
sudo systemctl status cloudflared-tunnel tailscaled erpnext-bootstrap
```

`ss -tlnp` will still show k3s sockets on `0.0.0.0` (API 6443, kubelet 10250). They are internal and dropped by the firewall from every external interface. The only accept rules are loopback, the two pod interfaces, and the stock DHCP client replies (v4, plus DHCPv6 on link-local only).

## 5. Day 2

- **Deploy changes:** `nixos-rebuild switch --flake .#erpnext --target-host admin@erpnext --sudo` (over the tailnet; or `admin@<server-lan-ip>` from the LAN).
- **New ERPNext image:** automatic, see [New ERPNext builds](#new-erpnext-builds).
- **Logs:** `kubectl -n frappe-prod logs -l app=...`, `k9s`.
- **Restore data from R2:** this config creates an *empty* site. Use the operator's `SiteRestore` CR or `bench restore` with the backup from the bucket.

## Updates and alerts

### Weekly auto-update

`erpnext-auto-update.timer`, `settings.autoUpdate.at` (default **Sunday 20:00**, server time zone):

1. takes the flake source the running system was built from (`/etc/erpnext/flake`), so a config you deployed by hand is never reverted
2. moves **only nixpkgs** to the newest commit of its release branch (`nixos-26.05`): security fixes, kernel, k3s, cloudflared, tailscale
3. builds and switches, then waits up to 20 min until there is **no new health problem** (see below). Otherwise it **rolls back** to the previous system
4. reboots only if the kernel changed (`autoUpdate.allowReboot`), so expect a few minutes of downtime some Sundays

Not updated by this job: the **ERPNext image** (see the next section) and the **NixOS release** itself. When the release reaches end-of-life its branch stops moving, and the update job reports a failure saying so. Then move `flake.nix` to the next release and deploy.

Run it now: `sudo systemctl start erpnext-auto-update`, log: `journalctl -u erpnext-auto-update`.

### New ERPNext builds

The image comes from this repo's app (`../docker`, `../.github/workflows/docker-build.yml`): every push to `master` builds `brotond/erpnext-scripts-operator` and tags it `build-NNN` and `latest`. The live cluster gets it pushed by that repo's deploy workflow; this server cannot be reached from CI (no inbound ports), so it **pulls** instead.

`erpnext-image-update.timer` (every 5 min, from 30 min after boot):

1. resolves `erpnext.image.channel` (`latest`) to the immutable `build-NNN` tag with the same digest
2. if the bench runs something else, deploys it the same way the deploy workflow does: point `FrappeBench/prod-bench` at it, wait for the bench re-init, annotate `FrappeSite/prod-site` with `frappe.io/site-version` (runs `bench migrate` + cache clear), wait for the site job, smoke test (`/api/method/ping`, `/login`)
3. reports to healthchecks (`erpnext-image`): ok, or fail with the log

There is **no automatic rollback**: the database is already migrated. A failed deploy stays reported until the site is healthy again. It never runs at the same time as the weekly OS update.

- `erpnext.image.tag` is only the image of the first install. Boots and config switches keep whatever build the bench runs now.
- **Pin a version:** set `erpnext.image.channel = null`, then `kubectl -n frappe-prod patch frappebench prod-bench --type merge -p '{"spec":{"imageConfig":{"tag":"build-NNN"}}}'` and annotate the site as above.
- **After cutover:** disable the `deploy-prod` job in `../.github/workflows/deploy.yml`, it targets the old server.
- Log: `journalctl -u erpnext-image-update`, run now: `sudo systemctl start erpnext-image-update`.

### Health watchdog and email

`erpnext-health` (run it by hand any time) checks:

- **systemd:** k3s, erpnext-bootstrap, cloudflared, tailscaled, sshd running, no failed unit
- **Kubernetes:** node Ready, no memory/disk/PID pressure, every Deployment/StatefulSet fully ready
- **Backups:** the daily backup and R2 push jobs succeeded within 26 h
- **ERPNext:** answers `/api/method/ping` through Traefik (the path cloudflared uses)
- **Tailscale:** logged in
- **Disk:** `/` and `/boot` below 85 %

`erpnext-watchdog.timer` runs it every 5 minutes (from 15 min after boot) and reports to [healthchecks.io](https://healthchecks.io), which sends the emails. A problem has to show up twice in a row (5 min apart) before it alerts. healthchecks.io emails you when:

- a check fails (`down`, with the list of problems) and when it recovers (`up`)
- the server stops reporting at all (power, network, crash)
- the weekly update fails or rolls back
- a new ERPNext build fails to deploy

Setup (free account):

1. Sign up at healthchecks.io with the address that should get the alerts (email notifications are on by default).
2. In the project, create three checks named exactly:
   - `erpnext-health`: **Simple**, period **5 minutes**, grace **20 minutes**
   - `erpnext-update`: **Cron** `0 20 * * 0`, time zone **Europe/Budapest**, grace **3 hours**
   - `erpnext-image`: **Simple**, period **5 minutes**, grace **1 hour** (a deploy can take ~30 min)
   (If you skip this, the server creates them on first ping, but with a 1-day period: an offline server would be noticed a day late.)
3. Project **Settings > API Access > Create ping key**, then
   `HEALTHCHECKS_PING_KEY=<key> scripts/init.sh`, `git add -A`, rebuild/deploy.

Without the key the build warns and the server sends no alerts of its own.

**Second channel, Cloudflare:** a *Tunnel Health Alert* notification (Cloudflare dashboard > Notifications) emails when tunnel `erpnext-onprem` goes down, degraded, or healthy again. It needs nothing on the server.

## Known limits and trade-offs

- **Lockout is real.** No USB means LAN ssh (your ssh key) and Tailscale SSH (your tailnet login) are the only doors. If both break, you recover by reinstalling from an installer. Set a BIOS/UEFI password, because kernel-level blocking does not cover firmware. Leave USB boot enabled only while you install from the stick.
- **LAN SSH is a real inbound port.** It is key-only (no passwords exist) and only accepts private source addresses, but anything on the LAN can knock on it. Narrow `allowedCidrs` to your subnet, or set `localSsh.enable = false` to rely on Tailscale SSH alone.
- **Tailscale node key expiry.** Untagged machines drop off the tailnet after 180 days. Use a tagged auth key, or disable key expiry for `erpnext` in the admin console.
- **The autoinstall ISO is a secret.** It carries the decryption key. Copies also stay in the build machine's `/nix/store` until garbage-collected (`build-iso.sh` prints how).
- **`sudo` has no password** (there are no passwords at all). Protection is your ssh key on the LAN, your tailnet login from outside.
- **No disk encryption.** Unattended on-prem boot needs a key on the box anyway (TPM or remote unlock is a possible next step).
- **Operator pins:** `frappe-operator v4.1.2`, MariaDB `10.11`, first-install image `brotond/erpnext-scripts-operator:build-88` (newer builds follow automatically). Images are pulled from Docker Hub and ghcr.io on first boot, so the box needs outbound internet.
- **R2 push job** runs `pip3 install boto3` on every run (same as live).
- **Auto-update rollback covers a running system, not a kernel that does not boot.** If a new kernel fails to boot, pick the previous generation in the boot menu (5 s at power-on, needs a screen and keyboard; the menu runs before Linux, so a USB keyboard works there).
