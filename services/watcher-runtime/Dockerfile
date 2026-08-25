# AllTheWay watcher runtime.
#
#   deps  -> install dependencies into a relocatable tree
#   test  -> run pytest against that tree, inside the image
#   final -> distroless, non-root, no shell, no package manager
#
# Build from the REPO ROOT, not this directory:
#
#     docker build -f services/watcher-runtime/Dockerfile -t watcher-runtime .
#
# Why 3.11, why the root context, and why the test stage is a build stage:
# docs/decisions/0003-service-images.md
#
# Client-only A2A: this service calls the orchestrator and serves no JSON-RPC of
# its own, so it takes bare a2a-sdk rather than the [fastapi] extra the servers
# need. If that is ever wrong, this image fails at start, not at build.

# ---------------------------------------------------------------------- deps
FROM python:3.11-slim AS deps
WORKDIR /src

# Manifest first, so editing source does not invalidate the dependency layer.
# The shared autonomy floor, installed before the service that imports it.
# It is a library rather than a service on purpose: a pure function behind a
# network call would be unavailable exactly when the network is degraded,
# which is when you least want an action proceeding unchecked.
COPY libs/policy ./libs/policy
# Mandatory screening of untrusted external content. Shared for the same
# reason as the policy: a safety check behind a network call is unavailable
# exactly when the network is degraded, and this one fails closed.
COPY libs/screening ./libs/screening
COPY services/watcher-runtime/pyproject.toml ./

# --target gives a flat, relocatable tree that can be copied into an image with
# no pip -- which is exactly what distroless is.
RUN pip install --no-cache-dir --upgrade pip  && pip wheel --no-cache-dir --wheel-dir=/wheels ./libs/policy ./libs/screening && pip install --no-cache-dir --target=/deps --find-links=/wheels .

# ---------------------------------------------------------------------- test
# A real build stage, not a convenience: `docker build --target test` exits
# non-zero when a test fails, so CI cannot ship an image whose suite is red.
FROM deps AS test
WORKDIR /src
COPY services/watcher-runtime/ ./
# Only the runner is added. Reinstalling the project would re-resolve every
# dependency into the same --target, which pip declines to overwrite.
RUN pip install --no-cache-dir --target=/deps "pytest>=8.0"
ENV PYTHONPATH=/deps
RUN python -m pytest tests -q

# --------------------------------------------------------------------- final
FROM gcr.io/distroless/python3-debian12:nonroot AS final
WORKDIR /app

COPY --from=deps /deps /deps
COPY services/watcher-runtime/app ./app

ENV PYTHONPATH=/deps     PYTHONUNBUFFERED=1     PYTHONDONTWRITEBYTECODE=1

# Exec form with no shell to expand $PORT, so the port is fixed rather than
# read at runtime. Cloud Run defaults to 8080 and the deploy pins it, making a
# mismatch a deploy-time error instead of a silently unreachable revision.
EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
