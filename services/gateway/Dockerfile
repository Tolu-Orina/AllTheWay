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
# Typecheck both workspaces, then run the gateway's voice-relay tests. Env
# vars here exist only so env.ts can boot: the suite talks to a fake Live
# backend and never reaches Firestore or Vertex.
FROM build AS test
WORKDIR /repo
ENV FIRESTORE_EMULATOR_HOST=127.0.0.1:8081
ENV ALLOW_ANONYMOUS=true
ENV GOOGLE_CLOUD_PROJECT=alltheway-local
RUN npm ci --ignore-scripts \
      --workspace @alltheway/contracts \
      --workspace @alltheway/gateway \
      --include-workspace-root \
 && npm --workspace @alltheway/contracts run build \
 && npm run typecheck \
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

ENV NODE_ENV=production

# The distroless nodejs entrypoint is already `node`, so this is arguments to
# it, not a command. No shell means no $PORT expansion: the port is fixed, and
# a mismatch with the deploy is a deploy-time error rather than a revision that
# starts and is never reachable.
EXPOSE 8080
CMD ["services/gateway/dist/index.js"]
