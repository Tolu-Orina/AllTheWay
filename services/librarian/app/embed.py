"""Embeddings, at a dimension Firestore can actually index.

## 1536, and why the default would have failed

`gemini-embedding-001` emits **3072 dimensions by default**. Firestore's vector
index caps at **2048**. Writing the default straight into an index fails — and
it fails at write time, on real user documents, rather than in development.

Measured against this project rather than assumed:

    requested=default  actual=3072   <- exceeds the cap
    requested=1536     actual=1536
    requested=768      actual=768

1536 is chosen over 768 for headroom, and over 3072 because 3072 is not an
option. `outputDimensionality` is therefore not a tuning knob here; it is
required for the thing to work at all.

## Truncation was tested, not trusted

Matryoshka representation learning claims a truncated vector stays useful. That
was checked by embedding a clause, a paraphrase, an unrelated sentence and a
translation, then comparing cosine similarity at each dimension. Ordering held
at 3072, 1536 and 768.

**One caveat this service carries:** cross-lingual retrieval works but the
margin is thin — a Yoruba query separated a matching English clause from an
unrelated one by 0.05, against 0.19 for an English paraphrase. A user may
reasonably ask about an English contract in Yoruba and get noisy results.

## europe-west1

Unlike the image and video models, every embedding model is available in
region — so the user's corpus, the most sensitive data this product holds,
never leaves it.
"""

from __future__ import annotations

import os

import google.auth
import google.auth.transport.requests
import httpx

MODEL = os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001")

#: Not `GOOGLE_CLOUD_LOCATION`. That is `global`, where text generation runs.
#: Collapsing two regions into one variable is what broke voice for a week.
LOCATION = os.environ.get("EMBEDDING_LOCATION", "europe-west1")

#: Firestore's vector index caps at 2048. See the module docstring.
DIMENSIONS = int(os.environ.get("EMBEDDING_DIMENSIONS", "1536"))

FIRESTORE_VECTOR_LIMIT = 2048

#: Vertex accepts a bounded number of instances per request.
BATCH = 25

TIMEOUT_SECONDS = 60.0


class EmbeddingUnavailable(RuntimeError):
    """Embedding failed. Ingestion stops rather than indexing nothing."""


def _endpoint() -> str:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    host = "aiplatform" if LOCATION == "global" else f"{LOCATION}-aiplatform"
    return (
        f"https://{host}.googleapis.com/v1/projects/{project}"
        f"/locations/{LOCATION}/publishers/google/models/{MODEL}:predict"
    )


def _token() -> str:
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    credentials.refresh(google.auth.transport.requests.Request())
    return credentials.token


def embed_all(texts: list[str], *, task: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Embed many texts, in order.

    The returned list is positionally aligned with the input — callers zip it
    against their chunks, and a reordering here would silently attach every
    embedding to the wrong passage.
    """
    if DIMENSIONS > FIRESTORE_VECTOR_LIMIT:
        # Refused at the boundary rather than discovered at write time. This is
        # the exact failure the default configuration produces.
        raise EmbeddingUnavailable(
            f"{DIMENSIONS} dimensions exceeds Firestore's {FIRESTORE_VECTOR_LIMIT} limit."
        )

    if not texts:
        return []

    url = _endpoint()
    headers = {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}
    vectors: list[list[float]] = []

    with httpx.Client(timeout=TIMEOUT_SECONDS) as http:
        for start in range(0, len(texts), BATCH):
            window = texts[start : start + BATCH]
            payload = {
                "instances": [{"content": t, "task_type": task} for t in window],
                "parameters": {"outputDimensionality": DIMENSIONS},
            }

            response = http.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                raise EmbeddingUnavailable(
                    f"Embedding returned HTTP {response.status_code}: {response.text[:300]}"
                )

            predictions = response.json().get("predictions", [])
            if len(predictions) != len(window):
                # Silently accepting a short response would misalign every
                # later chunk with its embedding.
                raise EmbeddingUnavailable(
                    f"Asked for {len(window)} embeddings and received {len(predictions)}."
                )

            for prediction in predictions:
                values = (prediction.get("embeddings") or {}).get("values")
                if not isinstance(values, list) or len(values) != DIMENSIONS:
                    raise EmbeddingUnavailable(
                        f"Expected {DIMENSIONS} dimensions, got {len(values) if values else 0}."
                    )
                vectors.append([float(v) for v in values])

    return vectors


def embed_query(text: str) -> list[float]:
    """A query embedding.

    `RETRIEVAL_QUERY`, not `RETRIEVAL_DOCUMENT`: the model places questions and
    passages differently, and using the document task for a query measurably
    degrades the match.
    """
    return embed_all([text], task="RETRIEVAL_QUERY")[0]
