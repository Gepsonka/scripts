{
  description = "On-prem ERPNext on NixOS + k3s. No open ports, Cloudflare-tunnel-only access, agenix secrets.";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

    agenix = {
      url = "github:ryantm/agenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    disko = {
      url = "github:nix-community/disko";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      agenix,
      disko,
      ...
    }:
    let
      system = "x86_64-linux";
      settings = import ./settings.nix;
      pkgs = nixpkgs.legacyPackages.${system};

      # The agenix decryption key, read from outside the repo (it is gitignored), so this needs --impure.
      hostKey =
        let
          path = builtins.getEnv "ERPNEXT_HOST_KEY";
        in
        if path == "" then
          throw "set ERPNEXT_HOST_KEY to the decryption key and build with --impure (scripts/build-iso.sh does both)"
        else
          builtins.path {
            inherit path;
            name = "erpnext-host-key";
          };
    in
    {
      nixosConfigurations.${settings.hostName} = nixpkgs.lib.nixosSystem {
        inherit system;
        # self: the weekly auto-update rebuilds from this source (modules/maintenance)
        specialArgs = { inherit settings self; };
        modules = [
          disko.nixosModules.disko
          agenix.nixosModules.default
          ./hosts/erpnext
        ];
      };

      # Autoinstall ISO for the system above. Contains the decryption key: build with scripts/build-iso.sh.
      nixosConfigurations.installer = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = {
          inherit settings hostKey;
          target = self.nixosConfigurations.${settings.hostName};
        };
        modules = [ ./hosts/installer ];
      };

      packages.${system}.iso = self.nixosConfigurations.installer.config.system.build.isoImage;

      # `nix develop` gives you agenix, cloudflared and age for the setup steps in README.md
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          agenix.packages.${system}.default
          pkgs.cloudflared
          pkgs.age
          pkgs.openssh
          pkgs.jq
        ];
      };

      formatter.${system} = pkgs.nixfmt;
    };
}
