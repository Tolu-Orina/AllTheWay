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
# Signs the AgentCard the registry verifies.
COPY libs/agentcards ./libs/agentcards
COPY libs/scopetoken ./libs/scopetoken
# Plans and entitlements. Ingest refuses a sixth document on Free, so the
# library has to be in the image or the container exits on import.
COPY libs/metering ./libs/metering
COPY services/librarian/pyproject.toml ./

# --target gives a flat, relocatable tree that can be copied into an image with
# no pip -- which is exactly what distroless is.
RUN pip install --no-cache-dir --upgrade pip && pip wheel --no-cache-dir --wheel-dir=/wheels ./libs/screening ./libs/scopetoken ./libs/agentcards ./libs/metering && pip install --no-cache-dir --target=/deps --find-links=/wheels .

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

# The Firestore emulator, because the tenant-isolation tests are the ones that
# must not be optional.
#
# They guard the single failure this product cannot have — one user's documents
# reaching another — and they assert things only a real Firestore can answer:
# that a path-scoped query cannot see a sibling subtree, and that layer 1 holds
# with the redundant filter removed. A fake would assert the fake.
#
# Without this they skipped, silently, in every CI run: `pytest` reported them
# as skips among passes and the build went green. Nine tests that never ran and
# looked exactly like nine tests that did.
#
# Pinned, and pinned to the version they were last proven against rather than to
# a moving "latest" that could change query semantics under them.
ARG FIRESTORE_EMULATOR_VERSION=1.19.8
RUN apt-get update     && apt-get install -y --no-install-recommends default-jre-headless curl     && rm -rf /var/lib/apt/lists/*     && curl -sSfL -o /opt/firestore-emulator.jar         "https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v${FIRESTORE_EMULATOR_VERSION}.jar"

# One RUN, because a background process does not survive between layers.
#
# The emulator is waited for rather than slept at: a fixed sleep is either too
# short on a slow builder or wasted on a fast one, and the too-short case turns
# into a connection error that reads like a broken test.
ENV FIRESTORE_EMULATOR_HOST=127.0.0.1:8081
RUN java -jar /opt/firestore-emulator.jar --host=127.0.0.1 --port=8081 &     for i in $(seq 1 60); do       if curl -sf "http://127.0.0.1:8081/" >/dev/null 2>&1; then break; fi;       if [ "$i" = "60" ]; then echo "Firestore emulator never came up." >&2; exit 1; fi;       sleep 1;     done     && python -m pytest tests -q

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
