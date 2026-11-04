# Every site-specific, NON-secret value lives here. Secrets live in ./secrets (agenix).
# Anything still set to "CHANGEME" makes the build fail on purpose (see modules/checks.nix).
{
  hostName = "erpnext";
  timeZone = "Europe/Budapest";
  adminUser = "admin";

  # Install disk. "auto" = the autoinstall ISO picks the only internal (non-USB) disk and stops to ask
  # if there is more than one. Or a stable path, e.g. /dev/disk/by-id/nvme-Samsung_SSD_990_PRO_1TB_S6Z...
  # (find it on the target with: ls -l /dev/disk/by-id). scripts/install.sh needs a fixed path.
  disk = "auto";

  cloudflare = {
    # UUID printed by `cloudflared tunnel create erpnext`
    tunnelId = "8af4b617-47b8-4be3-9113-9844d584a91f";
    # <team>.cloudflareaccess.com, the part before ".cloudflareaccess.com"
    accessTeamName = "patient-river-05b7";
    # AUD tag of the Cloudflare Access application that protects the ERP hostname
    erpAccessAudTag = "17c6a350217d756c9895c35827232d8d6f8380af455b97089a11597dd900dd4c";
  };

  # SSH from the local network, the ONLY inbound port this machine opens. TCP 22, key-only auth
  # (keys: secrets/admin.pub). From outside, use Tailscale SSH instead (modules/tailscale.nix).
  localSsh = {
    enable = true;
    # Interfaces port 22 is open on. null = every interface, "en+" = wired ethernet only (never Wi-Fi).
    interface = null;
    # Source networks allowed to reach port 22, IPv4 and IPv6. Default: every private (LAN) range, so
    # connections from public internet addresses are dropped. Narrow it to your LAN, e.g. [ "192.168.1.0/24" ].
    allowedCidrs = [
      "10.0.0.0/8"
      "172.16.0.0/12"
      "192.168.0.0/16"
      "fd00::/8"
    ];
    # Also allow IPv6 link-local (fe80::/10): a laptop plugged straight into the cable works with
    # zero IP setup:  ssh admin@fe80::<server>%<your-nic>   (find it: ping -6 ff02::1%<your-nic>)
    linkLocalIPv6 = true;
    # Optional fixed address for a direct laptop-to-server cable without DHCP. null = DHCP only.
    # Example: { interface = "enp3s0"; address = "192.168.77.1"; prefixLength = 24; }
    # Then give the laptop 192.168.77.2/24 and make sure allowedCidrs covers 192.168.77.0/24.
    static = null;
  };

  # Weekly OS update (modules/maintenance): newest nixpkgs of the pinned NixOS release, i.e. security fixes,
  # kernel, k3s, cloudflared, tailscale. Rolled back automatically if ERPNext is not healthy afterwards.
  # New ERPNext builds are deployed separately, see erpnext.image.channel below.
  autoUpdate = {
    enable = true;
    # systemd calendar time, in timeZone above
    at = "Sun *-*-* 18:00:00";
    # reboot after the update, only when the kernel changed (a few minutes of ERPNext downtime)
    allowReboot = true;
  };

  # Email alerts (modules/maintenance). The server reports to healthchecks.io every 5 minutes; healthchecks
  # emails you when a service is down, when the reports stop (server or network offline), and when the
  # weekly update fails. Ping key: secrets/healthchecks-ping-key.age (scripts/init.sh).
  alerting.pingUrl = "https://hc-ping.com";

  network = {
    # Traefik is exposed ONLY as this ClusterIP (no LoadBalancer, no host ports).
    # Must be a free address inside the k3s service CIDR (default 10.43.0.0/16).
    traefikClusterIP = "10.43.0.80";
  };

  erpnext = {
    # Public hostname == Frappe site name == Host header that cloudflared forwards.
    siteName = "erp.d-trend.com";
    frappeVersion = "16";
    image = {
      repository = "brotond/erpnext-scripts-operator";
      # The image of the FIRST install only. Afterwards erpnext-image-update (modules/maintenance) moves
      # the bench to whatever build-NNN `channel` points to, and boots/switches keep that.
      tag = "build-88";
      # Docker Hub tag that this repo's image build (../.github/workflows/docker-build.yml) moves on every master build. Checked every 5 minutes;
      # a new build is deployed (migrate + cache clear, smoke test). null = no automatic deploys.
      channel = "latest";
    };
    # Pre-provisioned DB and user that the operator's site-init connects with (same as live).
    db = {
      name = "erpnext_prod";
      user = "erpnext_prod";
    };
    # Cloudflare R2 bucket that receives the nightly backups (credentials are in agenix).
    r2 = {
      endpoint = "https://090e8dee619ef0d0ab44707ffc760ea4.r2.cloudflarestorage.com";
      bucket = "erp-backups";
      prefix = "erp.d-trend.com";
    };
  };
}
