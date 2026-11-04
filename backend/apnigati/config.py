"""Runtime configuration. Secrets come from backend/.env (git-ignored)."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = ROOT_DIR / "data"
RUNTIME_DIR = DATA_DIR / "runtime"  # uploads, overlays, sqlite (git-ignored)
CONCEPT_GRAPH_PATH = DATA_DIR / "concepts" / "math_graph.json"
PASSAGES_PATH = DATA_DIR / "reading" / "passages.json"


def _load_dotenv() -> None:
    env = BACKEND_DIR / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

META_BASE_URL = "https://api.meta.ai/v1"
MODEL_API_KEY = os.environ.get("MODEL_API_KEY", "")

# Hosted Meta models
SPARK = "muse-spark-1.3"          # fast perception + per-problem grading
WONDER = "muse-wonder-1.0"        # long-horizon agent: root cause, lesson planning
IMAGE = "muse-image-1.0"          # worksheets
SAM = "sam-3.1"                   # page detection, video page tracking, ink masks
ASR = "muse-voice-transcribe-1.0" # reading assessment + spoken explanations

DB_PATH = RUNTIME_DIR / "apnigati.sqlite3"

# Hard stop for API spend (hackathon credits are $150). Every call is priced into the usage ledger.
BUDGET_USD = float(os.environ.get("APNI_GATI_BUDGET_USD", "120"))

RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
(RUNTIME_DIR / "media").mkdir(exist_ok=True)
