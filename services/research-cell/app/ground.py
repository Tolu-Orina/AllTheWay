"""One grounded look-up inside the research cell.

The swarm still never searches. This call happens once, before the workers,
and only URLs that came back in grounding metadata leave as `sources`. Workers
see the snippets; they cannot invent a footnote.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WebSource:
    title: str
    uri: str
    snippet: str = ""


def sources_from_chunks(chunks: object) -> list[WebSource]:
    """Keep http(s) URLs, drop duplicates and anything the model invented."""
    if not isinstance(chunks, list):
        return []
    out: list[WebSource] = []
    seen: set[str] = set()
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        web = chunk.get("web") if isinstance(chunk.get("web"), dict) else {}
        uri = str((web or {}).get("uri") or "").strip()
        if not uri.startswith("http") or uri in seen:
            continue
        seen.add(uri)
        title = str((web or {}).get("title") or uri).strip() or uri
        out.append(WebSource(title=title, uri=uri))
    return out


def chunks_from_response(response: object) -> list[WebSource]:
    """Read Vertex grounding metadata off a generate_content response."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return []
    meta = getattr(candidates[0], "grounding_metadata", None) or getattr(
        candidates[0], "groundingMetadata", None
    )
    if meta is None:
        return []
    raw = getattr(meta, "grounding_chunks", None) or getattr(meta, "groundingChunks", None)
    if raw is None:
        return []
    chunks = []
    for item in raw:
        web = getattr(item, "web", None)
        if web is None and isinstance(item, dict):
            chunks.append(item)
            continue
        uri = getattr(web, "uri", "") if web is not None else ""
        title = getattr(web, "title", "") if web is not None else ""
        chunks.append({"web": {"uri": uri, "title": title}})
    return sources_from_chunks(chunks)
