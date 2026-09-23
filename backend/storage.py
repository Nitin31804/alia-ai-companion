"""Owner-scoped storage, separate from the pre-beta unowned chat archive."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def retention_days():
    try:
        days = int(os.getenv('ALIA_RETENTION_DAYS', '30'))
    except ValueError as exc:
        raise RuntimeError('ALIA_RETENTION_DAYS must be an integer.') from exc
    if not 0 <= days <= 3650:
        raise RuntimeError('ALIA_RETENTION_DAYS must be between 0 and 3650.')
    return days


@contextmanager
def connection():
    path = Path(os.getenv('ALIA_DB_PATH', str(Path(__file__).parent / 'data' / 'alia.db')))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def init_db():
    with connection() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('''CREATE TABLE IF NOT EXISTS turns (
            id INTEGER PRIMARY KEY, owner TEXT NOT NULL, chat TEXT NOT NULL,
            request TEXT NOT NULL, user TEXT NOT NULL, assistant TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(owner, chat, request))''')
        db.execute('CREATE INDEX IF NOT EXISTS owner_chat ON turns(owner, chat, id)')
        days = retention_days()
        if days:
            db.execute(
                "DELETE FROM turns WHERE created_at < datetime('now', ?)",
                (f'-{days} days',),
            )


def check():
    with connection() as db:
        db.execute('SELECT id FROM turns LIMIT 1').fetchone()


def get_turn(owner, chat, request):
    with connection() as db:
        row = db.execute('SELECT user, assistant FROM turns WHERE owner=? AND chat=? AND request=?', (owner, chat, request)).fetchone()
        return dict(row) if row else None


def history(owner, chat):
    with connection() as db:
        rows = db.execute('SELECT user, assistant FROM turns WHERE owner=? AND chat=? ORDER BY id DESC LIMIT 10', (owner, chat)).fetchall()
    return [message for row in reversed(rows) for message in (
        {'role': 'user', 'content': row['user']}, {'role': 'assistant', 'content': row['assistant']})]


def save_turn(owner, chat, request, user, assistant):
    with connection() as db:
        db.execute('INSERT OR IGNORE INTO turns(owner,chat,request,user,assistant) VALUES (?,?,?,?,?)', (owner, chat, request, user, assistant))


def delete_chat(owner, chat):
    with connection() as db:
        db.execute('PRAGMA secure_delete=ON')
        db.execute('DELETE FROM turns WHERE owner=? AND chat=?', (owner, chat))
