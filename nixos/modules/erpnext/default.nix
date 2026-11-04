# ERPNext on k3s, mirroring the live `frappe-prod` setup:
#   frappe-operator v4.1.2  ->  FrappeBench + FrappeSite + SiteBackup (CRs)
#   MariaDB 10.11 (ns erpnext, external/shared DB for the site)
#   nightly push of the bench backup to Cloudflare R2
# Differences from live, on purpose: no cert-manager / Let's Encrypt (TLS ends at Cloudflare),
# no LoadBalancer (Traefik is ClusterIP-only, see ../k3s.nix).
#
# Secrets never enter the nix store: erpnext-bootstrap.service turns the agenix-decrypted files in
# /run/agenix into Kubernetes Secrets, then server-side-applies the manifests built below.
{
  config,
  lib,
  pkgs,
  settings,
  ...
}:
let
  s = settings.erpnext;
  age = config.age.secrets;

  ns = {
    site = "frappe-prod";
    db = "erpnext";
  };
  benchName = "prod-bench";

  operator = {
    version = "v4.1.2";
    manifest = pkgs.fetchurl {
      url = "https://github.com/vyogotech/frappe-operator/releases/download/v4.1.2/install.yaml";
      sha256 = "de5fa08b5633645fbb623aee14bc888fd3200069f52487d07aacf17d8301b96b";
    };
  };

  json = pkgs.formats.json { };
  mkList =
    name: items:
    json.generate "${name}.json" {
      apiVersion = "v1";
      kind = "List";
      inherit items;
    };

  secretEnv = name: secret: key: {
    inherit name;
    valueFrom.secretKeyRef = {
      name = secret;
      inherit key;
    };
  };

  namespaces = mkList "namespaces" (
    map
      (n: {
        apiVersion = "v1";
        kind = "Namespace";
        metadata.name = n;
      })
      [
        ns.db
        ns.site
      ]
  );

  # ---- MariaDB (same image, flags and size as live) ---------------------------------------
  mariadb = mkList "mariadb" [
    {
      apiVersion = "v1";
      kind = "Service";
      metadata = {
        name = "erpnext-mariadb";
        namespace = ns.db;
      };
      spec = {
        selector.app = "erpnext-mariadb";
        ports = [
          {
            port = 3306;
            targetPort = 3306;
          }
        ];
      };
    }
    {
      apiVersion = "apps/v1";
      kind = "StatefulSet";
      metadata = {
        name = "erpnext-mariadb";
        namespace = ns.db;
      };
      spec = {
        serviceName = "erpnext-mariadb";
        replicas = 1;
        selector.matchLabels.app = "erpnext-mariadb";
        template = {
          metadata.labels.app = "erpnext-mariadb";
          spec.containers = [
            {
              name = "mariadb";
              image = "docker.io/mariadb:10.11";
              args = [
                "--character-set-server=utf8mb4"
                "--collation-server=utf8mb4_unicode_ci"
                "--skip-character-set-client-handshake"
                "--skip-innodb-read-only-compressed"
              ];
              env = [
                (secretEnv "MYSQL_ROOT_PASSWORD" "erpnext-credentials" "mysql-root-password")
                # first start creates the database + user the operator's site-init connects with
                {
                  name = "MYSQL_DATABASE";
                  value = s.db.name;
                }
                {
                  name = "MYSQL_USER";
                  value = s.db.user;
                }
                (secretEnv "MYSQL_PASSWORD" "erpnext-credentials" "site-db-password")
              ];
              ports = [ { containerPort = 3306; } ];
              volumeMounts = [
                {
                  name = "mariadb-data";
                  mountPath = "/var/lib/mysql";
                }
              ];
            }
          ];
        };
        volumeClaimTemplates = [
          {
            metadata.name = "mariadb-data";
            spec = {
              accessModes = [ "ReadWriteOnce" ];
              resources.requests.storage = "5Gi";
            };
          }
        ];
      };
    }
  ];

  # ---- Frappe operator custom resources ---------------------------------------------------
  scaledComponents = [
    "gunicorn"
    "scheduler"
    "socketio"
    "worker-default"
    "worker-long"
    "worker-short"
  ];

  frappe = mkList "frappe" [
    {
      apiVersion = "vyogo.tech/v1";
      kind = "FrappeBench";
      metadata = {
        name = benchName;
        namespace = ns.site;
      };
      spec = {
        frappeVersion = s.frappeVersion;
        apps = [
          {
            name = "erpnext";
            source = "image";
          }
          {
            name = "scripts";
            source = "image";
          }
        ];
        imageConfig = {
          inherit (s.image) repository tag;
          pullPolicy = "IfNotPresent";
        };
        security.podSecurityContext = {
          fsGroup = 1000;
          runAsGroup = 1000;
          runAsUser = 1000;
        };
        storageClassName = "local-path";
        storageSize = "5Gi";
        componentAutoscaling = lib.genAttrs scaledComponents (_: {
          enabled = false;
          provider = "hpa";
          staticReplicas = 1;
        });
      };
    }
    {
      apiVersion = "vyogo.tech/v1";
      kind = "FrappeSite";
      metadata = {
        name = "prod-site";
        namespace = ns.site;
      };
      spec = {
        siteName = s.siteName;
        benchRef.name = benchName;
        apps = [
          "erpnext"
          "scripts"
        ];
        adminPasswordSecretRef.name = "prod-site-admin-password";
        encryptionKeySecretRef = {
          name = "prod-site-encryption-key";
          key = "encryption_key";
        };
        dbConfig = {
          mode = "shared";
          provider = "external";
          connectionSecretRef.name = "prod-site-db";
        };
        # Traefik ingress only. No TLS/cert-manager: HTTPS is terminated by Cloudflare.
        ingress = {
          enabled = true;
          className = "traefik";
        };
        tls.enabled = false;
      };
    }
    {
      apiVersion = "vyogo.tech/v1";
      kind = "SiteBackup";
      metadata = {
        name = "prod-site-daily";
        namespace = ns.site;
      };
      spec = {
        site = s.siteName;
        schedule = "0 2 * * *";
        withFiles = true;
        compress = true;
        ignoreBackupConf = false;
        verbose = false;
        storage = {
          type = "pvc";
          s3 = {
            endpoint = s.r2.endpoint;
            bucket = s.r2.bucket;
            region = "auto";
            useSSL = true;
            accessKeySecret = {
              name = "r2-backup-credentials";
              key = "access-key-id";
            };
            secretKeySecret = {
              name = "r2-backup-credentials";
              key = "secret-access-key";
            };
          };
        };
      };
    }
    # 30 minutes after the backup: ship the newest backup set to Cloudflare R2
    {
      apiVersion = "v1";
      kind = "ConfigMap";
      metadata = {
        name = "r2-push-scripts";
        namespace = ns.site;
      };
      data."upload.py" = builtins.readFile ./r2-upload.py;
    }
    {
      apiVersion = "batch/v1";
      kind = "CronJob";
      metadata = {
        name = "prod-site-r2-push";
        namespace = ns.site;
      };
      spec = {
        schedule = "30 2 * * *";
        concurrencyPolicy = "Allow";
        jobTemplate.spec.template.spec = {
          restartPolicy = "OnFailure";
          containers = [
            {
              name = "r2-push";
              image = "${s.image.repository}:${s.image.tag}";
              imagePullPolicy = "IfNotPresent";
              command = [
                "/bin/bash"
                "-c"
              ];
              args = [ "pip3 install -q boto3 && python3 /scripts/upload.py\n" ];
              env = [
                {
                  name = "SITE";
                  value = s.siteName;
                }
                {
                  name = "R2_ENDPOINT";
                  value = s.r2.endpoint;
                }
                {
                  name = "R2_BUCKET";
                  value = s.r2.bucket;
                }
                {
                  name = "R2_PREFIX";
                  value = s.r2.prefix;
                }
                (secretEnv "R2_ACCESS_KEY_ID" "r2-backup-credentials" "access-key-id")
                (secretEnv "R2_SECRET_ACCESS_KEY" "r2-backup-credentials" "secret-access-key")
              ];
              volumeMounts = [
                {
                  name = "sites";
                  mountPath = "/home/frappe/frappe-bench/sites";
                  subPath = "frappe-sites";
                }
                {
                  name = "scripts";
                  mountPath = "/scripts";
                }
              ];
            }
          ];
          volumes = [
            {
              name = "sites";
              persistentVolumeClaim.claimName = "${benchName}-sites";
            }
            {
              name = "scripts";
              configMap.name = "r2-push-scripts";
            }
          ];
        };
      };
    }
  ];

  bootstrap = pkgs.writeShellApplication {
    name = "erpnext-bootstrap";
    runtimeInputs = [
      pkgs.kubectl
      pkgs.jq
      pkgs.coreutils
    ];
    text = builtins.readFile ./bootstrap.sh;
  };
in
{
  systemd.services.erpnext-bootstrap = {
    description = "Seed Kubernetes Secrets from agenix and apply the ERPNext manifests";
    wantedBy = [ "multi-user.target" ];
    after = [ "k3s.service" ];
    requires = [ "k3s.service" ];

    environment = {
      KUBECONFIG = "/etc/rancher/k3s/k3s.yaml";

      NAMESPACES_MANIFEST = namespaces;
      OPERATOR_MANIFEST = operator.manifest;
      MARIADB_MANIFEST = mariadb;
      FRAPPE_MANIFEST = frappe;

      NS_DB = ns.db;
      NS_SITE = ns.site;
      BENCH = benchName;
      IMAGE_REPO = s.image.repository;
      DB_HOST = "erpnext-mariadb.${ns.db}.svc.cluster.local";
      DB_NAME = s.db.name;
      DB_USER = s.db.user;

      # agenix-decrypted files (tmpfs under /run/agenix)
      F_MYSQL_ROOT_PASSWORD = age.mysql-root-password.path;
      F_SITE_DB_PASSWORD = age.site-db-password.path;
      F_ADMIN_PASSWORD = age.admin-password.path;
      F_ENCRYPTION_KEY = age.encryption-key.path;
      F_R2_ACCESS_KEY_ID = age.r2-access-key-id.path;
      F_R2_SECRET_ACCESS_KEY = age.r2-secret-access-key.path;
    };

    # re-run when a secret is re-keyed/changed or the manifests change
    restartTriggers = [
      namespaces
      mariadb
      frappe
      operator.manifest
      age.mysql-root-password.file
      age.site-db-password.file
      age.admin-password.file
      age.encryption-key.file
      age.r2-access-key-id.file
      age.r2-secret-access-key.file
    ];

    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = lib.getExe bootstrap;
      # k3s can take a while on first boot (image pulls); keep retrying until it converges
      Restart = "on-failure";
      RestartSec = "30s";
      TimeoutStartSec = "30min";
    };
  };
}
