# Fail the build early (and loudly) instead of deploying a half-configured, possibly exposed machine.
{ lib, settings, ... }:
let
  leaves = lib.collect (v: !(lib.isAttrs v)) settings;
  unset = lib.filter (v: lib.isString v && lib.hasInfix "CHANGEME" v) leaves;

  pubFiles = [
    "admin.pub"
    "host.pub"
  ];
  pubUnset = lib.filter (
    f: lib.hasInfix "CHANGEME" (builtins.readFile (../secrets + "/${f}"))
  ) pubFiles;

  secretFiles = import ./secret-names.nix;
  missing = lib.filter (n: !builtins.pathExists (../secrets + "/${n}.age")) secretFiles;
in
{
  assertions = [
    {
      assertion = unset == [ ];
      message = "settings.nix still contains CHANGEME placeholders. Fill in every CHANGEME value.";
    }
    {
      assertion = pubUnset == [ ];
      message = "secrets/{${lib.concatStringsSep "," pubUnset}} still hold the CHANGEME placeholder. Run scripts/init.sh.";
    }
    {
      assertion = missing == [ ];
      message = "Missing encrypted secrets: ${
        lib.concatMapStringsSep ", " (n: "secrets/${n}.age") missing
      }. Run scripts/init.sh, then `git add secrets` (flakes ignore untracked files).";
    }
  ];
}
