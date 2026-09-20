"""Commons: a small social platform. FastAPI + SQLite + vanilla JS frontend."""
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.staticfiles import StaticFiles

from .auth import create_session, current_user, hash_password, verify_password
from .database import BASE_DIR, UPLOAD_DIR, get_db, init_db
from .schemas import CommentIn, LoginIn, ProfileIn, RegisterIn


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Commons", lifespan=lifespan)

USERNAME_RE = re.compile(r"[a-z0-9_]{3,20}")
AVATAR_COLORS = ["#5A3FE0", "#D6336C", "#0F8B8D", "#E07A1F", "#2E6FBA", "#7A4E9E", "#4C8C2B"]
ALLOWED_IMAGES = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_POST = 500
MAX_COMMENT = 300


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def public_user(row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "bio": row["bio"],
        "avatar_color": row["avatar_color"],
    }


# --------------------------------------------------------------------- auth
@app.post("/api/auth/register", status_code=201)
def register(data: RegisterIn, db=Depends(get_db)):
    username = data.username.strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(400, "Usernames use 3–20 letters, numbers or underscores.")
    if len(data.password) < 6:
        raise HTTPException(400, "Passwords need at least 6 characters.")
    display = data.display_name.strip()[:40] or username
    if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        raise HTTPException(409, "That username is taken. Try another.")

    salt, digest = hash_password(data.password)
    color = AVATAR_COLORS[sum(map(ord, username)) % len(AVATAR_COLORS)]
    cur = db.execute(
        """INSERT INTO users (username, display_name, avatar_color, password_salt, password_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (username, display, color, salt, digest, now()),
    )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return {"token": create_session(db, row["id"]), "user": public_user(row)}


@app.post("/api/auth/login")
def login(data: LoginIn, db=Depends(get_db)):
    row = db.execute(
        "SELECT * FROM users WHERE username = ?", (data.username.strip().lower(),)
    ).fetchone()
    if not row or not verify_password(data.password, row["password_salt"], row["password_hash"]):
        raise HTTPException(401, "Username or password is incorrect.")
    return {"token": create_session(db, row["id"]), "user": public_user(row)}


@app.post("/api/auth/logout")
def logout(user=Depends(current_user), db=Depends(get_db)):
    db.execute("DELETE FROM sessions WHERE token = ?", (user["token"],))
    db.commit()
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return public_user(user)


@app.put("/api/me")
def update_me(data: ProfileIn, user=Depends(current_user), db=Depends(get_db)):
    display = data.display_name.strip()[:40]
    if not display:
        raise HTTPException(400, "Display name can't be empty.")
    db.execute(
        "UPDATE users SET display_name = ?, bio = ? WHERE id = ?",
        (display, data.bio.strip()[:160], user["id"]),
    )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return public_user(row)


# -------------------------------------------------------------------- posts
POST_SELECT = """
SELECT p.id, p.content, p.image, p.created_at,
       u.username, u.display_name, u.avatar_color,
       (SELECT COUNT(*) FROM likes l    WHERE l.post_id = p.id) AS like_count,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
       EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = :me) AS liked
FROM posts p JOIN users u ON u.id = p.user_id
"""


def post_dict(row) -> dict:
    d = dict(row)
    d["liked"] = bool(d["liked"])
    image = d.pop("image")
    d["image_url"] = f"/uploads/{image}" if image else None
    return d


def save_image(upload: UploadFile) -> str:
    ext = ALLOWED_IMAGES.get(upload.content_type)
    if not ext:
        raise HTTPException(400, "Photos must be JPG, PNG, GIF or WebP.")
    data = upload.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Photos must be under 5 MB.")
    name = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / name).write_bytes(data)
    return name


@app.get("/api/posts")
def list_posts(
    scope: str = "explore",  # feed | explore | user
    username: str | None = None,
    q: str | None = None,
    before: int | None = None,
    limit: int = Query(15, ge=1, le=50),
    user=Depends(current_user),
    db=Depends(get_db),
):
    where, params = [], {"me": user["id"], "limit": limit}
    if scope == "feed":
        where.append(
            "(p.user_id = :me OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = :me))"
        )
    elif scope == "user":
        where.append("u.username = :uname")
        params["uname"] = (username or "").lower()
    if q:
        where.append("p.content LIKE :q")
        params["q"] = f"%{q}%"
    if before:
        where.append("p.id < :before")
        params["before"] = before
    sql = POST_SELECT + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY p.id DESC LIMIT :limit"
    return [post_dict(r) for r in db.execute(sql, params).fetchall()]


@app.post("/api/posts", status_code=201)
def create_post(
    content: str = Form(""),
    image: UploadFile | None = File(None),
    user=Depends(current_user),
    db=Depends(get_db),
):
    content = content.strip()
    has_image = image is not None and bool(image.filename)
    if not content and not has_image:
        raise HTTPException(400, "Write something or add a photo first.")
    if len(content) > MAX_POST:
        raise HTTPException(400, f"Posts can be up to {MAX_POST} characters.")
    filename = save_image(image) if has_image else None
    cur = db.execute(
        "INSERT INTO posts (user_id, content, image, created_at) VALUES (?, ?, ?, ?)",
        (user["id"], content, filename, now()),
    )
    db.commit()
    row = db.execute(POST_SELECT + " WHERE p.id = :pid", {"me": user["id"], "pid": cur.lastrowid}).fetchone()
    return post_dict(row)


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: int, user=Depends(current_user), db=Depends(get_db)):
    row = db.execute("SELECT user_id, image FROM posts WHERE id = ?", (post_id,)).fetchone()
    if not row:
        raise HTTPException(404, "That post no longer exists.")
    if row["user_id"] != user["id"]:
        raise HTTPException(403, "You can only delete your own posts.")
    db.execute("DELETE FROM posts WHERE id = ?", (post_id,))
    db.commit()
    if row["image"]:
        (UPLOAD_DIR / row["image"]).unlink(missing_ok=True)
    return {"ok": True}


@app.post("/api/posts/{post_id}/like")
def toggle_like(post_id: int, user=Depends(current_user), db=Depends(get_db)):
    if not db.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone():
        raise HTTPException(404, "That post no longer exists.")
    existing = db.execute(
        "SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?", (user["id"], post_id)
    ).fetchone()
    if existing:
        db.execute("DELETE FROM likes WHERE user_id = ? AND post_id = ?", (user["id"], post_id))
    else:
        db.execute("INSERT INTO likes (user_id, post_id) VALUES (?, ?)", (user["id"], post_id))
    db.commit()
    count = db.execute("SELECT COUNT(*) FROM likes WHERE post_id = ?", (post_id,)).fetchone()[0]
    return {"liked": not existing, "like_count": count}


# ----------------------------------------------------------------- comments
@app.get("/api/posts/{post_id}/comments")
def list_comments(post_id: int, user=Depends(current_user), db=Depends(get_db)):
    rows = db.execute(
        """SELECT c.id, c.content, c.created_at, u.username, u.display_name, u.avatar_color
           FROM comments c JOIN users u ON u.id = c.user_id
           WHERE c.post_id = ? ORDER BY c.id""",
        (post_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: int, data: CommentIn, user=Depends(current_user), db=Depends(get_db)):
    content = data.content.strip()
    if not content:
        raise HTTPException(400, "Write a comment first.")
    if len(content) > MAX_COMMENT:
        raise HTTPException(400, f"Comments can be up to {MAX_COMMENT} characters.")
    if not db.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone():
        raise HTTPException(404, "That post no longer exists.")
    cur = db.execute(
        "INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)",
        (post_id, user["id"], content, now()),
    )
    db.commit()
    row = db.execute(
        """SELECT c.id, c.content, c.created_at, u.username, u.display_name, u.avatar_color
           FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?""",
        (cur.lastrowid,),
    ).fetchone()
    return dict(row)


# -------------------------------------------------------------------- users
# NOTE: fixed paths (/suggestions, search) must be declared before /{username}.
@app.get("/api/users/suggestions")
def suggestions(user=Depends(current_user), db=Depends(get_db)):
    rows = db.execute(
        """SELECT u.username, u.display_name, u.avatar_color,
                  (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
           FROM users u
           WHERE u.id != :me
             AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = :me)
           ORDER BY RANDOM() LIMIT 5""",
        {"me": user["id"]},
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/users")
def search_users(q: str = "", user=Depends(current_user), db=Depends(get_db)):
    q = q.strip().lstrip("@")
    if not q:
        return []
    like = f"%{q}%"
    rows = db.execute(
        """SELECT u.username, u.display_name, u.avatar_color, u.bio,
                  EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :me AND f.followee_id = u.id) AS is_following,
                  (u.id = :me) AS is_me
           FROM users u
           WHERE u.username LIKE :q OR u.display_name LIKE :q
           ORDER BY u.username LIMIT 8""",
        {"me": user["id"], "q": like},
    ).fetchall()
    return [{**dict(r), "is_following": bool(r["is_following"]), "is_me": bool(r["is_me"])} for r in rows]


@app.get("/api/users/{username}")
def get_profile(username: str, user=Depends(current_user), db=Depends(get_db)):
    row = db.execute("SELECT * FROM users WHERE username = ?", (username.lower(),)).fetchone()
    if not row:
        raise HTTPException(404, "We couldn't find that person.")
    uid = row["id"]

    def count(sql, *args):
        return db.execute(sql, args).fetchone()[0]

    return {
        **public_user(row),
        "created_at": row["created_at"],
        "post_count": count("SELECT COUNT(*) FROM posts WHERE user_id = ?", uid),
        "followers": count("SELECT COUNT(*) FROM follows WHERE followee_id = ?", uid),
        "following": count("SELECT COUNT(*) FROM follows WHERE follower_id = ?", uid),
        "is_following": bool(
            count("SELECT COUNT(*) FROM follows WHERE follower_id = ? AND followee_id = ?", user["id"], uid)
        ),
        "is_me": uid == user["id"],
    }


@app.post("/api/users/{username}/follow")
def toggle_follow(username: str, user=Depends(current_user), db=Depends(get_db)):
    target = db.execute("SELECT id FROM users WHERE username = ?", (username.lower(),)).fetchone()
    if not target:
        raise HTTPException(404, "We couldn't find that person.")
    if target["id"] == user["id"]:
        raise HTTPException(400, "You can't follow yourself.")
    existing = db.execute(
        "SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?", (user["id"], target["id"])
    ).fetchone()
    if existing:
        db.execute(
            "DELETE FROM follows WHERE follower_id = ? AND followee_id = ?", (user["id"], target["id"])
        )
    else:
        db.execute(
            "INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)", (user["id"], target["id"])
        )
    db.commit()
    followers = db.execute(
        "SELECT COUNT(*) FROM follows WHERE followee_id = ?", (target["id"],)
    ).fetchone()[0]
    return {"following": not existing, "followers": followers}


# ------------------------------------------------------------ static files
UPLOAD_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")
