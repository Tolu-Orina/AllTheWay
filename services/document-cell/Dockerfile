# AllTheWay document cell.
#
# Compilers live in the gateway workspace (pptxgenjs / pdf-lib / docx). This
# image is that tree with a different entrypoint: the quality loop, not the
# public API. Internal-only — the gateway calls it after Yes.
#
# Visual QA needs LibreOffice. Distroless cannot run soffice, so the final
# stage is Debian slim with Impress + Carlito (Calibri metrics).
#
#   docker build -f services/document-cell/Dockerfile -t document-cell .

# ---------------------------------------------------------------------- deps
FROM node:22-bookworm-slim AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY services/contracts/package.json services/contracts/
COPY services/gateway/package.json services/gateway/
COPY web/package.json web/

RUN npm ci --ignore-scripts \
      --workspace @alltheway/contracts \
      --workspace @alltheway/gateway \
      --include-workspace-root

# --------------------------------------------------------------------- build
FROM deps AS build
WORKDIR /repo
COPY services/contracts services/contracts
COPY services/gateway services/gateway

RUN npm --workspace @alltheway/contracts run build \
 && npm --workspace @alltheway/gateway run build

RUN npm prune --omit=dev

# ---------------------------------------------------------------------- test
FROM build AS test
WORKDIR /repo
COPY services/document-cell/references ./services/document-cell/references
ENV FIRESTORE_EMULATOR_HOST=127.0.0.1:8081
ENV ALLOW_ANONYMOUS=true
ENV GOOGLE_CLOUD_PROJECT=alltheway-local
RUN npm ci --ignore-scripts \
      --workspace @alltheway/contracts \
      --workspace @alltheway/gateway \
      --include-workspace-root \
 && npm --workspace @alltheway/contracts run build \
 && npm --workspace @alltheway/gateway run typecheck \
 && npm --workspace @alltheway/gateway exec -- node --import tsx --test src/document-quality.test.ts src/office-files.test.ts src/document-cell-prompt.test.ts src/document-references.test.ts

# --------------------------------------------------------------------- final
FROM node:22-bookworm-slim AS final
WORKDIR /repo

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress \
      fonts-crosextra-carlito \
      fonts-liberation \
      fontconfig \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 65532 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin atw

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/services/contracts/package.json ./services/contracts/
COPY --from=build /repo/services/contracts/dist ./services/contracts/dist
COPY --from=build /repo/services/gateway/package.json ./services/gateway/
COPY --from=build /repo/services/gateway/dist ./services/gateway/dist
COPY --from=build /repo/services/gateway/node_modules ./services/gateway/node_modules
COPY services/document-cell/references ./services/document-cell/references
COPY services/document-cell/fonts.conf /etc/fonts/conf.d/99-calibri-carlito.conf

ENV NODE_ENV=production \
    HOME=/tmp \
    SAL_USE_VCLPLUGIN=svp \
    LIBREOFFICE_BIN=/usr/bin/soffice \
    SLIDE_REFERENCE_DIR=/repo/services/document-cell/references

USER 65532
EXPOSE 8080
CMD ["node", "services/gateway/dist/document-cell-server.js"]
