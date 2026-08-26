"""Google Docs, as an MCP server.

The connector the Implementation Plan actually named: *"save this deliverable
to a Doc"*. It creates documents through Drive and edits them through the Docs
API, so it needs both `drive.file` and `documents`.

`drive.file` is what keeps this narrow. The pair reaches only documents this
app created — a document the user wrote themselves is invisible here, which is
the scope doing its job and will otherwise read as a bug.
"""

from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

from _google import fail, message_from, ok, request

mcp = FastMCP("alltheway-docs")

DOCS = "https://docs.googleapis.com/v1/documents"
DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"

DOC_MIME = "application/vnd.google-apps.document"


@mcp.tool()
def create_document(title: str, body: str = "") -> str:
    """Create a Google Doc, optionally with starting text."""
    # Created through Drive rather than the Docs API so the file is owned under
    # drive.file — a document created via documents.create is not, and every
    # later call to it would be refused.
    boundary = "alltheway-boundary"
    metadata = json.dumps({"name": title, "mimeType": DOC_MIME})
    parts = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        "Content-Type: text/plain; charset=UTF-8\r\n\r\n"
        f"{body}\r\n"
        f"--{boundary}--"
    )

    status, payload = request(
        "POST",
        DRIVE_UPLOAD,
        params={"uploadType": "multipart", "fields": "id,name,webViewLink"},
        headers={"Content-Type": f"multipart/related; boundary={boundary}"},
        content=parts.encode("utf-8"),
    )
    if status not in (200, 201):
        return fail(message_from(payload, "Could not create the document."), status=status)
    return ok(
        id=payload.get("id"),
        title=payload.get("name"),
        link=payload.get("webViewLink"),
    )


@mcp.tool()
def read_document(document_id: str) -> str:
    """The document's text. Reads only."""
    status, payload = request("GET", f"{DOCS}/{document_id}")
    if status != 200:
        return fail(message_from(payload, "Could not read the document."), status=status)

    # The Docs model is a tree of structural elements. Only the text is useful
    # to a model, and flattening it here means the caller never has to know the
    # shape — or accidentally send the whole tree into a prompt.
    text: list[str] = []
    for element in (payload.get("body") or {}).get("content", []):
        paragraph = element.get("paragraph") if isinstance(element, dict) else None
        if not paragraph:
            continue
        for run in paragraph.get("elements", []):
            content = (run.get("textRun") or {}).get("content")
            if isinstance(content, str):
                text.append(content)

    return ok(id=document_id, title=payload.get("title"), text="".join(text))


@mcp.tool()
def append_text(document_id: str, text: str) -> str:
    """Add text to the end of a document."""
    # endOfSegmentLocation appends without needing to know the current length,
    # which would otherwise take a read first and be wrong the moment anyone
    # else typed into the document.
    status, payload = request(
        "POST",
        f"{DOCS}/{document_id}:batchUpdate",
        json={
            "requests": [
                {
                    "insertText": {
                        "endOfSegmentLocation": {"segmentId": ""},
                        "text": text,
                    }
                }
            ]
        },
    )
    if status != 200:
        return fail(message_from(payload, "Could not update the document."), status=status)
    return ok(updated=True, id=document_id)


if __name__ == "__main__":
    mcp.run()
