# agenix: secrets are committed encrypted and decrypted on the machine at boot (activation),
# using ONE private key: the ssh host key at /etc/ssh/ssh_host_ed25519_key.
# That key is the only thing you supply at install time (scripts/install.sh --key ...).
{ lib, ... }:
{
  age.identityPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];

  # Decrypted files land in /run/agenix (tmpfs, root-only, never in the nix store or on disk).
  age.secrets = lib.genAttrs (import ./secret-names.nix) (name: {
    file = ../secrets + "/${name}.age";
    mode = "0400";
    owner = "root";
    group = "root";
  });
}
