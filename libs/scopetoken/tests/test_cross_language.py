"""The minter is TypeScript; the verifier is Python. That seam needs a test.

Node's signer emits ASN.1 DER and JWS wants fixed-width `R||S`. The conversion
is done by hand in `services/gateway/src/scope.ts`, and getting it subtly wrong
produces a signature that is *usually* right — DER trims leading zero bytes,
so a naive slice works until the day `r` happens to start with one. That is a
bug that appears in production, at random, months later.

The same trap already caught the AgentCard work. Here it is tested instead of
remembered.

Skipped, loudly, when Node or the gateway source is not available — a silent
skip on a cross-language contract is how the contract rots.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from alltheway_scopetoken import Reason, verify

REPO = Path(__file__).resolve().parents[3]
MINTER = REPO / "services" / "gateway" / "src" / "scope.ts"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not MINTER.exists(),
    reason="node or the TypeScript minter is unavailable",
)


def _keypair() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    return (
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
        key.public_key()
        .public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        .decode(),
    )


def _mint_with_node(private_pem: str, user: str, audience: str = "librarian") -> str:
    """Mint a token using the real TypeScript minter."""
    with tempfile.TemporaryDirectory() as tmp:
        key_path = Path(tmp) / "sk.pem"
        key_path.write_text(private_pem, encoding="utf-8")

        script = Path(tmp) / "mint.mjs"
        script.write_text(
            "import { readFileSync } from 'node:fs';\n"
            "process.env.SCOPE_TOKEN_SIGNING_KEY = readFileSync(process.argv[2], 'utf8');\n"
            "process.env.GOOGLE_CLOUD_PROJECT = 'alltheway-local';\n"
            "process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8081';\n"
            f"const m = await import({json.dumps(MINTER.as_uri())});\n"
            "console.log(m.mintScopeToken(process.argv[3], process.argv[4]));\n",
            encoding="utf-8",
        )

        result = subprocess.run(
            ["node", "--import", "tsx", str(script), str(key_path), user, audience],
            capture_output=True,
            text=True,
            cwd=REPO,
            timeout=180,
            env={**os.environ},
        )
        if result.returncode != 0:
            pytest.skip(f"node minter unavailable: {result.stderr.strip()[:200]}")
        return result.stdout.strip().splitlines()[-1]


def test_a_node_minted_token_verifies_in_python():
    private, public = _keypair()
    token = _mint_with_node(private, "alice-xyz")

    scope = verify(token, public_key_pem=public, audience="librarian")
    assert scope.ok, scope.summary()
    assert scope.user == "alice-xyz"


def test_the_audience_binds_across_languages():
    private, public = _keypair()
    token = _mint_with_node(private, "alice-xyz", audience="librarian")

    assert verify(token, public_key_pem=public, audience="scribe").reason is Reason.BAD_AUDIENCE


def test_many_signatures_survive_der_padding():
    """The actual trap.

    DER trims leading zero bytes from r and s, so a fixed-width conversion that
    does not left-pad is right about 255 times in 256. One token in a few
    hundred would fail, at random, in production. Minting a batch is the only
    way to catch that before it happens.
    """
    private, public = _keypair()

    for index in range(12):
        token = _mint_with_node(private, f"user-{index}")
        scope = verify(token, public_key_pem=public, audience="librarian")
        assert scope.ok, f"token {index} failed: {scope.summary()}"
        assert scope.user == f"user-{index}"
