# AllTheWay gateway — the only service that faces the internet.
#
#   deps  -> npm ci for the two workspaces this service needs
#   build -> compile contracts and gateway to JavaScript
#   test  -> typecheck against the same tree, inside the image
#   final -> distroless nodejs22, non-root, no shell, no npm
#
# Build from the REPO ROOT, not this directory:
#
#     docker build -f services/gateway/Dockerfile -t gateway .
#
# Why 3.11/node22, why the root context, and why test is a build stage:
# docs/decisions/0003-service-images.md
#
# ## Why the context has to be the repo root
#
# This service imports `@alltheway/contracts`, a sibling workspace. A build
# context of services/gateway cannot see ../contracts at all — COPY refuses to
# leave the context. Every service therefore builds from the root, so the
# gateway is not a special case that breaks the moment someone copies a
# Dockerfile.
#
# ## Why compiled JavaScript rather than tsx
#
# Distroless carries a node binary and nothing else: no npm, no shell, no
# TypeScript loader. Shipping sources plus tsx would mean compiling on every
# cold start, which Cloud Run pays for on every scale-from-zero.

# ---------------------------------------------------------------------- deps
FROM node:22-slim AS deps
WORKDIR /repo

# Manifests only, so editing source does not re-run npm ci. The lockfile is
# workspace-wide, so every member's manifest must be present for `npm ci` to
# reconcile against it — including web's, which is otherwise unused here.
COPY package.json package-lock.json ./
COPY services/contracts/package.json services/contracts/
COPY services/gateway/package.json services/gateway/
COPY web/package.json web/

# Only the two workspaces this image needs. Installing the root workspace set
# would drag in web's Vite and Playwright toolchain for a backend image.
#
# --ignore-scripts is required, not cosmetic. The root `postinstall` builds
# contracts, and at this layer only manifests exist -- no sources -- so the
# script would fail and take `npm ci` with it. Contracts is built explicitly
# once its source is actually present.
RUN npm ci --ignore-scripts \
      --workspace @alltheway/contracts \
      --workspace @alltheway/gateway \
      --include-workspace-root

# --------------------------------------------------------------------- build
FROM deps AS build
WORKDIR /repo
COPY services/contracts services/contracts
COPY services/gateway services/gateway

# contracts first: the gateway imports its emitted .d.ts and .js, not its source.
RUN npm --workspace @alltheway/contracts run build \
 && npm --workspace @alltheway/gateway run build

# Drop devDependencies in place, so what ships is exactly what was built
# against, minus the toolchain. `npm ci --omit=dev` in a fresh stage could
# resolve differently; pruning cannot.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------- test
# Each image typechecks the workspace it actually installs, not the root
# script. The root `typecheck` spans every workspace, and these images
# deliberately install only their own plus contracts — so calling it here would
# fail on a workspace whose node_modules were never created. That is a build
# breaking for a reason unrelated to the code being built.
# Typecheck both workspaces, then run the gateway's voice-relay tests. Env
# vars here exist only so env.ts can boot: the suite talks to a fake Live
# backend and never reaches Firestore or Vertex.
FROM build AS test
WORKDIR /repo
ENV FIRESTORE_EMULATOR_HOST=127.0.0.1:8081
ENV ALLOW_ANONYMOUS=true
ENV GOOGLE_CLOUD_PROJECT=alltheway-local
ARG FIRESTORE_EMULATOR_VERSION=1.19.8
RUN apt-get update \
    && apt-get install -y --no-install-recommends default-jre-headless curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sSfL -o /opt/firestore-emulator.jar \
        "https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v${FIRESTORE_EMULATOR_VERSION}.jar"

# One RUN: a background process does not survive between layers. The emulator
# is waited for rather than slept at — a fixed sleep is either too short on a
# slow builder or wasted on a fast one, and too-short surfaces as a connection
# error that reads like a broken test.
RUN npm ci --ignore-scripts \
      --workspace @alltheway/contracts \
      --workspace @alltheway/gateway \
      --include-workspace-root \
 && npm --workspace @alltheway/contracts run build \
 && npm --workspace @alltheway/gateway run typecheck

# A separate RUN, and that is the whole point.
#
# `A && B && java ... &` backgrounds the ENTIRE chain, not just java — `&`
# terminates the whole && list. Folded into the install above, npm ci would
# have gone to the background and the tests would have started against a
# half-installed tree. Starting the emulator as the first command of its own
# RUN is what keeps `&` attached to java alone.
RUN java -jar /opt/firestore-emulator.jar --host=127.0.0.1 --port=8081 & \
    for i in $(seq 1 60); do \
      if curl -sf "http://127.0.0.1:8081/" >/dev/null 2>&1; then break; fi; \
      if [ "$i" = "60" ]; then echo "Firestore emulator never came up." >&2; exit 1; fi; \
      sleep 1; \
    done \
 && npm --workspace @alltheway/contracts test
 && npm --workspace @alltheway/gateway test

# --------------------------------------------------------------------- final
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS final
WORKDIR /repo

# The layout is preserved deliberately. npm workspaces links
# node_modules/@alltheway/contracts as a symlink to services/contracts, so the
# link only resolves if both sit where they did at install time.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/services/contracts/package.json ./services/contracts/
COPY --from=build /repo/services/contracts/dist ./services/contracts/dist
COPY --from=build /repo/services/gateway/package.json ./services/gateway/
COPY --from=build /repo/services/gateway/dist ./services/gateway/dist

# The workspace's OWN node_modules, which is not the same set as the root's.
#
# npm hoists what it can, but a package whose hoisted slot is already taken by
# an incompatible version gets nested under the workspace instead. `ws` is the
# first one here: the root slot holds ws@7, a dev dependency of firebase-tools,
# so the gateway's ws@8 lands in services/gateway/node_modules. `npm prune
# --omit=dev` then deletes the root ws@7 as dev, and without this line the
# nested ws@8 never reaches the image — so `import "ws"` resolves to nothing
# and the container exits(1) before it can listen.
#
# Four packages are in that state today (ws, google-auth-library, gcp-metadata,
# google-logging-utils), and which ones they are changes with any dependency
# bump. Copying the directory is what makes that reshuffling harmless.
COPY --from=build /repo/services/gateway/node_modules ./services/gateway/node_modules

ENV NODE_ENV=production

# The distroless nodejs entrypoint is already `node`, so this is arguments to
# it, not a command. No shell means no $PORT expansion: the port is fixed, and
# a mismatch with the deploy is a deploy-time error rather than a revision that
# starts and is never reachable.
EXPOSE 8080
CMD ["services/gateway/dist/index.js"]
