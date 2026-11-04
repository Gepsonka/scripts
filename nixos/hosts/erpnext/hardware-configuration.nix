# Generic x86_64 hardware, so the prebuilt autoinstall ISO boots on any common server or VM.
# scripts/install.sh (nixos-anywhere --generate-hardware-config) overwrites this with the real machine's
# config; commit the generated result afterwards.
{ lib, modulesPath, ... }:
{
  imports = [ (modulesPath + "/installer/scan/not-detected.nix") ];

  # storage controllers the root disk can sit behind (USB ones are not listed on purpose)
  boot.initrd.availableKernelModules = [
    "nvme"
    "ahci"
    "ata_piix"
    "sd_mod"
    "sr_mod"
    "mpt3sas"
    "megaraid_sas"
    "virtio_pci"
    "virtio_blk"
    "virtio_scsi"
  ];
  boot.kernelModules = [
    "kvm-intel"
    "kvm-amd"
  ];

  nixpkgs.hostPlatform = lib.mkDefault "x86_64-linux";
  hardware.enableRedistributableFirmware = lib.mkDefault true;
  hardware.cpu.intel.updateMicrocode = lib.mkDefault true;
  hardware.cpu.amd.updateMicrocode = lib.mkDefault true;
}
