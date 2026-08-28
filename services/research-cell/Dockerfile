# AllTheWay research cell.
#
#   deps  -> install dependencies into a relocatable tree
#   test  -> run pytest against that tree, inside the image
#   final -> distroless, non-root, no shell, no package manager
#
# Build from the REPO ROOT, not this directory:
#
#     docker build -f services/research-cell/Dockerfile -t research-cell .
#
# Why 3.11, why the root context, and why the test stage is a build stage:
# docs/decisions/0003-service-images.md
#
# Internal-only, and deliberately so: the cell is reachable from the
# orchestrator's service account and nothing else. See its README on why the
# swarm has exactly one exit.

# ---------------------------------------------------------------------- deps
FROM python:3.11-slim AS deps
WORKDIR /src

# Manifest first, so editing source does not invalidate the dependency layer.
# Card signing, which this service now imports to sign its own card.
COPY libs/agentcards ./libs/agentcards
COPY services/research-cell/pyproject.toml ./

# --target gives a flat, relocatable tree that can be copied into an image with
# no pip -- which is exactly what distroless is.
# `.[vertex]`, not `.`.
#
# `google-genai` is an optional extra so a local checkout stays light, but
# every deployed image needs it: the provider does `from google import genai`
# and Vertex is the only backend in production. Installing the bare project
# left that import raising `cannot import name 'genai' from 'google'` on the
# first turn -- and `google` resolves, because google-auth owns the same
# namespace, so nothing failed until the line actually ran.
RUN pip install --no-cache-dir --upgrade pip && pip wheel --no-cache-dir --wheel-dir=/wheels ./libs/agentcards && pip install --no-cache-dir --target=/deps --find-links=/wheels .[vertex]

# ---------------------------------------------------------------------- test
# A real build stage, not a convenience: `docker build --target test` exits
# non-zero when a test fails, so CI cannot ship an image whose suite is red.
FROM deps AS test
WORKDIR /src
COPY services/research-cell/ ./
# Only the runner is added. Reinstalling the project would re-resolve every
# dependency into the same --target, which pip declines to overwrite.
RUN pip install --no-cache-dir --target=/deps "pytest>=8.0"
ENV PYTHONPATH=/deps
RUN python -m pytest tests -q

# --------------------------------------------------------------------- final
FROM gcr.io/distroless/python3-debian12:nonroot AS final
WORKDIR /app

COPY --from=deps /deps /deps
COPY services/research-cell/app ./app

ENV PYTHONPATH=/deps     PYTHONUNBUFFERED=1     PYTHONDONTWRITEBYTECODE=1

# Exec form with no shell to expand $PORT, so the port is fixed rather than
# read at runtime. Cloud Run defaults to 8080 and the deploy pins it, making a
# mismatch a deploy-time error instead of a silently unreachable revision.
EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
