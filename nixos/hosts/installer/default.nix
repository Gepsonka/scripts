# Autoinstall ISO. Boots (UEFI), picks the disk, waits 15s for a keypress to abort, wipes the disk,
# installs the prebuilt system closure offline and reboots into it. See autoinstall.sh.
#
# The image carries the agenix decryption key (= ssh host key), so treat the image and the stick like
# the key itself. Build it with scripts/build-iso.sh.
{
  config,
  lib,
  pkgs,
  modulesPath,
  settings,
  target,
  hostKey,
  ...
}:
let
  t = target.config;

  adminKeys = lib.filter (l: l != "" && !lib.hasPrefix "#" l) (
    lib.splitString "\n" (builtins.readFile ../../secrets/admin.pub)
  );

  # Refuse to build an image whose key cannot decrypt the secrets in this repo.
  hostKeyDir = pkgs.runCommand "erpnext-host-key" { nativeBuildInputs = [ pkgs.openssh ]; } ''
    install -m 600 ${hostKey} key
    want=$(cut -d' ' -f2 ${../../secrets/host.pub})
    have=$(ssh-keygen -y -f key | cut -d' ' -f2)
    if [ "$want" != "$have" ]; then
      echo "the host key does not match secrets/host.pub, the installed system could not decrypt its secrets" >&2
      exit 1
    fi
    mkdir $out
    cp key $out/ssh_host_ed25519_key
    cp ${../../secrets/host.pub} $out/ssh_host_ed25519_key.pub
  '';

  autoinstall = pkgs.writeShellApplication {
    name = "erpnext-autoinstall";
    runtimeInputs = [
      config.system.build.nixos-install
      config.nix.package
      pkgs.coreutils
      pkgs.util-linux
      pkgs.gawk
      pkgs.gnugrep
      pkgs.jq
      pkgs.systemd
    ];
    text = builtins.readFile ./autoinstall.sh;
  };
in
{
  imports = [ (modulesPath + "/installer/cd-dvd/installation-cd-minimal.nix") ];

  image.baseName = lib.mkForce "erpnext-autoinstall";
  isoImage.appendToMenuLabel = " ERPNext autoinstall (ERASES the disk)";
  isoImage.squashfsCompression = "zstd -Xcompression-level 6";
  # everything nixos-install needs, so the install works without network
  isoImage.storeContents = [
    t.system.build.toplevel
    t.system.build.diskoScript
  ];

  # second boot menu entry: the same live system without the installer, for a look around first
  specialisation.rescue.configuration = {
    isoImage.appendToMenuLabel = lib.mkForce " rescue shell (no install)";
    boot.kernelParams = [ "erpnext.noinstall" ];
  };

  networking.hostName = "${settings.hostName}-installer";
  # the target uses ext4/vfat only, so skip the installer profile's ZFS (smaller image, no ZFS warning)
  boot.supportedFilesystems.zfs = lib.mkForce false;

  systemd.services.erpnext-autoinstall = {
    description = "Wipe the disk and install ERPNext NixOS";
    wantedBy = [ "multi-user.target" ];
    after = [
      "systemd-udev-settle.service"
      "local-fs.target"
    ];
    unitConfig.ConditionKernelCommandLine = "!erpnext.noinstall";
    environment = {
      DISK_SETTING = settings.disk;
      DISKO_SCRIPT = "${t.system.build.diskoScript}";
      TARGET_LINK = t.disko.devices.disk.main.device;
      SYSTEM = "${t.system.build.toplevel}";
      HOST_KEY_DIR = "${hostKeyDir}";
    };
    serviceConfig = {
      Type = "oneshot";
      ExecStart = lib.getExe autoinstall;
      # owns tty1: shows progress, takes the abort keypress and disk choice
      StandardInput = "tty-force";
      StandardOutput = "tty";
      StandardError = "tty";
      TTYPath = "/dev/tty1";
      TTYReset = true;
      TTYVHangup = true;
    };
  };
  # keep tty1 readable: no boot status lines between the countdown and the prompts
  boot.kernelParams = [ "systemd.show_status=error" ];
  # no login prompt fighting the installer for tty1 (shells stay on tty2+)
  systemd.services."getty@tty1".enable = false;
  systemd.services."autovt@tty1".enable = false;

  # watch or debug the install remotely: ssh root@<installer-ip>, journalctl -ft erpnext-autoinstall
  systemd.services.sshd.wantedBy = lib.mkForce [ "multi-user.target" ];
  services.openssh.settings = {
    PermitRootLogin = lib.mkForce "prohibit-password";
    PasswordAuthentication = false;
    KbdInteractiveAuthentication = false;
  };
  users.users.root.openssh.authorizedKeys.keys = adminKeys;
}
