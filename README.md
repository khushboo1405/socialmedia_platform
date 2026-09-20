# Commons

A small social media platform built as a minor project.

**Stack:** HTML, CSS, vanilla JavaScript · Python + FastAPI · SQLite

## Features
- Sign up, log in, log out (salted PBKDF2 password hashes, bearer-token sessions)
- Create posts (up to 500 characters) with an optional photo
- Like / unlike, comment, delete your own posts
- Follow / unfollow people, home feed of people you follow
- Profiles with bio editing, follower counts and post history
- Explore page with search across people and posts
- Responsive layout (bottom tab bar on phones)

## Run it
```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

python seed.py                  # optional demo data (password: password123)
uvicorn app.main:app --reload
```
Open http://127.0.0.1:8000 — interactive API docs live at http://127.0.0.1:8000/docs

Demo users after seeding: `maya`, `arjun`, `lena`, `sam`.

## Project structure
```
commons/
├── app/
│   ├── main.py       # all API routes + static file serving
│   ├── database.py   # SQLite connection and schema
│   ├── auth.py       # password hashing, sessions, current-user dependency
│   └── schemas.py    # request models
├── static/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js     # single-page app (hash routing)
├── uploads/          # user photos
├── seed.py           # demo data
└── requirements.txt
```
The database file `commons.db` is created automatically on first run.

## Database tables
`users` · `sessions` · `posts` · `likes` · `comments` · `follows`
(likes, comments and follows use foreign keys with cascade deletes)

## API overview
| Method | Path | Purpose |
|---|---|---|
| POST | /api/auth/register, /api/auth/login, /api/auth/logout | Accounts |
| GET / PUT | /api/me | Current user / update profile |
| GET | /api/posts?scope=feed\|explore\|user&q=&before= | Post lists (paginated) |
| POST / DELETE | /api/posts, /api/posts/{id} | Create (multipart) / delete |
| POST | /api/posts/{id}/like | Toggle like |
| GET / POST | /api/posts/{id}/comments | Comments |
| GET | /api/users?q= , /api/users/suggestions , /api/users/{username} | Search, suggestions, profile |
| POST | /api/users/{username}/follow | Toggle follow |

## Ideas to extend
Notifications, direct messages, hashtags, password reset by email, image resizing with Pillow, switching to SQLAlchemy + Alembic migrations, rate limiting.
