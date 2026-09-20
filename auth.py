"""Password hashing and token sessions using only the standard library."""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException

from .database import get_db

SESSION_DAYS = 30


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 200_000
    ).hex()
    return salt, digest


def verify_password(password: str, salt: str, expected: str) -> bool:
    _, digest = hash_password(password, salt)
    return hmac.compare_digest(digest, expected)


def create_session(db, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
        (token, user_id, datetime.now(timezone.utc).isoformat(timespec="seconds")),
    )
    db.commit()
    return token


def current_user(authorization: str | None = Header(None), db=Depends(get_db)) -> dict:
    """Resolve 'Authorization: Bearer <token>' to a user, or raise 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Log in to continue.")
    token = authorization[7:].strip()
    row = db.execute(
        """SELECT u.id, u.username, u.display_name, u.bio, u.avatar_color, s.created_at AS session_at
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = ?""",
        (token,),
    ).fetchone()
    if not row:
        raise HTTPException(401, "Your session has ended. Log in again.")
    started = datetime.fromisoformat(row["session_at"])
    if datetime.now(timezone.utc) - started > timedelta(days=SESSION_DAYS):
        db.execute("DELETE FROM sessions WHERE token = ?", (token,))
        db.commit()
        raise HTTPException(401, "Your session has ended. Log in again.")
    user = dict(row)
    user.pop("session_at")
    user["token"] = token
    return user
