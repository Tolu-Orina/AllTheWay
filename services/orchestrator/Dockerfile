# AllTheWay orchestrator.
#
#   deps  -> install into a relocatable tree
#   test  -> run pytest against that tree, inside the image
#   final -> distroless, non-root, no shell, no package manager
#
# Build from the REPO ROOT, not this directory:
#
#     docker build -f services/orchestrator/Dockerfile -t orchestrator .
#
# Every service builds the same way so the gateway — which needs a sibling
# workspace package — is not the one special case. See .dockerignore.
#
# Why 3.11, why the root context, and why the test stage is a build stage:
# docs/decisions/0003-service-images.md

# ---------------------------------------------------------------------- deps
FROM python:3.11-slim AS deps
WORKDIR /src

# Only the manifest first, so a source edit does not invalidate the dependency
# layer. This is the difference between a 5-second rebuild and a 90-second one.
# The shared autonomy floor, installed before the service that imports it.
# It is a library rather than a service on purpose: a pure function behind a
# network call would be unavailable exactly when the network is degraded,
# which is when you least want an action proceeding unchecked.
COPY libs/policy ./libs/policy
COPY services/orchestrator/pyproject.toml ./

# --target gives a flat, relocatable tree that can be copied into an image with
# no pip, which is exactly what distroless is.
RUN pip install --no-cache-dir --upgrade pip \
 && pip wheel --no-cache-dir --wheel-dir=/wheels ./libs/policy && pip install --no-cache-dir --target=/deps --find-links=/wheels .

# ---------------------------------------------------------------------- test
# A real build stage, not a convenience: `docker build --target test` fails the
# build when a test fails, so CI cannot ship an image whose suite is red.
FROM deps AS test
WORKDIR /src
COPY services/orchestrator/ ./
# Only the test runner is added. Reinstalling the project would re-resolve every
# dependency into the same --target, which pip refuses to overwrite and then
# warns about -- leaving a tree that is neither the first resolution nor the
# second.
RUN pip install --no-cache-dir --target=/deps "pytest>=8.0"
ENV PYTHONPATH=/deps
RUN python -m pytest tests -q

# --------------------------------------------------------------------- final
FROM gcr.io/distroless/python3-debian12:nonroot AS final
WORKDIR /app

COPY --from=deps /deps /deps
COPY services/orchestrator/app ./app

ENV PYTHONPATH=/deps \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

# Distroless has no shell, so this is exec form with no expansion: the port is
# fixed rather than read from $PORT at runtime. Cloud Run sends 8080 by default
# and the deploy pins it, so a mismatch is a deploy-time error rather than a
# silently unreachable revision.
EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
