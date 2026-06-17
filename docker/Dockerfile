# syntax=docker/dockerfile:1.7
#
# Production Dockerfile for the scripts app on top of Frappe/ERPNext v16.
#
# Architecture:
#   Stage 1 (bench-init) - based on `frappe/build`. Has Node, yarn, and Python
#                          build tools pre-installed. Initializes the bench
#                          from apps.json (just erpnext as a dependency),
#                          copies the scripts app from the build context,
#                          installs Python/Node deps, and builds production
#                          assets for erpnext. Uses BuildKit cache mounts for
#                          yarn/pip so subsequent builds are much faster.
#   Stage 2 (runtime)    - based on `frappe/base`. Lighter image without build
#                          tools. Copies the prepared bench from stage 1,
#                          relocates assets out of the sites volume so they
#                          stay in sync with the image.
#
# Result: a self-contained image with production-built assets for frappe,
# erpnext and the scripts app. No `bench build` at runtime.
#

ARG FRAPPE_BRANCH=version-16
ARG FRAPPE_IMAGE_PREFIX=frappe

# -----------------------------------------------------------------------------
# Stage 1: build everything (apps, deps, assets)
# -----------------------------------------------------------------------------
FROM ${FRAPPE_IMAGE_PREFIX}/build:${FRAPPE_BRANCH} AS bench-init

ARG FRAPPE_BRANCH=version-16
ARG FRAPPE_PATH=https://github.com/frappe/frappe
ARG CACHE_BUST=""

USER frappe

# Disable telemetry / upgrade nags during the build
ENV NEXT_TELEMETRY_DISABLED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
# Tell `bench build` we are in CI: this skips the `download_frappe_assets()`
# shortcut in frappe/commands/utils.py which would otherwise try to git
# rev-parse HEAD on ../apps/frappe. We delete .git below (to keep the image
# small) so that call would fail with `fatal: not a git repository (or any of
# the parent directories): .git`, and the captured error message contains `(`
# which then breaks the subsequent `git show-ref ... | grep <msg> | sed ...`
# shell pipeline in get_assets_link() with `Syntax error: "(" unexpected`,
# corrupting the `tag` variable and producing a confusing
# `Assets for Release <garbage> don't exist` warning. Building locally is
# the canonical way in CI anyway.
ENV CI=1

# 1. Initialize the bench and fetch all apps from apps.json (BuildKit secret).
#    `bench init --skip-assets` runs `bench get-app` for each app in apps.json
#    (clones, pip-installs, and yarn-installs) but SKIPS the trailing
#    `build_assets()` call that would do a dev-mode asset build. We do the
#    production build ourselves in the next step, saving ~10 minutes.
#
#    BuildKit cache mounts let pip/yarn cache survive across builds, so
#    subsequent builds don't re-download packages.
RUN --mount=type=secret,id=apps_json,target=/opt/frappe/apps.json,uid=1000,gid=1000 \
  --mount=type=cache,target=/home/frappe/.cache,uid=1000,gid=1000 \
  --mount=type=cache,target=/home/frappe/.npm,uid=1000,gid=1000 \
  : "${CACHE_BUST}" && \
  export APP_INSTALL_ARGS="" && \
  if [ -f /opt/frappe/apps.json ] && [ -s /opt/frappe/apps.json ]; then \
  # Quick sanity check: file must be valid JSON containing at least one app. \
  if python3 -c "import json,sys; data=json.load(open('/opt/frappe/apps.json')); assert isinstance(data, list) and len(data) > 0" 2>/dev/null; then \
  export APP_INSTALL_ARGS="--apps_path=/opt/frappe/apps.json"; \
  echo "Installing apps from /opt/frappe/apps.json (secret mount):"; \
  cat /opt/frappe/apps.json; \
  else \
  echo "WARNING: /opt/frappe/apps.json exists but is not valid JSON - falling back to no custom apps"; \
  fi; \
  else \
  echo "No /opt/frappe/apps.json secret - bench init will only install frappe"; \
  fi && \
  # Make sure the build starts from a clean state. A cached previous run may
  # have partially populated /home/frappe/frappe-bench, which would cause
  # `bench init` to prompt interactively on subsequent app installs.
  rm -rf /home/frappe/frappe-bench && \
  bench init ${APP_INSTALL_ARGS}\
  --frappe-branch=${FRAPPE_BRANCH} \
  --frappe-path=${FRAPPE_PATH} \
  --no-procfile \
  --no-backups \
  --skip-redis-config-generation \
  --skip-assets \
  --ignore-exist \
  --verbose \
  /home/frappe/frappe-bench && \
  cd /home/frappe/frappe-bench && \
  echo "{}" > sites/common_site_config.json && \
  find apps -mindepth 1 -path "*/.git" | xargs rm -fr

# Install the scripts app from the build context. apps.json only lists
# erpnext as a dependency; the scripts app is shipped via the Docker
# build context (this repo), not cloned from GitHub. This avoids the
# "scripts clones itself" nesting pattern.
COPY --chown=frappe:frappe pyproject.toml /home/frappe/frappe-bench/apps/scripts/pyproject.toml
COPY --chown=frappe:frappe README.md /home/frappe/frappe-bench/apps/scripts/README.md
COPY --chown=frappe:frappe license.txt /home/frappe/frappe-bench/apps/scripts/license.txt
COPY --chown=frappe:frappe scripts /home/frappe/frappe-bench/apps/scripts/scripts
# Translation compiler (see header in file for rationale)
COPY --chown=frappe:frappe docker/compile-translations.py /home/frappe/compile-translations.py
RUN cd /home/frappe/frappe-bench && \
  set -x && \
  # Register the scripts app in apps.txt so `bench` and `frappe` know
  # about it. `bench init` only wrote frappe + the apps from apps.json
  # (erpnext), so we append scripts here.
  #
  # IMPORTANT: bench init writes `frappe\nerpnext` to sites/apps.txt
  # WITHOUT a trailing newline. A naive `echo "scripts" >> sites/apps.txt`
  # concatenates `scripts` directly to `erpnext`, producing
  # `frappe\nerpnextscripts\n`. When `frappe.get_all_apps()` reads that
  # file with `read().split('\n')`, it parses `erpnextscripts` as a
  # single app name, and the subsequent `frappe.init()` call fails with
  # `ModuleNotFoundError: No module named 'erpnextscripts'`. Ensure
  # the file ends with a newline before appending.
  [ "$(tail -c1 sites/apps.txt | wc -l)" = "0" ] && echo "" >> sites/apps.txt; \
  echo "scripts" >> sites/apps.txt && \
  # Link the scripts app's public/ directory into sites/assets/. This is
  # what `bench init` would have done if the app were in apps.json; we
  # replicate it here since the app is shipped via the build context.
  mkdir -p sites/assets/scripts && \
  ln -sfn /home/frappe/frappe-bench/apps/scripts/scripts/public/* sites/assets/scripts/ && \
  # Install app-specific requirements (apps may have requirements.txt with
  # extra Python deps not in their setup.py).
  bench setup requirements --python && \
  # Install Node deps for all apps and run a single production build.
  # `bench setup requirements --node` runs `yarn install` (or `yarn`).
  bench setup requirements --node && \
  # Build JS/CSS assets for frappe and erpnext via `bench build`. This
  # internally:
  #   1. Calls `frappe.build.bundle` which sets up the assets directory
  #      symlinks (sites/assets/{frappe,erpnext} -> apps/{app}/{app}/public)
  #      and the dist/{js,css,css-rtl} subdirs.
  #   2. Runs `yarn run production --apps frappe,erpnext` from
  #      apps/frappe/, which invokes the esbuild script in apps/frappe/esbuild
  #      to compile the JS/CSS bundles into sites/assets/{app}/dist/.
  #   3. Calls `frappe.gettext.translate.compile_translations` for each
  #      selected app via a 4-worker `multiprocessing.Pool`. This step
  #      was the source of the previous intermittent CI failures (OOM
  #      or fork limits inside the constrained docker build context).
  #      Because we invoke our own `compile-translations.py` step below
  #      (which overwrites every .mo file with a byte-identical babel
  #      output), the pool's work here is wasted but harmless: the
  #      compile_translations() call is idempotent and a no-op when
  #      the .mo is up to date, so the pool forks 4 workers that
  #      each return immediately. The single-process babel loop below
  #      is the canonical source of truth for the .mo files shipped
  #      in the image.
  #
  # We pass `--apps frappe,erpnext` (plural, comma-separated) because:
  #
  #   - `--app X --app Y` (singular, repeated) does not work as expected:
  #     Click collapses repeated options to the last value, so only the
  #     last `--app` is honored.
  #
  #   - We need frappe assets built so the sanity-check
  #     `test -d sites/assets/frappe/dist/js` below passes. The previous
  #     `--app erpnext`-only invocation skipped frappe entirely.
  #
  # The scripts app is intentionally excluded: it has no JS bundles
  # (only plain JS files served via `app_include_js`) and is symlinked
  # into sites/assets/scripts/ by the step above, so it doesn't need
  # esbuild.
  bench build --production --apps frappe,erpnext && \
  # Compile MO translation files sequentially using babel (the same
  # library frappe.gettext uses internally, so the output is byte-
  # identical to `bench build`'s multiprocessing.Pool path). This
  # overwrites whatever the pool above produced and is the canonical
  # source of truth for the .mo files in the image. The script is
  # cwd-agnostic (it resolves sites_path from get_bench_path()) and
  # lives in docker/compile-translations.py (extracted to a file
  # because multi-line python -c strings break Dockerfile line-
  # continuation).
  ./env/bin/python /home/frappe/compile-translations.py && \
  # Sanity-check the critical asset directories were populated (file
  # names are hashed, so we only check the directories exist). If
  # `bench build` above fails, the RUN step aborts and the image never
  # builds - this just makes the failure mode clearer.
  test -d sites/assets/frappe/dist/js || \
  (echo "ERROR: frappe assets not built" && exit 1) && \
  test -d sites/assets/erpnext/dist/js || \
  (echo "ERROR: erpnext assets not built" && exit 1) && \
  test -d sites/assets/scripts/js || \
  (echo "ERROR: scripts assets not built - custom app failed" && exit 1)

# Drop transient caches we don't need in the runtime image.
# Must run as root because:
#   - /tmp is mode 1777 (sticky) on Debian/Ubuntu. Only the file owner or
#     root can delete a file in a sticky dir. The previous RUN ran as
#     `frappe` (uid 1000), so /tmp/node-compile-cache/v24.12.0-.../* files
#     created by Node are owned by frappe and root-owned files there can't
#     be removed by the next `rm -rf /tmp/*` invoked as frappe. The build
#     was failing with "rm: cannot remove '/tmp/node-compile-cache/...':
#     Permission denied" right at the end of the bench-init stage even
#     though the actual asset build had succeeded.
#   - apps/*/node_modules/.cache and apps/*/.cache contain files written by
#     various uids during the build, so the same issue applies.
USER root
RUN rm -rf /tmp/* /var/tmp/* \
  apps/*/node_modules/.cache \
  apps/*/.cache
USER frappe

# -----------------------------------------------------------------------------
# Stage 2: runtime image (no build tools)
# -----------------------------------------------------------------------------
FROM ${FRAPPE_IMAGE_PREFIX}/base:${FRAPPE_BRANCH} AS runtime

ARG FRAPPE_BRANCH=version-16
ENV FRAPPE_BRANCH=${FRAPPE_BRANCH}
ENV NEXT_TELEMETRY_DISABLED=1

USER frappe

# Copy the fully prepared bench (apps, env, built assets) from stage 1
COPY --from=bench-init --chown=frappe:frappe /home/frappe/frappe-bench /home/frappe/frappe-bench

WORKDIR /home/frappe/frappe-bench

# Move assets out of the sites volume so the image owns them.
# The entrypoint symlinks them back into the mounted sites volume at startup.
RUN cp -r /home/frappe/frappe-bench/sites/assets /home/frappe/frappe-bench/assets && \
  rm -rf /home/frappe/frappe-bench/sites/assets

VOLUME [ \
  "/home/frappe/frappe-bench/sites", \
  "/home/frappe/frappe-bench/logs" \
  ]

# Entrypoint: symlink baked-in assets into the mounted sites volume, then
# exec the command (default: start.sh).
USER root
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod 755 /usr/local/bin/start.sh

USER frappe
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["start.sh"]
