"""Model access: hosted Meta Model API.

Every text/vision call goes through `json_call`, which asks for schema-constrained JSON. Every call
is priced into the usage ledger and stopped by the budget cap.
"""
from __future__ import annotations

import asyncio
import base64
import contextvars
import json
import logging
import mimetypes
from pathlib import Path
from typing import Any

from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from . import config

log = logging.getLogger("apnigati.llm")

# USD per 1M tokens (input, output), Standard mode. Children's data is only ever sent in Standard mode
# (never the *-contributor models), so it is not used to train Meta models.
TOKEN_PRICES = {config.SPARK: (1.25, 4.25), config.WONDER: (4.00, 20.00)}
UNIT_PRICES = {"image": 0.01, "sam_image": 0.0025, "sam_frame": 0.0002, "asr_hour": 0.18, "web_search": 0.0025}


class BudgetExceeded(RuntimeError):
    pass


# Per-task cost attribution: asyncio tasks copy the context, so concurrent work is not double counted.
_cost_scope: contextvars.ContextVar[list[float] | None] = contextvars.ContextVar("cost_scope", default=None)


def start_cost_scope() -> list[float]:
    acc = [0.0]
    _cost_scope.set(acc)
    return acc


def spent_usd() -> float:
    from . import db

    rows = db.query("SELECT COALESCE(SUM(cost), 0) AS total FROM usage")
    return float(rows[0]["total"]) if rows else 0.0


def guard_budget() -> None:
    if config.BUDGET_USD and spent_usd() >= config.BUDGET_USD:
        raise BudgetExceeded(f"API budget of ${config.BUDGET_USD:.2f} reached; raise APNI_GATI_BUDGET_USD to continue")


def record(model: str, purpose: str, input_tokens: int = 0, output_tokens: int = 0, unit: str | None = None, units: float = 0.0) -> float:
    from . import db

    cost = 0.0
    if model in TOKEN_PRICES:
        pin, pout = TOKEN_PRICES[model]
        cost += input_tokens * pin / 1e6 + output_tokens * pout / 1e6
    if unit:
        cost += UNIT_PRICES[unit] * units
    db.insert("usage", id=db.new_id("us"), model=model, purpose=purpose, input_tokens=input_tokens, output_tokens=output_tokens, unit=unit, units=units, cost=round(cost, 6))
    scope = _cost_scope.get()
    if scope is not None:
        scope[0] += cost
    return cost



meta = AsyncOpenAI(base_url=config.META_BASE_URL, api_key=config.MODEL_API_KEY or "missing", timeout=180, max_retries=2)


def data_url(path: str | Path, mime: str | None = None) -> str:
    path = Path(path)
    mime = mime or mimetypes.guess_type(path.name)[0] or "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def user_content(text: str, images: list[str] | None = None) -> list[dict[str, Any]]:
    """Chat Completions content parts: the prompt followed by images (data URLs)."""
    parts: list[dict[str, Any]] = [{"type": "text", "text": text}]
    for url in images or []:
        parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


async def json_call(
    *,
    system: str,
    user: str,
    schema: dict[str, Any],
    name: str,
    images: list[str] | None = None,
    model: str = config.SPARK,
    effort: str = "low",
    retries: int = 3,
) -> dict[str, Any]:
    """Schema-constrained JSON from Muse Spark / Wonder."""
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content(user, images)},
    ]
    response_format = {"type": "json_schema", "json_schema": {"name": name, "schema": schema}}
    guard_budget()

    last: Exception | None = None
    for attempt in range(retries):
        try:
            resp = await meta.chat.completions.create(
                model=model, messages=messages, response_format=response_format, reasoning_effort=effort
            )
            if resp.usage:
                record(model, name, resp.usage.prompt_tokens, resp.usage.completion_tokens)
            content = resp.choices[0].message.content or ""
            return json.loads(content)
        except (json.JSONDecodeError, APIConnectionError) as exc:
            last = exc
        except APIStatusError as exc:
            if exc.status_code < 500 and exc.status_code != 429:
                raise
            last = exc
        await asyncio.sleep(1.5 * (2**attempt))
    raise RuntimeError(f"{name}: model call failed after {retries} attempts: {last}")


async def responses_text(purpose: str = "responses", **kwargs: Any) -> Any:
    """Raw Responses API call (agent loops, web search, image generation), with cost tracking."""
    guard_budget()
    resp = await meta.responses.create(**kwargs)
    model = kwargs.get("model", "")
    usage = getattr(resp, "usage", None)
    record(model, purpose, getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0)
    images = sum(1 for o in resp.output if o.type == "image_generation_call")
    searches = sum(1 for o in resp.output if o.type == "web_search_call")
    if images:
        record(model, purpose, unit="image", units=images)
    if searches:
        record(model, purpose, unit="web_search", units=searches)
    return resp
