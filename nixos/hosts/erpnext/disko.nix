# Declarative partitioning, applied at install time by the autoinstall ISO or nixos-anywhere / disko.
# GPT: 512M ESP + the rest as ext4 root. k3s data (local-path PVCs) lives under /var/lib/rancher.
{ settings, ... }:
{
  disko.devices.disk.main = {
    type = "disk";
    # disk = "auto": the autoinstall ISO picks the disk at install time and points this symlink at it.
    # The installed system mounts by partition label, so the path only matters while partitioning.
    device = if settings.disk == "auto" then "/dev/erpnext-install-target" else settings.disk;
    content = {
      type = "gpt";
      partitions = {
        ESP = {
          size = "512M";
          type = "EF00";
          content = {
            type = "filesystem";
            format = "vfat";
            mountpoint = "/boot";
            mountOptions = [ "umask=0077" ];
          };
        };
        root = {
          size = "100%";
          content = {
            type = "filesystem";
            format = "ext4";
            mountpoint = "/";
          };
        };
      };
    };
  };
}
