"""HTTP API for the Apni Gati web app.  Run: uv run uvicorn apnigati.api:app --reload --port 8000"""
from __future__ import annotations

import asyncio
import logging
import shutil
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import agents, capture, concepts, config, db, grading, guardrails, homework, llm, reading, tracing, worksheets

log = logging.getLogger("apnigati.api")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Apni Gati")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
db.init()

MEDIA = config.RUNTIME_DIR / "media"
app.mount("/media", StaticFiles(directory=MEDIA), name="media")
PAGE_SLOTS = asyncio.Semaphore(3)
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".3gp"}


def media_url(path: str | None) -> str | None:
    if not path:
        return None
    return "/media/" + str(Path(path).resolve().relative_to(MEDIA.resolve()))


def _save(upload: UploadFile, dst: Path) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with dst.open("wb") as fh:
        shutil.copyfileobj(upload.file, fh)
    return dst


@app.on_event("startup")
async def resume_interrupted_work() -> None:
    """A restart mid-grading must not leave pages stuck: re-queue anything unfinished."""
    for p in db.query("SELECT id FROM pages WHERE status IN ('queued', 'grading')"):
        asyncio.create_task(_grade(p["id"]))
    for r in db.query("SELECT id FROM readings WHERE status IN ('queued', 'processing')"):
        asyncio.create_task(_run_reading(r["id"]))


# ---------------------------------------------------------------- status


@app.get("/api/status")
def status() -> dict[str, Any]:
    return {
        "models": {"read_grade": config.SPARK, "agents": config.WONDER, "segmentation": config.SAM, "speech": config.ASR, "worksheets": config.IMAGE},
        "graph": {k: v for k, v in concepts.graph().get("meta", {}).items() if k != "research_notes"},
    }


# ---------------------------------------------------------------- graph, classes, students


@app.get("/api/graph")
def graph() -> dict[str, Any]:
    return concepts.public_graph()


@app.get("/api/classes")
def list_classes() -> list[dict[str, Any]]:
    return db.query(
        """SELECT c.*, s.name AS school_name, s.district, s.simulated,
                  (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id) AS n_students
           FROM classes c JOIN schools s ON s.id = c.school_id ORDER BY s.simulated, s.name"""
    )


def _student_summary(s: dict[str, Any]) -> dict[str, Any]:
    m = tracing.mastery(s["id"])
    f = tracing.frontier(s["id"])
    last_diag = db.query("SELECT result FROM diagnoses WHERE student_id = ? ORDER BY created DESC LIMIT 1", s["id"])
    stats = db.query("SELECT COUNT(*) AS n, SUM(correct) AS ok FROM attempts WHERE student_id = ?", s["id"])[0]
    return {
        **s,
        "frontier": concepts.nodes()[f]["name"] if f in concepts.nodes() else None,
        "frontier_id": f,
        "frontier_grade": concepts.nodes()[f]["grade"] if f in concepts.nodes() else None,
        "attempts": stats["n"],
        "correct": stats["ok"] or 0,
        "concepts_mastered": sum(1 for v in m.values() if v["p"] >= tracing.MASTERED),
        "root_cause": (last_diag[0]["result"].get("root_concept") or {}).get("name") if last_diag else None,
        "progress": {k: v for k, v in homework.progress(s["id"], s["class_id"]).items() if k != "concepts"},
        "homework": _latest_homework(s["id"]),
    }


def _latest_homework(student_id: str) -> dict[str, Any] | None:
    rows = db.query("SELECT id, token, track, status, result, created FROM homeworks WHERE student_id = ? ORDER BY created DESC LIMIT 1", student_id)
    if not rows:
        return None
    h = rows[0]
    return {**h, "track_label": homework.TRACKS[h["track"]]["label"]}


@app.get("/api/classes/{class_id}")
def get_class(class_id: str) -> dict[str, Any]:
    klass = db.get("classes", class_id)
    if not klass:
        raise HTTPException(404)
    students = db.query("SELECT * FROM students WHERE class_id = ? ORDER BY name", class_id)
    return {**klass, "school": db.get("schools", klass["school_id"]), "students": [_student_summary(s) for s in students]}


class StudentBody(BaseModel):
    name: str
    grade: int
    language: str = "Hindi"


@app.post("/api/classes/{class_id}/students")
def add_student(class_id: str, body: StudentBody) -> dict[str, Any]:
    sid = db.insert("students", id=db.new_id("st"), class_id=class_id, name=body.name, grade=body.grade, language=body.language)
    return db.get("students", sid)  # type: ignore[return-value]


class BulkStudents(BaseModel):
    students: list[StudentBody]


@app.post("/api/classes/{class_id}/students/bulk")
def add_students(class_id: str, body: BulkStudents) -> list[dict[str, Any]]:
    return [add_student(class_id, s) for s in body.students if s.name.strip()]


class SyllabusBody(BaseModel):
    concept_ids: list[str] = []
    text: str = ""


def _syllabus_out(class_id: str) -> dict[str, Any]:
    ids = homework.syllabus(class_id)
    return {"concept_ids": ids, "concepts": [{k: concepts.nodes()[c][k] for k in ("id", "name", "grade", "strand", "ncert_ref")} for c in ids]}


@app.get("/api/classes/{class_id}/syllabus")
def get_syllabus(class_id: str) -> dict[str, Any]:
    return _syllabus_out(class_id)


@app.put("/api/classes/{class_id}/syllabus")
async def set_syllabus(class_id: str, body: SyllabusBody) -> dict[str, Any]:
    """Teacher picks concepts, or pastes the syllabus text and Muse Wonder maps it onto the concept graph."""
    unmatched: list[str] = []
    ids = [c for c in body.concept_ids if c in concepts.nodes()]
    if body.text.strip():
        mapped = await homework.map_syllabus_text(body.text)
        ids = list(dict.fromkeys(ids + mapped["concept_ids"]))
        unmatched = mapped["unmatched"]
    if not ids:
        raise HTTPException(400, "No syllabus topics recognised")
    ids = [c for c in concepts.topo_order() if c in ids]
    db.insert("syllabi", id=db.new_id("sy"), class_id=class_id, concept_ids=ids, source_text=body.text)
    return {**_syllabus_out(class_id), "unmatched": unmatched}


@app.post("/api/classes/{class_id}/homework")
async def generate_homework(class_id: str) -> list[dict[str, Any]]:
    """One tap: a different homework sheet for every child, from their own knowledge graph."""
    if not homework.syllabus(class_id):
        raise HTTPException(400, "Set the class syllabus first")
    return await homework.make_class_homework(class_id)


@app.get("/api/classes/{class_id}/homework")
def class_homework(class_id: str) -> list[dict[str, Any]]:
    out = []
    for s in db.query("SELECT * FROM students WHERE class_id = ? ORDER BY name", class_id):
        rows = db.query("SELECT * FROM homeworks WHERE student_id = ? ORDER BY created DESC LIMIT 1", s["id"])
        h = rows[0] if rows else None
        out.append({
            "student": {"id": s["id"], "name": s["name"], "grade": s["grade"], "language": s["language"]},
            "progress": {k: v for k, v in homework.progress(s["id"], class_id).items() if k != "concepts"},
            "homework": {**h, "track_label": homework.TRACKS[h["track"]]["label"]} if h else None,
        })
    return out


@app.get("/api/students/{student_id}/homework")
def student_homework(student_id: str) -> list[dict[str, Any]]:
    return [{**h, "track_label": homework.TRACKS[h["track"]]["label"]} for h in db.query("SELECT * FROM homeworks WHERE student_id = ? ORDER BY created DESC", student_id)]


def _hw_by_token(token: str) -> dict[str, Any]:
    rows = db.query("SELECT * FROM homeworks WHERE token = ?", token)
    if not rows:
        raise HTTPException(404, "Homework not found")
    return rows[0]


@app.get("/api/hw/{token}")
def child_homework(token: str) -> dict[str, Any]:
    """The child's own page (opened from a link on the family phone). First name only; no class data."""
    h = _hw_by_token(token)
    s = db.get("students", h["student_id"]) or {}
    page = db.get("pages", h["page_id"]) if h["page_id"] else None
    pending = db.query("SELECT id, status FROM pages WHERE source LIKE ? ORDER BY created DESC LIMIT 1", f"homework:{h['id']}%")
    return {
        "token": token,
        "first_name": (s.get("name") or "").split(" ")[0],
        "language": s.get("language"),
        "track_label": homework.TRACKS[h["track"]]["label"],
        "status": h["status"] if not pending or pending[0]["status"] == "done" else ("error" if pending[0]["status"] == "error" else "grading"),
        "items": [{k: it[k] for k in ("n", "question", "question_en")} for it in h["items"]],
        "result": h["result"],
        "page": _page_out(page) if page else None,
    }


@app.post("/api/hw/{token}/submit")
async def submit_homework(token: str, files: list[UploadFile] = File(...)) -> dict[str, Any]:
    h = _hw_by_token(token)
    batch_dir = MEDIA / h["class_id"] / "homework" / h["id"]
    saved = [_save(f, batch_dir / "raw" / Path(f.filename or "photo.jpg").name) for f in files[:4]]
    try:
        for path in saved:
            guardrails.check_upload(path, "image")
    except guardrails.UploadRejected as exc:
        for path in saved:
            path.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from None

    async def ingest() -> None:
        try:
            for n, src in enumerate(saved):
                dst = batch_dir / f"page_{n + 1}.jpg"
                info = await capture.page_from_photo(src, dst)
                pid = db.insert("pages", id=db.new_id("pg"), class_id=h["class_id"], student_id=h["student_id"], source=f"homework:{h['id']}#{n + 1}", image_path=str(dst), status="queued", result={"capture": info})
                await _grade(pid)
        finally:
            for src in saved:
                src.unlink(missing_ok=True)

    db.update("homeworks", h["id"], status="submitted")
    asyncio.create_task(ingest())
    return {"status": "submitted"}


@app.get("/api/students/{student_id}")
def get_student(student_id: str) -> dict[str, Any]:
    s = db.get("students", student_id)
    if not s:
        raise HTTPException(404)
    m = tracing.mastery(student_id)
    return {
        **_student_summary(s),
        "mastery": [
            {"concept_id": cid, "name": concepts.nodes()[cid]["name"], "grade": concepts.nodes()[cid]["grade"], "p": round(v["p"], 3), "n": v["n"]}
            for cid, v in m.items() if cid in concepts.nodes()
        ],
        "attempts": db.query("SELECT * FROM attempts WHERE student_id = ? ORDER BY created DESC LIMIT 60", student_id),
        "diagnoses": db.query("SELECT * FROM diagnoses WHERE student_id = ? ORDER BY created DESC LIMIT 5", student_id),
        "probes": db.query("SELECT * FROM probes WHERE student_id = ? ORDER BY created DESC LIMIT 12", student_id),
        "readings": [{**r, "audio_url": media_url(r["audio_path"])} for r in db.query("SELECT * FROM readings WHERE student_id = ? ORDER BY created DESC", student_id)],
        "pages": [_page_out(p) for p in db.query("SELECT * FROM pages WHERE student_id = ? ORDER BY created DESC", student_id)],
        "syllabus_progress": homework.progress(student_id, s["class_id"]),
        "homeworks": student_homework(student_id),
    }


# ---------------------------------------------------------------- capture + grading


def _check_audio(path: Path) -> None:
    try:
        guardrails.check_upload(path, "audio")
    except guardrails.UploadRejected as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from None


def _page_out(p: dict[str, Any]) -> dict[str, Any]:
    return {**p, "image_url": media_url(p["image_path"]), "overlay_url": media_url(p["overlay_path"])}


def _match_student(class_id: str, name: str) -> str | None:
    if not name.strip():
        return None
    best, best_score = None, 0.0
    for s in db.query("SELECT id, name FROM students WHERE class_id = ?", class_id):
        score = SequenceMatcher(a=name.lower().strip(), b=s["name"].lower()).ratio()
        if s["name"].lower().split()[0] in name.lower():
            score = max(score, 0.85)
        if score > best_score:
            best, best_score = s["id"], score
    return best if best_score >= 0.7 else None


def _record_attempts(page_id: str, student_id: str, result: dict[str, Any]) -> None:
    db.query("DELETE FROM attempts WHERE page_id = ?", page_id)
    for p in result["problems"]:
        if p["status"] == "needs_review" or not p.get("concept_id"):
            continue
        mis = (p.get("diagnosis") or {}).get("misconception_id")
        mis = mis if mis in concepts.misconceptions() else None
        db.insert("attempts", id=db.new_id("at"), student_id=student_id, page_id=page_id, concept_id=p["concept_id"], correct=int(p["status"] == "correct"), misconception_id=mis, problem=f"{p['problem_text']} → {p['answer_text']}", source="homework" if p.get("homework_item") else "page", level=p.get("level"))
    tracing.rebuild(student_id)


async def _grade(page_id: str) -> None:
    async with PAGE_SLOTS:
        page = db.get("pages", page_id)
        assert page
        img = Path(page["image_path"])
        overlay = img.with_name(img.stem + "_redpen.jpg")
        db.update("pages", page_id, status="grading")
        try:
            result = await grading.grade_page(img, overlay)
        except Exception as exc:  # noqa: BLE001
            log.exception("grading failed")
            db.update("pages", page_id, status="error", result={"error": str(exc)})
            return
        result["capture"] = (page.get("result") or {}).get("capture")
        student_id = page["student_id"] or _match_student(page["class_id"], result.get("student_name", ""))
        hw_id = page["source"].split(":", 1)[1].split("#")[0] if page["source"].startswith("homework:") else None
        hw = db.get("homeworks", hw_id) if hw_id else None
        if hw:
            key = homework.apply_answer_key(hw, result)
            result["homework"] = {"id": hw["id"], **key}
            items = key["items"]
            db.update("homeworks", hw["id"], status="graded", page_id=page_id, result={
                "correct": sum(i["status"] == "correct" for i in items),
                "attempted": sum(i["status"] not in ("not_attempted",) for i in items),
                "total": len(items),
            })
        db.update("pages", page_id, status="done", result=result, overlay_path=str(overlay), student_id=student_id)
        if student_id:
            _record_attempts(page_id, student_id, result)


async def _ingest(class_id: str, student_id: str | None, saved: list[Path], batch_dir: Path) -> None:
    try:
        await _ingest_files(class_id, student_id, saved, batch_dir)
    finally:
        # Privacy: originals may contain faces or other children; only processed, face-blurred pages are kept.
        for src in saved:
            src.unlink(missing_ok=True)


async def _ingest_files(class_id: str, student_id: str | None, saved: list[Path], batch_dir: Path) -> None:
    for src in saved:
        if src.suffix.lower() in VIDEO_EXT:
            pages = await capture.pages_from_video(src, batch_dir / src.stem)
            for info in pages:
                pid = db.insert("pages", id=db.new_id("pg"), class_id=class_id, student_id=student_id, source=f"video:{src.name}@{info['time_s']}s", image_path=info["path"], status="queued", result={"capture": info})
                asyncio.create_task(_grade(pid))
        else:
            dst = batch_dir / f"{src.stem}_page.jpg"
            info = await capture.page_from_photo(src, dst)
            pid = db.insert("pages", id=db.new_id("pg"), class_id=class_id, student_id=student_id, source=f"photo:{src.name}", image_path=str(dst), status="queued", result={"capture": info})
            asyncio.create_task(_grade(pid))


@app.post("/api/classes/{class_id}/capture")
async def capture_pages(class_id: str, files: list[UploadFile] = File(...), student_id: str | None = Form(None)) -> dict[str, Any]:
    batch = db.new_id("batch")
    batch_dir = MEDIA / class_id / batch
    saved = [_save(f, batch_dir / "raw" / Path(f.filename or "upload.jpg").name) for f in files]
    try:
        for path in saved:
            guardrails.check_upload(path, "video" if path.suffix.lower() in VIDEO_EXT else "image")
    except guardrails.UploadRejected as exc:
        for path in saved:
            path.unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from None
    asyncio.create_task(_ingest(class_id, student_id or None, saved, batch_dir))
    return {"batch": batch, "files": len(saved)}


@app.get("/api/classes/{class_id}/pages")
def class_pages(class_id: str) -> list[dict[str, Any]]:
    return [_page_out(p) for p in db.query("SELECT * FROM pages WHERE class_id = ? ORDER BY created DESC LIMIT 100", class_id)]


@app.get("/api/pages/{page_id}")
def get_page(page_id: str) -> dict[str, Any]:
    p = db.get("pages", page_id)
    if not p:
        raise HTTPException(404)
    return _page_out(p)


class AssignBody(BaseModel):
    student_id: str


@app.post("/api/pages/{page_id}/assign")
def assign_page(page_id: str, body: AssignBody) -> dict[str, Any]:
    p = db.get("pages", page_id)
    if not p:
        raise HTTPException(404)
    db.update("pages", page_id, student_id=body.student_id)
    if p["status"] == "done":
        _record_attempts(page_id, body.student_id, p["result"])
    return _page_out(db.get("pages", page_id))  # type: ignore[arg-type]


@app.post("/api/pages/{page_id}/problems/{index}/explain")
async def explain(page_id: str, index: int, audio: UploadFile = File(...), language: str = Form("")) -> dict[str, Any]:
    """The child explains their working aloud; the diagnosis is revisited with that explanation."""
    p = db.get("pages", page_id)
    if not p or p["status"] != "done":
        raise HTTPException(404)
    clip = _save(audio, MEDIA / p["class_id"] / "explain" / f"{page_id}_{index}_{audio.filename or 'clip.webm'}")
    _check_audio(clip)
    transcript = await reading.transcribe_any(clip, language or None)
    problem = p["result"]["problems"][index]
    revised = await grading.rediagnose_with_explanation(problem, transcript)
    problem["explanation"] = {"transcript": transcript, "audio_url": media_url(str(clip)), "before": (problem.get("diagnosis") or {}).get("misconception_id")}
    problem["diagnosis"] = revised
    problem["trace"].append(f"child explained: “{transcript[:120]}” → {revised['misconception_id']}")
    db.update("pages", page_id, result=p["result"])
    if p["student_id"]:
        _record_attempts(page_id, p["student_id"], p["result"])
    return problem


class OverrideBody(BaseModel):
    status: str  # correct | wrong
    note: str = ""


@app.post("/api/pages/{page_id}/problems/{index}/override")
def override(page_id: str, index: int, body: OverrideBody) -> dict[str, Any]:
    """The teacher has the final say on every mark. Overrides are kept for evaluation."""
    if body.status not in ("correct", "wrong"):
        raise HTTPException(400, "status must be correct or wrong")
    p = db.get("pages", page_id)
    if not p or p["status"] != "done":
        raise HTTPException(404)
    problem = p["result"]["problems"][index]
    problem["teacher_override"] = {"from": problem["status"], "to": body.status, "note": body.note}
    problem["status"] = body.status
    problem["trace"].append(f"teacher override: {problem['teacher_override']['from']} → {body.status}")
    p["result"]["score"]["correct"] = sum(q["status"] == "correct" for q in p["result"]["problems"])
    db.update("pages", page_id, result=p["result"])
    if p["student_id"]:
        _record_attempts(page_id, p["student_id"], p["result"])
    return problem


@app.delete("/api/students/{student_id}")
def delete_student(student_id: str) -> dict[str, Any]:
    """Erase a child completely: records, page images, overlays, audio."""
    files = [r["image_path"] for r in db.query("SELECT image_path FROM pages WHERE student_id = ?", student_id)]
    files += [r["overlay_path"] for r in db.query("SELECT overlay_path FROM pages WHERE student_id = ?", student_id)]
    files += [r["audio_path"] for r in db.query("SELECT audio_path FROM readings WHERE student_id = ?", student_id)]
    for f in files:
        if f:
            Path(f).unlink(missing_ok=True)
    for table in ("attempts", "mastery", "diagnoses", "probes", "readings", "pages", "homeworks"):
        db.query(f"DELETE FROM {table} WHERE student_id = ?", student_id)
    db.query("DELETE FROM students WHERE id = ?", student_id)
    return {"deleted": student_id, "files_removed": len([f for f in files if f])}


@app.get("/api/usage")
def usage() -> dict[str, Any]:
    by = db.query("SELECT model, purpose, COUNT(*) AS calls, SUM(cost) AS cost FROM usage GROUP BY model, purpose ORDER BY cost DESC")
    return {"spent_usd": round(llm.spent_usd(), 4), "budget_usd": config.BUDGET_USD, "breakdown": by}


# ---------------------------------------------------------------- agents


@app.post("/api/students/{student_id}/diagnose")
async def diagnose(student_id: str) -> dict[str, Any]:
    return await agents.diagnose_student(student_id)


class ProbeAnswer(BaseModel):
    answer: str


@app.post("/api/probes/{probe_id}/answer")
def answer_probe(probe_id: str, body: ProbeAnswer) -> dict[str, Any]:
    try:
        return agents.answer_probe(probe_id, body.answer)
    except KeyError:
        raise HTTPException(404) from None


@app.post("/api/classes/{class_id}/plan")
async def plan(class_id: str) -> dict[str, Any]:
    return await agents.plan_class(class_id)


@app.get("/api/classes/{class_id}/plan")
def latest_plan(class_id: str) -> dict[str, Any] | None:
    rows = db.query("SELECT * FROM plans WHERE class_id = ? ORDER BY created DESC LIMIT 1", class_id)
    if not rows:
        return None
    sheets = db.query("SELECT * FROM worksheets WHERE class_id = ? ORDER BY created DESC", class_id)
    by_group: dict[str, dict[str, Any]] = {}
    for w in sheets:
        by_group.setdefault(w["group_key"], {**w, "image_url": media_url(w["image_path"])})
    return {"id": rows[0]["id"], "created": rows[0]["created"], **rows[0]["result"], "worksheets": by_group}


class WorksheetBody(BaseModel):
    group_key: str


@app.post("/api/classes/{class_id}/worksheets")
async def worksheet(class_id: str, body: WorksheetBody) -> dict[str, Any]:
    p = latest_plan(class_id)
    group = next((g for g in (p or {}).get("groups", []) if g["key"] == body.group_key), None)
    if not group:
        raise HTTPException(404, "Plan the class first")
    klass = db.get("classes", class_id) or {}
    out = MEDIA / class_id / "worksheets" / f"{body.group_key}_{db.new_id('ws')}.webp"
    out.parent.mkdir(parents=True, exist_ok=True)
    res = await worksheets.make_worksheet(group["title"], group["practice"], klass.get("language", "Hindi"), out)
    db.insert("worksheets", id=db.new_id("ws"), class_id=class_id, group_key=body.group_key, image_path=str(out), items=res)
    return {**res, "image_url": media_url(str(out))}


# ---------------------------------------------------------------- reading


@app.get("/api/passages")
def list_passages() -> list[dict[str, Any]]:
    return list(reading.passages().values())


async def _run_reading(reading_id: str) -> None:
    r = db.get("readings", reading_id)
    assert r
    db.update("readings", reading_id, status="processing")
    try:
        result = await reading.assess(Path(r["audio_path"]), r["passage_id"])
        db.update("readings", reading_id, status="done", result=result)
    except Exception as exc:  # noqa: BLE001
        log.exception("reading failed")
        db.update("readings", reading_id, status="error", result={"error": str(exc)})


@app.post("/api/students/{student_id}/reading")
async def record_reading(student_id: str, background: BackgroundTasks, audio: UploadFile = File(...), passage_id: str = Form(...)) -> dict[str, Any]:
    if passage_id not in reading.passages():
        raise HTTPException(400, "unknown passage")
    rid = db.new_id("rd")
    path = _save(audio, MEDIA / "readings" / f"{rid}_{audio.filename or 'reading.webm'}")
    _check_audio(path)
    db.insert("readings", id=rid, student_id=student_id, passage_id=passage_id, audio_path=str(path), status="queued")
    background.add_task(_run_reading, rid)
    return {"id": rid, "status": "queued"}


@app.get("/api/readings/{reading_id}")
def get_reading(reading_id: str) -> dict[str, Any]:
    r = db.get("readings", reading_id)
    if not r:
        raise HTTPException(404)
    return {**r, "audio_url": media_url(r["audio_path"])}


# ---------------------------------------------------------------- district view


@app.get("/api/district")
def district() -> dict[str, Any]:
    schools = db.query("SELECT * FROM schools ORDER BY simulated, name")
    out = []
    mis_totals: dict[str, int] = {}
    for sc in schools:
        students = db.query("SELECT st.id, st.grade FROM students st JOIN classes c ON c.id = st.class_id WHERE c.school_id = ?", sc["id"])
        frontier_hist: dict[str, int] = {}
        behind = 0
        for st in students:
            f = tracing.frontier(st["id"])
            if f:
                frontier_hist[f] = frontier_hist.get(f, 0) + 1
                if concepts.nodes()[f]["grade"] <= st["grade"] - 2:
                    behind += 1
        mis = db.query(
            """SELECT a.misconception_id AS id, COUNT(*) AS n FROM attempts a JOIN students st ON st.id = a.student_id
               JOIN classes c ON c.id = st.class_id WHERE c.school_id = ? AND a.misconception_id IS NOT NULL
               GROUP BY a.misconception_id ORDER BY n DESC""",
            sc["id"],
        )
        for m in mis:
            mis_totals[m["id"]] = mis_totals.get(m["id"], 0) + m["n"]
        out.append({**sc, "n_students": len(students), "two_plus_grades_behind": behind, "frontiers": frontier_hist, "misconceptions": {m["id"]: m["n"] for m in mis}})
    top = [m for m, _ in sorted(mis_totals.items(), key=lambda kv: -kv[1])[:10]]
    catalogue = concepts.misconceptions()
    return {
        "schools": out,
        "top_misconceptions": [{"id": m, "name": catalogue[m]["name"], "concept_id": catalogue[m]["concept_id"], "total": mis_totals[m]} for m in top if m in catalogue],
    }


# ---------------------------------------------------------------- web app

WEB_DIST = config.ROOT_DIR / "web" / "dist"
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        file = WEB_DIST / path
        return FileResponse(file if path and file.is_file() else WEB_DIST / "index.html")
