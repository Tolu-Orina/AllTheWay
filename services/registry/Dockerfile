# AllTheWay Agent Registry.
#
#   deps  -> install dependencies into a relocatable tree
#   test  -> run pytest against that tree, inside the image
#   final -> distroless, non-root, no shell, no package manager
#
# Build from the REPO ROOT, not this directory:
#
#     docker build -f services/registry/Dockerfile -t registry .
#
# Why 3.11, why the root context, and why the test stage is a build stage:
# docs/decisions/0003-service-images.md
#
# Internal-only. The browser reaches it through the gateway, which is the only
# service the browser can talk to at all.

# ---------------------------------------------------------------------- deps
FROM python:3.11-slim AS deps
WORKDIR /src

# Shared libraries first, and copied explicitly.
#
# An import that resolves on a developer machine and not in the image is how a
# container exits before it listens — which has happened twice in this repo, so
# these lines are load-bearing rather than tidy.
COPY libs/agentcards ./libs/agentcards
COPY libs/agentauth ./libs/agentauth
COPY services/registry/pyproject.toml ./

# --target gives a flat, relocatable tree that can be copied into an image with
# no pip -- which is exactly what distroless is.
RUN pip install --no-cache-dir --upgrade pip && pip wheel --no-cache-dir --wheel-dir=/wheels ./libs/agentcards ./libs/agentauth && pip install --no-cache-dir --target=/deps --find-links=/wheels .

# ---------------------------------------------------------------------- test
# A real build stage: `docker build --target test` exits non-zero when a test
# fails, so CI cannot ship an image whose suite is red.
FROM deps AS test
WORKDIR /src
COPY services/registry/ ./
RUN pip install --no-cache-dir --target=/deps "pytest>=8.0" "pytest-asyncio>=0.24"
ENV PYTHONPATH=/deps
RUN python -m pytest tests -q

# --------------------------------------------------------------------- final
FROM gcr.io/distroless/python3-debian12:nonroot AS final
WORKDIR /app

COPY --from=deps /deps /deps
COPY services/registry/app ./app

ENV PYTHONPATH=/deps PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# Exec form with no shell to expand $PORT, so the port is fixed rather than read
# at runtime. Cloud Run defaults to 8080 and the deploy pins it, making a
# mismatch a deploy-time error instead of a silently unreachable revision.
EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
