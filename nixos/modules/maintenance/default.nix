# Keeping the box current and telling you when it is not well (settings.autoUpdate, settings.alerting):
#   erpnext-auto-update   weekly OS update with health-checked rollback   (auto-update.sh)
#   erpnext-image-update  deploys new ERPNext image builds, every 5 min   (image-update.sh)
#   erpnext-watchdog      health check every 5 minutes                     (watchdog.sh, health.sh)
# All report to healthchecks.io, which sends the emails: a service is down, the server stopped reporting
# (offline), an update or deploy failed. The Cloudflare tunnel status alert is separate (Cloudflare
# Notifications). The two updaters share /run/erpnext-maintenance.lock, so they never run together.
{
  config,
  lib,
  pkgs,
  settings,
  self,
  ...
}:
let
  pingKey = ../../secrets/healthchecks-ping-key.age;
  hasPingKey = builtins.pathExists pingKey;

  ping = pkgs.writeShellApplication {
    name = "erpnext-ping";
    runtimeInputs = with pkgs; [
      coreutils
      curl
    ];
    runtimeEnv = {
      PING_URL = settings.alerting.pingUrl;
      PING_KEY_FILE = "${config.age.secretsDir}/healthchecks-ping-key";
      PREFIX = settings.hostName;
    };
    text = builtins.readFile ./ping.sh;
  };

  health = pkgs.writeShellApplication {
    name = "erpnext-health";
    runtimeInputs = with pkgs; [
      coreutils
      curl
      gawk
      jq
      kubectl
      systemd
      config.services.tailscale.package
    ];
    runtimeEnv = {
      KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";
      REQUIRED_UNITS = lib.concatStringsSep " " [
        "k3s.service"
        "erpnext-bootstrap.service"
        "cloudflared-tunnel.service"
        "tailscaled.service"
        (if config.services.openssh.startWhenNeeded then "sshd.socket" else "sshd.service")
      ];
      NS_SITE = "frappe-prod";
      SITE_NAME = settings.erpnext.siteName;
      TRAEFIK_IP = settings.network.traefikClusterIP;
      DISK_LIMIT = "85";
    };
    text = builtins.readFile ./health.sh;
  };

  watchdog = pkgs.writeShellApplication {
    name = "erpnext-watchdog";
    runtimeInputs = [
      health
      ping
      pkgs.coreutils
      pkgs.systemd
    ];
    text = builtins.readFile ./watchdog.sh;
  };

  imageUpdate = pkgs.writeShellApplication {
    name = "erpnext-image-update";
    runtimeInputs = with pkgs; [
      ping
      coreutils
      curl
      gnugrep
      jq
      kubectl
      util-linux
    ];
    runtimeEnv = {
      KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";
      REPO = settings.erpnext.image.repository;
      CHANNEL = toString settings.erpnext.image.channel;
      NS = "frappe-prod";
      BENCH = "prod-bench";
      SITE = "prod-site";
      SITE_NAME = settings.erpnext.siteName;
      TRAEFIK_IP = settings.network.traefikClusterIP;
    };
    text = builtins.readFile ./image-update.sh;
  };

  autoUpdate = pkgs.writeShellApplication {
    name = "erpnext-auto-update";
    runtimeInputs = [
      health
      ping
      config.nix.package
      pkgs.coreutils
      pkgs.gitMinimal
      pkgs.jq
      pkgs.systemd
      pkgs.util-linux
    ];
    runtimeEnv = {
      HOST_NAME = settings.hostName;
      HEALTH_TIMEOUT = "1200";
      REBOOT = if settings.autoUpdate.allowReboot then "1" else "0";
    };
    text = builtins.readFile ./auto-update.sh;
  };
in
{
  # the exact source this system was built from; the weekly update starts from it
  environment.etc."erpnext/flake".source = self.outPath;
  # `erpnext-health` by hand shows what the watchdog sees
  environment.systemPackages = [ health ];

  age.secrets = lib.mkIf hasPingKey {
    healthchecks-ping-key = {
      file = pingKey;
      mode = "0400";
    };
  };
  warnings = lib.optional (!hasPingKey) ''
    secrets/healthchecks-ping-key.age is missing: no email alerts from the server itself (only the
    Cloudflare tunnel alert). Run scripts/init.sh with HEALTHCHECKS_PING_KEY to turn them on.
  '';

  systemd.services.erpnext-watchdog = {
    description = "ERPNext health check, reports to healthchecks.io";
    # a switch must not interrupt a run
    restartIfChanged = false;
    serviceConfig = {
      Type = "oneshot";
      ExecStart = lib.getExe watchdog;
      StateDirectory = "erpnext-watchdog";
      TimeoutStartSec = "4min";
    };
  };
  systemd.timers.erpnext-watchdog = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      # let k3s and the pods come up after a boot before judging
      OnBootSec = "15min";
      OnUnitActiveSec = "5min";
      AccuracySec = "30s";
    };
  };

  systemd.services.erpnext-image-update = lib.mkIf (settings.erpnext.image.channel != null) {
    description = "Deploy new ERPNext image builds from Docker Hub";
    wants = [ "network-online.target" ];
    after = [ "network-online.target" ];
    # a switch must not interrupt a running deploy
    restartIfChanged = false;
    serviceConfig = {
      Type = "oneshot";
      ExecStart = lib.getExe imageUpdate;
      StateDirectory = "erpnext-image-update";
      TimeoutStartSec = "45min";
    };
  };
  systemd.timers.erpnext-image-update = lib.mkIf (settings.erpnext.image.channel != null) {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      # after the first-boot install has had time to finish
      OnBootSec = "30min";
      OnUnitActiveSec = "5min";
      AccuracySec = "30s";
    };
  };

  systemd.services.erpnext-auto-update = lib.mkIf settings.autoUpdate.enable {
    description = "Weekly NixOS update with health-checked rollback";
    wants = [ "network-online.target" ];
    after = [ "network-online.target" ];
    # it switches the system itself: a restart in the middle would kill it
    restartIfChanged = false;
    environment.HOME = "/root";
    serviceConfig = {
      Type = "oneshot";
      ExecStart = lib.getExe autoUpdate;
      TimeoutStartSec = "3h";
    };
  };
  systemd.timers.erpnext-auto-update = lib.mkIf settings.autoUpdate.enable {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = settings.autoUpdate.at;
      # a missed week is skipped, never caught up at boot during working hours
      Persistent = false;
    };
  };
}
