# Key-based sshd for the local network. It listens on loopback only unless local-ssh.nix widens the
# listen addresses and opens port 22 for LAN sources. Remote access is Tailscale SSH (tailscale.nix).
{ settings, lib, ... }:
let
  # every key in secrets/admin.pub may log in (blank lines and # comments skipped)
  adminKeys = lib.filter (l: l != "" && !lib.hasPrefix "#" l) (
    lib.splitString "\n" (builtins.readFile ../secrets/admin.pub)
  );
in
{
  services.openssh = {
    enable = true;
    openFirewall = false;
    listenAddresses = [
      {
        addr = "127.0.0.1";
        port = 22;
      }
    ];
    # The same key agenix uses to decrypt. Stable host identity across reinstalls.
    hostKeys = [
      {
        path = "/etc/ssh/ssh_host_ed25519_key";
        type = "ed25519";
      }
    ];
    settings = {
      PasswordAuthentication = false;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "no";
      AllowUsers = [ settings.adminUser ];
      X11Forwarding = false;
      AllowAgentForwarding = false;
      MaxAuthTries = 3;
    };
  };

  # Key-only accounts. Passwords are locked, so there is no local password login at all.
  users.mutableUsers = false;
  users.allowNoPasswordLogin = true;
  users.users.root.hashedPassword = "!";
  users.users.${settings.adminUser} = {
    isNormalUser = true;
    extraGroups = [ "wheel" ];
    hashedPassword = "!";
    openssh.authorizedKeys.keys = adminKeys;
  };
  # No password exists, so sudo cannot ask for one. Protection is the ssh key (LAN) or Tailscale SSH policy.
  security.sudo.wheelNeedsPassword = false;
}
