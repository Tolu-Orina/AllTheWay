# AllTheWay librarian.
#
#   deps  -> install dependencies into a relocatable tree
#   test  -> run pytest against that tree, inside the image
#   final -> distroless, non-root, no shell, no package manager
#
# Build from the REPO ROOT, not this directory:
#
#     docker build -f services/librarian/Dockerfile -t librarian .
#
# Why 3.11, why the root context, and why the test stage is a build stage:
# docs/decisions/0003-service-images.md
#
# Internal-only. It holds the user's documents and has no connector access,
# no ability to act, and no credentials beyond its own — which is what limits
# the blast radius of a malicious PDF attacking the extraction library.

# ---------------------------------------------------------------------- deps
FROM python:3.11-slim AS deps
WORKDIR /src

# Manifest first, so editing source does not invalidate the dependency layer.
# Card signing, which this service now imports to sign its own card.
# Screening runs before any model sees a document; the scope token is how
# this service learns which user a request is for. Both are imported, so
# both must be in the image — an import that resolves on a laptop and not
# here is how a container exits before it listens.
COPY libs/screening ./libs/screening
COPY libs/scopetoken ./libs/scopetoken
COPY services/librarian/pyproject.toml ./

# --target gives a flat, relocatable tree that can be copied into an image with
# no pip -- which is exactly what distroless is.
RUN pip install --no-cache-dir --upgrade pip && pip wheel --no-cache-dir --wheel-dir=/wheels ./libs/screening ./libs/scopetoken && pip install --no-cache-dir --target=/deps --find-links=/wheels .

# ---------------------------------------------------------------------- test
# A real build stage, not a convenience: `docker build --target test` exits
# non-zero when a test fails, so CI cannot ship an image whose suite is red.
FROM deps AS test
WORKDIR /src
COPY services/librarian/ ./
# Only the runner is added. Reinstalling the project would re-resolve every
# dependency into the same --target, which pip declines to overwrite.
RUN pip install --no-cache-dir --target=/deps "pytest>=8.0"
ENV PYTHONPATH=/deps
RUN python -m pytest tests -q

# --------------------------------------------------------------------- final
FROM gcr.io/distroless/python3-debian12:nonroot AS final
WORKDIR /app

COPY --from=deps /deps /deps
COPY services/librarian/app ./app

ENV PYTHONPATH=/deps     PYTHONUNBUFFERED=1     PYTHONDONTWRITEBYTECODE=1

# Exec form with no shell to expand $PORT, so the port is fixed rather than
# read at runtime. Cloud Run defaults to 8080 and the deploy pins it, making a
# mismatch a deploy-time error instead of a silently unreachable revision.
EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
