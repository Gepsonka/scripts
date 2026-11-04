{
  pkgs,
  settings,
  ...
}:
{
  imports = [
    ./hardware-configuration.nix
    ./disko.nix
    ../../modules/checks.nix
    ../../modules/secrets.nix
    ../../modules/hardening.nix
    ../../modules/ssh.nix
    ../../modules/local-ssh.nix
    ../../modules/cloudflared.nix
    ../../modules/tailscale.nix
    ../../modules/k3s.nix
    ../../modules/erpnext
    ../../modules/maintenance
  ];

  networking.hostName = settings.hostName;
  time.timeZone = settings.timeZone;

  # UEFI + systemd-boot (disko creates the ESP at /boot)
  boot.loader = {
    systemd-boot = {
      enable = true;
      configurationLimit = 10;
    };
    efi.canTouchEfiVariables = true;
  };

  nix.settings = {
    experimental-features = [
      "nix-command"
      "flakes"
    ];
    trusted-users = [
      "root"
      "@wheel"
    ];
  };
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 30d";
  };
  nix.optimise.automatic = true;

  environment.systemPackages = with pkgs; [
    kubectl
    k9s
    jq
    htop
  ];

  # Headless server: nothing local to read docs on.
  documentation.enable = false;

  # Do not change after first install.
  system.stateVersion = "26.05";
}
