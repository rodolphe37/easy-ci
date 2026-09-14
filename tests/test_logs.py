from easy_ci.logs import parse_ansi, parse_log, strip_ansi

SAMPLE = "\n".join(
    [
        "﻿2025-09-14T10:00:00.1234567Z ##[group]Run go test ./...",
        "2025-09-14T10:00:00.2000000Z go test ./...",
        "2025-09-14T10:00:00.3000000Z ##[endgroup]",
        "2025-09-14T10:00:01.0000000Z ok  \tpkg/api\t2.1s",
        "2025-09-14T10:00:02.0000000Z \x1b[31m--- FAIL: TestLedger (0.03s)\x1b[0m",
        "2025-09-14T10:00:02.1000000Z FAIL",
        "2025-09-14T10:00:02.2000000Z ##[error]Process completed with exit code 1.",
        "2025-09-14T10:00:03.0000000Z ##[warning]Node 16 is deprecated",
    ]
)


def test_parse_ansi_colors_and_reset():
    segments = parse_ansi("a\x1b[1;31mb\x1b[0mc\x1b[38;5;208md")
    assert segments == [
        {"t": "a"},
        {"t": "b", "b": True, "fg": "red"},
        {"t": "c"},
        {"t": "d", "fg": "#ff8700"},
    ]


def test_parse_ansi_truecolor_and_merge():
    assert parse_ansi("\x1b[38;2;10;20;30mab\x1b[38;2;10;20;30mcd") == [{"t": "abcd", "fg": "#0a141e"}]


def test_strip_ansi_removes_cursor_sequences():
    assert strip_ansi("\x1b[2K\x1b[1Gdone \x1b[32m✓\x1b[0m") == "done ✓"


def test_parse_log_structure():
    parsed = parse_log(SAMPLE)
    lines = parsed["lines"]

    assert len(lines) == 7  # la ligne ##[endgroup] n'est pas affichée
    assert lines[0]["kind"] == "group" and lines[0]["header"] == 0
    assert lines[0]["ts"] == "2025-09-14T10:00:00.1234567Z"
    assert lines[1]["group"] == 0
    assert "group" not in lines[2]
    assert parsed["groups"] == [
        {"id": 0, "title": "Run go test ./...", "line": 0, "end": 1, "has_error": False, "has_warning": False, "collapsed": True}
    ]
    assert parsed["errors"] == [5]
    assert parsed["warnings"] == [6]
    assert lines[3].get("hint") is True
    assert lines[5]["segments"] == [{"t": "Process completed with exit code 1."}]


def test_error_excerpt_starts_at_first_suspicious_line():
    excerpt = parse_log(SAMPLE)["excerpts"][0]
    assert excerpt["line"] == 5
    assert excerpt["message"] == "Process completed with exit code 1."
    assert excerpt["start"] == 2  # « ok » + « --- FAIL » précèdent l'erreur
    assert excerpt["end"] == 5


def test_truncation_keeps_the_end():
    text = "\n".join(f"line {i}" for i in range(100))
    parsed = parse_log(text, max_lines=10)
    assert parsed["truncated"] is True
    assert parsed["lines"][0]["segments"][0]["t"] == "line 90"


GITLAB_SAMPLE = (
    "\x1b[0KRunning with gitlab-runner 17.4.0\x1b[0;m\n"
    "\x1b[0Ksection_start:1726300000:prepare_executor\r\x1b[0K\x1b[36;1mPreparing the \"docker\" executor\x1b[0;m\n"
    "Using docker image node:22\n"
    "\x1b[0Ksection_end:1726300005:prepare_executor\r\x1b[0K\x1b[0Ksection_start:1726300005:step_script[collapsed=false]\r\x1b[0K\x1b[36;1mExecuting \"step_script\" stage\x1b[0;m\n"
    "\x1b[32;1m$ npm test\x1b[0;m\n"
    "Downloading 10%\rDownloading 100%\n"
    "  ✕ computes VAT (12 ms)\n"
    "\x1b[0Ksection_end:1726300040:step_script\r\x1b[0K\n"
    "\x1b[31;1mERROR: Job failed: exit code 1\n\x1b[0;m"
)


def test_gitlab_sections_become_open_groups():
    parsed = parse_log(GITLAB_SAMPLE, collapse_groups=False)
    titles = [(g["title"], g["collapsed"]) for g in parsed["groups"]]
    assert titles == [('Preparing the "docker" executor', False), ('Executing "step_script" stage', False)]

    texts = ["".join(s["t"] for s in line["segments"]) for line in parsed["lines"]]
    assert "Downloading 100%" in texts  # la progression intermédiaire est écrasée
    assert not any("section_" in text for text in texts)

    error_index = parsed["errors"][0]
    assert texts[error_index] == "ERROR: Job failed: exit code 1"
    excerpt = parsed["excerpts"][0]
    assert excerpt["line"] == error_index


def test_gitlab_collapsed_section_option():
    text = "\x1b[0Ksection_start:1:install[collapsed=true]\r\x1b[0KInstall deps\nnpm ci\n\x1b[0Ksection_end:2:install\r\x1b[0K\ndone"
    parsed = parse_log(text, collapse_groups=False)
    assert parsed["groups"][0]["collapsed"] is True
    assert parsed["lines"][1]["group"] == 0 and "group" not in parsed["lines"][2]


def test_failed_log_without_error_marker_gets_tail_excerpt():
    text = "\n".join(["+ npm ci", "added 10 packages", "+ npm test", "FAIL src/a.test.ts", "  expected 1 to be 2", ""])
    parsed = parse_log(text, failed=True, collapse_groups=False)
    assert parsed["errors"] == []
    excerpt = parsed["excerpts"][0]
    assert excerpt["inferred"] is True
    assert excerpt["end"] == 4 and excerpt["start"] <= 3
    assert parse_log(text)["excerpts"] == []  # sans échec, pas d'extrait inventé
