# Outbound-only Cloudflare tunnel, web only. Nothing listens on a public interface.
#   ERP hostname -> Traefik ClusterIP (HTTP)  : cloudflared REJECTS requests without a valid Cloudflare Access JWT
# SSH does not go through Cloudflare: LAN uses local-ssh.nix, remote access uses Tailscale SSH (tailscale.nix).
#
# This is a custom unit (not services.cloudflared) because the stock module cannot set
# originRequest.access, which is what enforces Access at the origin as well as at Cloudflare's edge.
{
  config,
  pkgs,
  settings,
  ...
}:
let
  cf = settings.cloudflare;

  accessFor = aud: {
    required = true;
    teamName = cf.accessTeamName;
    audTag = [ aud ];
  };

  tunnelConfig = (pkgs.formats.yaml { }).generate "cloudflared.yml" {
    tunnel = cf.tunnelId;
    credentials-file = "/run/credentials/cloudflared-tunnel.service/credentials.json";
    ingress = [
      {
        hostname = settings.erpnext.siteName;
        service = "http://${settings.network.traefikClusterIP}:80";
        originRequest.access = accessFor cf.erpAccessAudTag;
      }
      # anything else that reaches the tunnel gets a 404
      { service = "http_status:404"; }
    ];
  };
in
{
  systemd.services.cloudflared-tunnel = {
    description = "Cloudflare Tunnel (outbound only)";
    wantedBy = [ "multi-user.target" ];
    wants = [ "network-online.target" ];
    after = [
      "network-online.target"
      "k3s.service"
    ];
    # restart when the encrypted credentials are re-keyed or replaced
    restartTriggers = [ config.age.secrets.cloudflared-credentials.file ];

    serviceConfig = {
      ExecStart = "${pkgs.cloudflared}/bin/cloudflared tunnel --config=${tunnelConfig} --no-autoupdate run";
      # root-only agenix file handed to the service as a private credential
      LoadCredential = "credentials.json:${config.age.secrets.cloudflared-credentials.path}";
      Restart = "always";
      RestartSec = 5;

      DynamicUser = true;
      NoNewPrivileges = true;
      PrivateTmp = true;
      PrivateDevices = true;
      ProtectSystem = "strict";
      ProtectHome = true;
      ProtectKernelTunables = true;
      ProtectKernelModules = true;
      ProtectControlGroups = true;
      RestrictNamespaces = true;
      LockPersonality = true;
      MemoryDenyWriteExecute = true;
      RestrictAddressFamilies = [
        "AF_INET"
        "AF_INET6"
        "AF_UNIX"
      ];
      CapabilityBoundingSet = "";
      SystemCallArchitectures = "native";
    };
  };
}
