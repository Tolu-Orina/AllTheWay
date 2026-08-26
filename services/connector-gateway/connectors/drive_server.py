"""Google Drive, as an MCP server.

Scoped to `drive.file`: only files this app created. Deliberately not
`drive.readonly`, which is restricted, needs a security assessment, and would
hand over the user's entire Drive to answer "where did you save that?".

The practical consequence is worth stating plainly, because it will look like a
bug otherwise: `list_files` cannot see a document the user made themselves. It
lists what AllTheWay put there. That is the scope working, not failing.
"""

from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

from _google import capped, fail, message_from, ok, request

mcp = FastMCP("alltheway-drive")

API = "https://www.googleapis.com/drive/v3/files"


@mcp.tool()
def list_files(limit: int = 10) -> str:
    """Files this app created, newest first. Reads only."""
    status, payload = request(
        "GET",
        API,
        params={
            "pageSize": capped(limit),
            "orderBy": "createdTime desc",
            "fields": "files(id,name,mimeType,webViewLink,createdTime)",
        },
    )
    if status != 200:
        return fail(message_from(payload, "Could not list files."), status=status)

    return ok(
        files=[
            {
                "id": f.get("id"),
                "name": f.get("name"),
                "type": f.get("mimeType"),
                "link": f.get("webViewLink"),
            }
            for f in payload.get("files", [])
            if isinstance(f, dict)
        ]
    )


@mcp.tool()
def create_file(name: str, content: str = "", mime_type: str = "text/plain") -> str:
    """Create a plain file in the user's Drive."""
    # Multipart: metadata then bytes, which is what the upload endpoint wants.
    # Built explicitly because the alternative is two calls and a window where
    # an empty file exists.
    boundary = "alltheway-boundary"
    # json.dumps, not an f-string with !r: a file named `Q3 "final" plan` would
    # otherwise produce a malformed metadata part, and the upload would fail
    # with an error about JSON rather than about the name.
    metadata = json.dumps({"name": name})
    parts = (
        f"--{boundary}\r\n"
        "Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: {mime_type}\r\n\r\n"
        f"{content}\r\n"
        f"--{boundary}--"
    )

    status, payload = request(
        "POST",
        "https://www.googleapis.com/upload/drive/v3/files",
        params={"uploadType": "multipart", "fields": "id,name,webViewLink"},
        headers={"Content-Type": f"multipart/related; boundary={boundary}"},
        content=parts.encode("utf-8"),
    )
    if status not in (200, 201):
        return fail(message_from(payload, "Could not create the file."), status=status)
    return ok(id=payload.get("id"), name=payload.get("name"), link=payload.get("webViewLink"))


@mcp.tool()
def delete_file(file_id: str) -> str:
    """Delete a file this app created. Irreversible."""
    status, payload = request("DELETE", f"{API}/{file_id}")
    if status == 404:
        # The caller wanted it gone and it is gone. Not worth failing over.
        return ok(deleted=False, fileId=file_id, reason="not found")
    if status not in (200, 204):
        return fail(message_from(payload, "Could not delete the file."), status=status)
    return ok(deleted=True, fileId=file_id)


if __name__ == "__main__":
    mcp.run()
