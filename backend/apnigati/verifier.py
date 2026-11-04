"""Deterministic arithmetic checks. The model reads; sympy decides what is mathematically true.

A step claim is a short relation the child wrote or implied, e.g. "52 - 28 = 24", "1307 ÷ 15 = 87 R 2",
"3/4 + 1/8 = 7/8", "0.5 > 0.25". We never mark a child wrong on the model's say-so alone.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import sympy
from sympy.parsing.sympy_parser import parse_expr

_REL = re.compile(r"(<=|>=|=|<|>)")
_REMAINDER = re.compile(r"^\s*(-?\d+)\s*(?:r|R|rem|remainder|शेष)\.?\s*(\d+)\s*$")


@dataclass
class Check:
    status: str  # "true" | "false" | "unparseable"
    claim: str
    expected: str | None = None
    detail: str = ""

    def as_dict(self) -> dict:
        return {"status": self.status, "claim": self.claim, "expected": self.expected, "detail": self.detail}


def _normalise_number_commas(text: str) -> str:
    # "1,307" and Indian "12,34,567" are digit grouping; any other "87,13" is a decimal comma.
    grouped = re.compile(r"(?<![\d.,])\d{1,3}(?:(?:,\d{3})+|(?:,\d{2})+,\d{3})(?![\d,])")
    text = grouped.sub(lambda m: m.group(0).replace(",", ""), text)
    return re.sub(r"(?<=\d),(?=\d)", ".", text)


def normalise(expr: str) -> str:
    s = expr.strip()
    s = s.replace("×", "*").replace("x", "*").replace("X", "*").replace("·", "*")
    s = s.replace("÷", "/").replace("−", "-").replace("–", "-").replace("—", "-")
    s = re.sub(r"(?<=\d)\s*:\s*(?=\d)", "/", s)  # 1307 : 15 (European division)
    s = s.replace("̅", "")  # combining overline used for recurring decimals
    s = _normalise_number_commas(s)
    s = re.sub(r"(\d)\s+(\d+/\d+)", r"(\1+\2)", s)  # mixed numbers "2 1/4"
    return s


def evaluate(expr: str) -> sympy.Expr:
    return sympy.nsimplify(parse_expr(normalise(expr), evaluate=True), rational=True)


def _decimals(text: str) -> int:
    m = re.search(r"\.(\d+)", normalise(text))
    return len(m.group(1)) if m else 0


def _equal(lhs: sympy.Expr, rhs_text: str, rhs: sympy.Expr) -> bool:
    if sympy.simplify(lhs - rhs) == 0:
        return True
    # A child writing 87.13 for 87.1333… (recurring or truncated) is correct to the shown precision.
    places = _decimals(rhs_text)
    if places:
        return abs(float(lhs) - float(rhs)) < 10 ** (-places)
    return False


def _fmt(value: sympy.Expr) -> str:
    if value.is_Integer:
        return str(int(value))
    if value.is_Rational:
        return f"{value.p}/{value.q} ({float(value):.4g})"
    return f"{float(value):.6g}"


def check_claim(claim: str) -> Check:
    parts = _REL.split(claim, maxsplit=1)
    if len(parts) != 3:
        return Check("unparseable", claim, detail="no relation")
    left, op, right = (p.strip() for p in parts)
    try:
        rem = _REMAINDER.match(right)
        if op == "=" and rem and "/" in normalise(left):
            num_text, den_text = normalise(left).split("/", 1)
            num, den = int(evaluate(num_text)), int(evaluate(den_text))
            q, r = divmod(num, den)
            ok = (int(rem.group(1)), int(rem.group(2))) == (q, r)
            return Check("true" if ok else "false", claim, f"{q} R {r}")
        lhs = evaluate(left)
        rhs = evaluate(right)
    except Exception as exc:  # noqa: BLE001 - any parse failure means "can't verify"
        return Check("unparseable", claim, detail=type(exc).__name__)
    if not (lhs.is_number and rhs.is_number):
        return Check("unparseable", claim, detail="non-numeric")

    if op == "=":
        ok = _equal(lhs, right, rhs)
    else:
        ok = bool({"<": lhs < rhs, ">": lhs > rhs, "<=": lhs <= rhs, ">=": lhs >= rhs}[op])
    expected = _fmt(lhs) if op == "=" else ("true" if ok else f"{_fmt(lhs)} vs {_fmt(rhs)}")
    return Check("true" if ok else "false", claim, expected)


def solve(problem_expr: str) -> str | None:
    """Correct answer for a problem expression, e.g. '503 - 278' -> '225', '1307 / 15' -> '87 R 2'."""
    try:
        norm = normalise(problem_expr)
        if _REL.search(norm):  # comparison problems like "0.5 ? 0.25" are handled as claims
            return None
        value = evaluate(problem_expr)
        if "/" in norm and re.fullmatch(r"\s*\d+\s*/\s*\d+\s*", norm) and not value.is_Integer:
            num, den = (int(x) for x in norm.split("/"))
            q, r = divmod(num, den)
            return f"{q} R {r} (= {_fmt(value)})"
        return _fmt(value)
    except Exception:  # noqa: BLE001
        return None
