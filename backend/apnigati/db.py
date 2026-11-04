"""SQLite storage. JSON columns hold model outputs; relational columns hold what we query on."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY, name TEXT, district TEXT, block TEXT, simulated INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, school_id TEXT, name TEXT, grades TEXT, language TEXT
);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY, class_id TEXT, name TEXT, grade INTEGER, language TEXT
);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY, class_id TEXT, student_id TEXT, source TEXT, image_path TEXT,
  overlay_path TEXT, status TEXT, result TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY, student_id TEXT, page_id TEXT, concept_id TEXT, correct INTEGER,
  misconception_id TEXT, problem TEXT, source TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS mastery (
  student_id TEXT, concept_id TEXT, p_known REAL, n_obs INTEGER, updated REAL,
  PRIMARY KEY (student_id, concept_id)
);
CREATE TABLE IF NOT EXISTS diagnoses (
  id TEXT PRIMARY KEY, student_id TEXT, result TEXT, trace TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS probes (
  id TEXT PRIMARY KEY, student_id TEXT, diagnosis_id TEXT, concept_id TEXT, misconception_id TEXT,
  question TEXT, expected TEXT, answer TEXT, correct INTEGER, created REAL
);
CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY, student_id TEXT, passage_id TEXT, audio_path TEXT, status TEXT,
  result TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, class_id TEXT, result TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS syllabi (
  id TEXT PRIMARY KEY, class_id TEXT, concept_ids TEXT, source_text TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS homeworks (
  id TEXT PRIMARY KEY, student_id TEXT, class_id TEXT, token TEXT UNIQUE, track TEXT, plan TEXT, items TEXT,
  status TEXT, rejected INTEGER, page_id TEXT, result TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY, model TEXT, purpose TEXT, input_tokens INTEGER, output_tokens INTEGER,
  unit TEXT, units REAL, cost REAL, created REAL
);
CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY, class_id TEXT, group_key TEXT, image_path TEXT, items TEXT, created REAL
);
"""


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


_initialised = False


def connect() -> sqlite3.Connection:
    global _initialised
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    if not _initialised:
        conn.executescript(SCHEMA)
        for migration in ("ALTER TABLE attempts ADD COLUMN level INTEGER",):
            try:
                conn.execute(migration)
            except sqlite3.OperationalError:
                pass  # already applied
        _initialised = True
    return conn


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with tx() as conn:
        conn.executescript(SCHEMA)


JSON_COLUMNS = {"result", "trace", "items", "grades", "plan"}


def row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    if r is None:
        return None
    out = dict(r)
    for key in JSON_COLUMNS & out.keys():
        if isinstance(out[key], str) and out[key][:1] in "[{":
            out[key] = json.loads(out[key])
    return out


def rows(rs: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row(r) for r in rs]  # type: ignore[misc]


def insert(table: str, **values: Any) -> str:
    if table not in {"schools", "classes", "students", "mastery"}:
        values.setdefault("created", time.time())
    for key, value in values.items():
        if isinstance(value, (dict, list)):
            values[key] = json.dumps(value, ensure_ascii=False)
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    with tx() as conn:
        conn.execute(f"INSERT OR REPLACE INTO {table} ({cols}) VALUES ({marks})", list(values.values()))
    return values.get("id", "")


def update(table: str, id_: str, **values: Any) -> None:
    for key, value in values.items():
        if isinstance(value, (dict, list)):
            values[key] = json.dumps(value, ensure_ascii=False)
    sets = ", ".join(f"{k} = ?" for k in values)
    with tx() as conn:
        conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", [*values.values(), id_])


def query(sql: str, *params: Any) -> list[dict[str, Any]]:
    with tx() as conn:
        return rows(conn.execute(sql, params).fetchall())


def get(table: str, id_: str) -> dict[str, Any] | None:
    with tx() as conn:
        return row(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (id_,)).fetchone())
