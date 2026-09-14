"""Analyse des logs de jobs GitHub Actions.

Transforme le texte brut en lignes structurées : horodatage, groupes repliables,
couleurs ANSI, erreurs et avertissements, extraits de contexte autour des erreurs.
"""

from __future__ import annotations

import re
from typing import Any

MAX_LINES = 20_000

_TIMESTAMP_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?")
_SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
_OTHER_ESCAPE_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-ln-z]|\x1b\][^\x07]*\x07")

# Lignes qui ressemblent à une erreur même sans marqueur ##[error].
_ERROR_HINT_RE = re.compile(
    r"(\berror\b|\bERR!|\bFAIL(ED)?\b|--- FAIL|Traceback \(most recent call last\)"
    r"|\bexception\b|\bpanic:|\bfatal\b|✕|✖|AssertionError|expected .+ (got|received|to be))",
    re.IGNORECASE,
)

_MARKERS = {
    "##[error]": "error",
    "##[warning]": "warning",
    "##[notice]": "notice",
    "##[debug]": "debug",
    "##[command]": "command",
    "[command]": "command",
}

_COLORS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"]
_CONTEXT_LINES = 15


def strip_ansi(text: str) -> str:
    return _OTHER_ESCAPE_RE.sub("", _SGR_RE.sub("", text))


def _color_256(index: int) -> str:
    if index < 8:
        return _COLORS[index]
    if index < 16:
        return f"bright-{_COLORS[index - 8]}"
    if index < 232:
        index -= 16
        steps = [0, 95, 135, 175, 215, 255]
        r, g, b = steps[index // 36], steps[(index // 6) % 6], steps[index % 6]
        return f"#{r:02x}{g:02x}{b:02x}"
    level = 8 + (index - 232) * 10
    return f"#{level:02x}{level:02x}{level:02x}"


def _apply_sgr(style: dict[str, Any], params: str) -> dict[str, Any]:
    style = dict(style)
    codes = [int(code) if code else 0 for code in params.split(";")] if params else [0]
    i = 0
    while i < len(codes):
        code = codes[i]
        if code == 0:
            style = {}
        elif code == 1:
            style["b"] = True
        elif code == 2:
            style["d"] = True
        elif code == 3:
            style["i"] = True
        elif code == 4:
            style["u"] = True
        elif code == 22:
            style.pop("b", None)
            style.pop("d", None)
        elif code == 23:
            style.pop("i", None)
        elif code == 24:
            style.pop("u", None)
        elif 30 <= code <= 37:
            style["fg"] = _COLORS[code - 30]
        elif 90 <= code <= 97:
            style["fg"] = f"bright-{_COLORS[code - 90]}"
        elif 40 <= code <= 47:
            style["bg"] = _COLORS[code - 40]
        elif 100 <= code <= 107:
            style["bg"] = f"bright-{_COLORS[code - 100]}"
        elif code == 39:
            style.pop("fg", None)
        elif code == 49:
            style.pop("bg", None)
        elif code in (38, 48) and i + 1 < len(codes):
            key = "fg" if code == 38 else "bg"
            if codes[i + 1] == 5 and i + 2 < len(codes):
                style[key] = _color_256(codes[i + 2])
                i += 2
            elif codes[i + 1] == 2 and i + 4 < len(codes):
                r, g, b = (max(0, min(255, c)) for c in codes[i + 2 : i + 5])
                style[key] = f"#{r:02x}{g:02x}{b:02x}"
                i += 4
        i += 1
    return style


def parse_ansi(text: str) -> list[dict[str, Any]]:
    """Découpe une ligne en segments stylés : [{"t": "texte", "fg": "red", "b": True}, ...]."""
    text = _OTHER_ESCAPE_RE.sub("", text)
    segments: list[dict[str, Any]] = []
    style: dict[str, Any] = {}
    position = 0

    def push(chunk: str) -> None:
        if not chunk:
            return
        if segments and {k: v for k, v in segments[-1].items() if k != "t"} == style:
            segments[-1]["t"] += chunk
        else:
            segments.append({"t": chunk, **style})

    for match in _SGR_RE.finditer(text):
        push(text[position : match.start()])
        style = _apply_sgr(style, match.group(1))
        position = match.end()
    push(text[position:])
    return segments or [{"t": ""}]


# GitLab : « section_start:1700000000:nom[collapsed=true]\r\x1b[0K Titre » … « section_end:1700000000:nom\r\x1b[0K »
_GITLAB_SECTION_RE = re.compile(r"(?:\x1b\[0K)?section_(start|end):\d+:([A-Za-z0-9_.-]+)(\[[^\]]*\])?\r(?:\x1b\[0K)?")
_GITLAB_TIMESTAMP_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) [0-9a-f]{2}[OE]\+? ?")


def _expand_gitlab_sections(raw_lines: list[str]) -> list[str]:
    """Traduit les sections GitLab en marqueurs de groupe communs (##[group] / ##[endgroup])."""
    result: list[str] = []
    for raw in raw_lines:
        if "section_" not in raw:
            result.append(raw)
            continue
        position = 0
        pending_start: tuple[str, bool] | None = None
        for match in _GITLAB_SECTION_RE.finditer(raw):
            chunk = raw[position : match.start()]
            if pending_start:
                name, collapsed = pending_start
                result.append(("##[group-collapsed]" if collapsed else "##[group]") + (chunk if strip_ansi(chunk).strip() else name.replace("_", " ")))
                pending_start = None
            elif strip_ansi(chunk).strip():
                result.append(chunk)
            if match.group(1) == "start":
                pending_start = (match.group(2), "collapsed=true" in (match.group(3) or ""))
            else:
                result.append("##[endgroup]")
            position = match.end()
        rest = raw[position:]
        if pending_start:
            name, collapsed = pending_start
            result.append(("##[group-collapsed]" if collapsed else "##[group]") + (rest if strip_ansi(rest).strip() else name.replace("_", " ")))
        elif strip_ansi(rest).strip():
            result.append(rest)
    return result


def parse_log(text: str, max_lines: int = MAX_LINES, *, failed: bool = False, collapse_groups: bool = True) -> dict[str, Any]:
    """Structure un log de job.

    `collapse_groups` : les groupes GitHub ne contiennent que des détails techniques et sont repliés par
    défaut ; les sections GitLab contiennent la sortie des scripts et restent ouvertes (sauf mention contraire).
    `failed` : sans marqueur d'erreur explicite, l'extrait d'erreur porte sur la fin du log.
    """
    # split("\n") et non splitlines() : le retour chariot fait partie des marqueurs GitLab et des barres de progression.
    text = text.lstrip("\ufeff").replace("\r\n", "\n")
    raw_lines = _expand_gitlab_sections(text.removesuffix("\n").split("\n")) if text else []
    truncated = len(raw_lines) > max_lines
    if truncated:
        # On garde la fin : c'est là que se trouvent les erreurs.
        raw_lines = raw_lines[-max_lines:]

    lines: list[dict[str, Any]] = []
    groups: list[dict[str, Any]] = []
    errors: list[int] = []
    warnings: list[int] = []
    current_group: dict[str, Any] | None = None

    for raw in raw_lines:
        timestamp = None
        match = _TIMESTAMP_RE.match(raw) or _GITLAB_TIMESTAMP_RE.match(raw)
        if match:
            timestamp = match.group(1)
            raw = raw[match.end() :]
        # Barres de progression : seul le dernier état après un retour chariot est visible.
        if "\r" in raw:
            raw = next((part for part in reversed(raw.split("\r")) if strip_ansi(part).strip()), "")

        if raw.startswith("##[endgroup]"):
            current_group = None
            continue

        index = len(lines)
        kind = "output"
        body = raw
        group_id = current_group["id"] if current_group else None

        if raw.startswith(("##[group]", "##[group-collapsed]")):
            explicit_collapse = raw.startswith("##[group-collapsed]")
            body = raw[len("##[group-collapsed]") :] if explicit_collapse else raw[len("##[group]") :]
            current_group = {
                "id": len(groups),
                "title": strip_ansi(body).strip(),
                "line": index,
                "end": index,
                "has_error": False,
                "has_warning": False,
                "collapsed": collapse_groups or explicit_collapse,
            }
            groups.append(current_group)
            kind = "group"
            group_id = None
        else:
            for marker, marker_kind in _MARKERS.items():
                if raw.startswith(marker):
                    kind = marker_kind
                    body = raw[len(marker) :]
                    break

        plain = strip_ansi(body)
        if kind == "output" and plain.startswith(("ERROR: ", "FATAL: ")):
            kind = "error"  # GitLab Runner : « ERROR: Job failed: exit code 1 »
        elif kind == "output" and plain.startswith("WARNING: "):
            kind = "warning"

        line: dict[str, Any] = {"kind": kind, "segments": parse_ansi(body)}
        if timestamp:
            line["ts"] = timestamp
        if kind == "group":
            line["header"] = current_group["id"]  # type: ignore[index]
        elif group_id is not None:
            line["group"] = group_id
            groups[group_id]["end"] = index
        if kind == "output" and _ERROR_HINT_RE.search(plain):
            line["hint"] = True

        if kind == "error":
            errors.append(index)
            if group_id is not None:
                groups[group_id]["has_error"] = True
        elif kind == "warning":
            warnings.append(index)
            if group_id is not None:
                groups[group_id]["has_warning"] = True

        lines.append(line)

    for group in groups:
        if group["has_error"] or group["has_warning"]:
            group["collapsed"] = False

    excerpts = _build_excerpts(lines, errors)
    if failed and not excerpts:
        excerpts = _tail_excerpt(lines)

    return {
        "lines": lines,
        "groups": groups,
        "errors": errors,
        "warnings": warnings,
        "excerpts": excerpts,
        "truncated": truncated,
        "line_count": len(lines),
    }


def _tail_excerpt(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Échec sans ligne d'erreur explicite (Bitbucket, scripts silencieux) : les dernières lignes utiles."""
    meaningful = [i for i, line in enumerate(lines) if line["kind"] != "group" and "".join(s["t"] for s in line["segments"]).strip()]
    if not meaningful:
        return []
    last = meaningful[-1]
    hints = [i for i in meaningful[-_CONTEXT_LINES:] if lines[i].get("hint")]
    start = max(0, (hints[0] - 2) if hints else last - _CONTEXT_LINES + 1)
    return [{"line": last, "message": "".join(s["t"] for s in lines[last]["segments"]).strip(), "start": start, "end": last, "inferred": True}]


def _build_excerpts(lines: list[dict[str, Any]], errors: list[int]) -> list[dict[str, Any]]:
    """Pour chaque erreur, isole les lignes qui l'expliquent (sortie du test, stack trace…)."""
    excerpts = []
    for error_index in errors[:10]:
        group = lines[error_index].get("group")
        start = error_index
        # Remonte dans le même groupe tant qu'on reste dans la fenêtre de contexte.
        while (
            start > 0
            and error_index - (start - 1) <= _CONTEXT_LINES
            and lines[start - 1]["kind"] not in ("group", "error")
            and lines[start - 1].get("group") == group
        ):
            start -= 1
        # Si des lignes « suspectes » existent, on démarre l'extrait à la première.
        hints = [i for i in range(start, error_index) if lines[i].get("hint")]
        if hints:
            start = max(start, hints[0] - 2)
        excerpts.append(
            {
                "line": error_index,
                "message": "".join(s["t"] for s in lines[error_index]["segments"]).strip(),
                "start": start,
                "end": error_index,
            }
        )
    return excerpts
