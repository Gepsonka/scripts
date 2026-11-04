# Tailscale: remote shell access from outside the LAN, through Tailscale SSH only.
# Tailscale SSH is served by tailscaled itself on the node's Tailscale IP, port 22. Who may log in, and as
# which local user, is decided by the "ssh" rules of the tailnet policy, not by secrets/admin.pub.
#
# Nothing else is reachable over the tailnet. The ERPNext web stays behind the Cloudflare tunnel + Access only:
#   - tailscale does not touch netfilter, and the NixOS firewall opens nothing on tailscale0
#     (k3s, Traefik and the key-based sshd stay closed to tailnet peers)
#   - no subnet routes, no exit node, no Tailscale Serve/Funnel
{ config, settings, ... }:
{
  services.tailscale = {
    enable = true;
    # joins the tailnet on first boot with the agenix-decrypted auth key
    authKeyFile = config.age.secrets.tailscale-authkey.path;
    # works through NAT and DERP relays, no inbound port needed
    openFirewall = false;
    # applied on the first `tailscale up` only, tailscale keeps them afterwards
    extraUpFlags = [
      "--hostname=${settings.hostName}"
      "--ssh"
      "--netfilter-mode=off"
      # keep DNS as is, k3s/CoreDNS and cloudflared resolve through the LAN
      "--accept-dns=false"
    ];
  };
}
