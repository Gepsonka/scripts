{ lib, pkgs, ... }:
let
  # Every USB host-controller and USB class driver we know about, plus other DMA/hotplug buses.
  blockedModules = [
    "usb_storage"
    "uas"
    "usbhid"
    "xhci_hcd"
    "xhci_pci"
    "xhci_pci_renesas"
    "ehci_hcd"
    "ehci_pci"
    "ohci_hcd"
    "ohci_pci"
    "uhci_hcd"
    "btusb"
    "bluetooth"
    "thunderbolt"
    "firewire_core"
    "firewire_ohci"
  ];
in
{
  # ---- USB: closed ------------------------------------------------------------------------
  # Layer 1: kernel cmdline. `nousb` disables the USB core, `authorized_default=0` makes the
  # kernel refuse every device even if a controller were somehow bound, `module_blacklist`
  # also applies inside the initrd.
  boot.kernelParams = [
    "nousb"
    "usbcore.authorized_default=0"
    "module_blacklist=${lib.concatStringsSep "," blockedModules}"
  ];
  # Layer 2: modprobe cannot load them, not even by hand (`modprobe usb_storage` fails).
  boot.blacklistedKernelModules = blockedModules;
  boot.extraModprobeConfig = lib.concatMapStrings (
    m: "install ${m} ${pkgs.coreutils}/bin/false\n"
  ) blockedModules;
  # Layer 3: if a device ever enumerates anyway, deauthorize it the moment it appears.
  services.udev.extraRules = ''
    ACTION=="add", SUBSYSTEM=="usb", ATTR{authorized}="0"
  '';
  services.udisks2.enable = false;
  hardware.bluetooth.enable = false;

  # ---- Network: nothing listens to the outside -------------------------------------------
  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ ];
    allowedUDPPorts = [ ];
    allowPing = false;
    logRefusedConnections = false;
    # Pod networks must reach the host (API server, DNS, kubelet). External NICs stay default-deny.
    trustedInterfaces = [
      "cni0"
      "flannel.1"
    ];
    # flannel/vxlan breaks under strict reverse-path filtering
    checkReversePath = "loose";
  };
  networking.useDHCP = lib.mkDefault true;
  services.avahi.enable = false;
  services.printing.enable = false;

  # ---- Kernel / system -------------------------------------------------------------------
  boot.kernel.sysctl = {
    "kernel.dmesg_restrict" = 1;
    "kernel.kptr_restrict" = 2;
    "net.ipv4.conf.all.accept_source_route" = 0;
    "net.ipv4.conf.all.accept_redirects" = 0;
    "net.ipv4.conf.default.accept_redirects" = 0;
    "net.ipv4.icmp_echo_ignore_broadcasts" = 1;
    # many pods need a lot of inotify handles
    "fs.inotify.max_user_instances" = 8192;
    "fs.inotify.max_user_watches" = 524288;
  };
  boot.tmp.cleanOnBoot = true;
  services.journald.extraConfig = ''
    SystemMaxUse=1G
  '';
}
