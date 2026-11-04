{
  pkgs,
  settings,
  ...
}:
{
  services.k3s = {
    enable = true;
    role = "server";

    # servicelb is what would bind host ports 80/443. Traefik stays as the ingress controller
    # (built into k3s) but is exposed only as a ClusterIP, see the HelmChartConfig below.
    disable = [ "servicelb" ];

    extraFlags = [
      "--secrets-encryption" # encrypt Secret objects at rest in the datastore
      "--write-kubeconfig-mode=0600"
    ];

    manifests.traefik-config.content = {
      apiVersion = "helm.cattle.io/v1";
      kind = "HelmChartConfig";
      metadata = {
        name = "traefik";
        namespace = "kube-system";
      };
      spec.valuesContent = builtins.toJSON {
        service = {
          type = "ClusterIP";
          spec.clusterIP = settings.network.traefikClusterIP;
        };
        additionalArguments = [
          # TLS ends at Cloudflare. Keep X-Forwarded-Proto/For from cloudflared so Frappe sees https.
          # Safe: only the local cloudflared and in-cluster pods can reach this ClusterIP.
          "--entryPoints.web.forwardedHeaders.insecure=true"
        ];
      };
    };
  };

  environment.variables.KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";
}
