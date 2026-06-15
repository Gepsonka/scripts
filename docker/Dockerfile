# syntax=docker/dockerfile:1.7
#
# Production Dockerfile for the scripts app on top of Frappe/ERPNext v16.
#
# Architecture:
#   Stage 1 (builder) - based on `frappe/build`. Has Node + build tools pre-installed.
#                       `bench init` with apps.json, then `bench setup requirements`,
#                       then `bench build --production` to compile all assets
#                       (frappe, erpnext, custom apps like scripts, posawesome).
#   Stage 2 (runtime) - based on `frappe/base`. Lighter image without build tools.
#                       Copies the prepared bench from builder, relocates assets
#                       out of the sites volume so they stay in sync with the image.
#
# Result: a self-contained image with production-built assets for both
# upstream apps and custom apps. No `bench build` needed at runtime.
#

ARG FRAPPE_BRANCH=version-16
ARG FRAPPE_IMAGE_PREFIX=frappe

# -----------------------------------------------------------------------------
# Stage 1: builder (has Node, build tools, and Python pre-installed)
# -----------------------------------------------------------------------------
FROM ${FRAPPE_IMAGE_PREFIX}/build:${FRAPPE_BRANCH} AS builder

ARG FRAPPE_BRANCH=version-16
ARG FRAPPE_PATH=https://github.com/frappe/frappe
ARG CACHE_BUST=""

USER frappe

# 1. Initialize bench and fetch all apps defined in apps.json (BuildKit secret)
RUN --mount=type=secret,id=apps_json,target=/opt/frappe/apps.json,uid=1000,gid=1000 \
  : "${CACHE_BUST}" && \
  export APP_INSTALL_ARGS="" && \
  if [ -f /opt/frappe/apps.json ] && [ -s /opt/frappe/apps.json ]; then \
    export APP_INSTALL_ARGS="--apps_path=/opt/frappe/apps.json"; \
  fi && \
  bench init ${APP_INSTALL_ARGS}\
    --frappe-branch=${FRAPPE_BRANCH} \
    --frappe-path=${FRAPPE_PATH} \
    --no-procfile \
    --no-backups \
    --skip-redis-config-generation \
    --verbose \
    /home/frappe/frappe-bench && \
  cd /home/frappe/frappe-bench && \
  echo "{}" > sites/common_site_config.json && \
  find apps -mindepth 1 -path "*/.git" | xargs rm -fr

WORKDIR /home/frappe/frappe-bench

# 2. Install Python requirements for all apps.
#    `bench get-app` (called by `bench init --apps_path`) already ran
#    `pip install -e` for each app via its setup.py, but `setup requirements`
#    ensures requirements.txt-based deps are also installed.
RUN bench setup requirements --python && \
  rm -rf /home/frappe/.cache /tmp/* /var/tmp/*

# 3. Install Node dependencies for all apps and run production asset build.
#    `bench build --production` compiles JS/CSS bundles for every installed app
#    (frappe, erpnext, scripts, posawesome) and writes them to sites/assets.
#    This is the critical step that was missing from the previous layered
#    build - without it, custom app assets are absent in the runtime image.
RUN bench setup requirements --node && \
  bench build --production && \
  # Verify the critical asset directories exist (file names have hashes, so
  # we just check the directories were populated)
  test -d sites/assets/frappe/dist/js || \
    (echo "ERROR: frappe assets not built" && exit 1) && \
  test -d sites/assets/erpnext/dist/js || \
    (echo "ERROR: erpnext assets not built" && exit 1) && \
  test -d sites/assets/scripts/js || \
    (echo "ERROR: scripts assets not built - custom app failed" && exit 1) && \
  # Pre-compress the largest asset bundles to reduce served size
  find sites/assets -name "*.bundle.js" -size +50k -exec gzip -k {} \; 2>/dev/null || true && \
  # Drop build caches to reduce image size
  rm -rf /home/frappe/.cache /home/frappe/.npm /home/frappe/.next /tmp/* /var/tmp/* \
    apps/*/node_modules/.cache \
    apps/*/.cache

# -----------------------------------------------------------------------------
# Stage 2: runtime (lighter image without build tools)
# -----------------------------------------------------------------------------
FROM ${FRAPPE_IMAGE_PREFIX}/base:${FRAPPE_BRANCH} AS runtime

ARG FRAPPE_BRANCH=version-16
ENV FRAPPE_BRANCH=${FRAPPE_BRANCH}

USER frappe

# Copy the fully prepared bench (apps, env, built assets) from builder
COPY --from=builder --chown=frappe:frappe /home/frappe/frappe-bench /home/frappe/frappe-bench

WORKDIR /home/frappe/frappe-bench

# Move assets out of the sites volume so the image owns them
# and runtime-mounting the sites volume never serves stale assets.
RUN cp -r /home/frappe/frappe-bench/sites/assets /home/frappe/frappe-bench/assets && \
  rm -rf /home/frappe/frappe-bench/sites/assets

VOLUME [ \
  "/home/frappe/frappe-bench/sites", \
  "/home/frappe/frappe-bench/logs" \
]

# Entrypoint symlinks baked-in assets into the mounted sites volume.
USER root
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod 755 /usr/local/bin/start.sh

USER frappe
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["start.sh"]
