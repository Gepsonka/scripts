# SSH from the local network. The only inbound port on this machine, and only when enabled.
# Gated three ways: listed interfaces (or all), listed source networks only, key-only auth (see ssh.nix).
{
  lib,
  settings,
  ...
}:
let
  cfg = settings.localSsh;
  iface = lib.optionalString (cfg.interface != null) "-i ${cfg.interface} ";
  rule =
    src:
    let
      cmd = if lib.hasInfix ":" src then "ip6tables" else "iptables";
    in
    "${cmd} -A nixos-fw ${iface}-p tcp --dport 22 -s ${src} -m conntrack --ctstate NEW -j nixos-fw-accept";
in
{
  config = lib.mkIf cfg.enable {
    # sshd must listen beyond loopback for this; the firewall decides who may connect.
    services.openssh.listenAddresses = lib.mkForce [
      {
        addr = "0.0.0.0";
        port = 22;
      }
      {
        addr = "[::]";
        port = 22;
      }
    ];

    networking.firewall.extraCommands = lib.concatStringsSep "\n" (
      map rule (cfg.allowedCidrs ++ lib.optional cfg.linkLocalIPv6 "fe80::/10")
    );

    networking.interfaces = lib.mkIf (cfg.static != null) {
      ${cfg.static.interface}.ipv4.addresses = [
        {
          inherit (cfg.static) address prefixLength;
        }
      ];
    };

    services.openssh.settings.LoginGraceTime = 20;
  };
}
