# AllTheWay Agent Gateway — the single policy enforcement point for connectors.
#
#   deps  -> install dependencies into a relocatable tree
#   test  -> run pytest against that tree, inside the image
#   final -> distroless, non-root, no shell, no package manager
#
# Build from the REPO ROOT, not this directory:
#
#     docker build -f services/connector-gateway/Dockerfile -t connector-gateway .
#
# Why 3.11, why the root context, and why the test stage is a build stage:
# docs/decisions/0003-service-images.md

# ---------------------------------------------------------------------- deps
FROM python:3.11-slim AS deps
WORKDIR /src

# The shared autonomy floor and the shared screener. Both are libraries rather
# than services: a safety check behind a network call is unavailable exactly
# when the network is degraded, and both of these fail closed.
COPY libs/policy ./libs/policy
COPY libs/screening ./libs/screening
# Card signing. The image must carry it: an import that resolves on a dev
# machine and not in the image is how a container exits before it listens.
COPY libs/agentcards ./libs/agentcards
# Plans and entitlements. Enforcement imports it, so the image must carry
# it — an import that resolves on a laptop and not here is how a container
# exits before it listens, which this repo has now seen three times.
COPY libs/metering ./libs/metering
COPY services/connector-gateway/pyproject.toml ./

RUN pip install --no-cache-dir --upgrade pip \
 && pip wheel --no-cache-dir --wheel-dir=/wheels ./libs/agentcards ./libs/metering ./libs/policy ./libs/screening \
 && pip install --no-cache-dir --target=/deps --find-links=/wheels .

# ---------------------------------------------------------------------- test
FROM deps AS test
WORKDIR /src
COPY services/connector-gateway/ ./
RUN pip install --no-cache-dir --target=/deps "pytest>=8.0" "pytest-asyncio>=0.24"
ENV PYTHONPATH=/deps
# These launch the calendar connector as a real MCP subprocess, so a pass here
# means the image can actually spawn and talk to a connector — not merely that
# the enforcement logic is right.
RUN python -m pytest tests -q

# --------------------------------------------------------------------- final
FROM gcr.io/distroless/python3-debian12:nonroot AS final
WORKDIR /app

COPY --from=deps /deps /deps
COPY services/connector-gateway/app ./app
# The connector servers ship with the gateway: it launches them as subprocesses,
# so they are part of this image rather than something it reaches over a network.
COPY services/connector-gateway/connectors ./connectors

ENV PYTHONPATH=/deps \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8080
ENTRYPOINT ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
