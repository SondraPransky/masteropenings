"""Account authentication for the web app (productization foundation, Piste C).

Salted PBKDF2-HMAC-SHA256 password hashing using only the standard library — no external
dependency, no plaintext ever stored. This is the login brick; per-account data isolation,
Lichess OAuth and a hosted deployment are the documented next phases (see docs/HOSTING.md).

The stored hash format is:  ``pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>``.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3

from . import db

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 240_000

# A well-formed hash of a random value, used to keep timing similar for unknown usernames.
_DUMMY_HASH = None


def hash_password(password: str, *, iterations: int = ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{ALGORITHM}${iterations}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of ``password`` against a stored PBKDF2 hash."""
    try:
        algorithm, iter_s, salt_hex, hash_hex = stored.split("$")
        if algorithm != ALGORITHM:
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iter_s)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


class AccountExists(ValueError):
    pass


def create_account(
    conn: sqlite3.Connection, username: str, password: str, email: str | None = None
) -> int:
    """Create an account, returning its id. Raises AccountExists on a duplicate username."""
    username = username.strip().lower()
    if not username or not password:
        raise ValueError("identifiant et mot de passe requis")
    if db.get_account(conn, username) is not None:
        raise AccountExists(f"l'identifiant {username!r} est déjà pris")
    account_id = db.insert_account(conn, username, hash_password(password),
                                   (email or "").strip() or None)
    conn.commit()
    return account_id


def authenticate(
    conn: sqlite3.Connection, username: str, password: str
) -> sqlite3.Row | None:
    """Return the account row if the credentials are valid, else None."""
    global _DUMMY_HASH
    account = db.get_account(conn, username.strip().lower())
    if account is None:
        if _DUMMY_HASH is None:                       # verify against a real hash anyway,
            _DUMMY_HASH = hash_password(secrets.token_hex(8))  # so timing doesn't leak
        verify_password(password, _DUMMY_HASH)
        return None
    return account if verify_password(password, account["password_hash"]) else None
