import importlib.util
import json
import re
import tomllib
from pathlib import Path

import pytest
import yaml

from easy_ci import __version__
from easy_ci.updates import parse_version
from easy_ci.validation import validate

ROOT = Path(__file__).resolve().parents[1]


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_versions_are_consistent():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    frontend = json.loads((ROOT / "frontend" / "package.json").read_text())["version"]
    assert project == __version__ == frontend
    # Le cask suit la dernière version publiée : il est mis à jour par la release, après le tag.
    cask = re.search(r'version "([^"]+)"', (ROOT / "Casks" / "easy-ci.rb").read_text()).group(1)
    assert parse_version(cask) <= parse_version(__version__)


def test_changelog_lists_current_version():
    changelog = (ROOT / "CHANGELOG.md").read_text()
    assert "## [Unreleased]" in changelog and f"## [{__version__}]" in changelog


def test_french_changelog_matches_english():
    headings = re.compile(r"^## \[([^\]]+)\]", re.M)
    english, french = ((ROOT / name).read_text(encoding="utf-8") for name in ("CHANGELOG.md", "CHANGELOG.fr.md"))
    assert headings.findall(french) == headings.findall(english)
    # Même nombre d'entrées par version : une entrée ajoutée dans une seule langue est repérée.
    assert [section.count("\n- ") for section in headings.split(french)[2::2]] == [section.count("\n- ") for section in headings.split(english)[2::2]]


def test_release_notes_are_bilingual(tmp_path):
    notes = _load(ROOT / "scripts" / "release_notes.py")
    body = notes.release_notes(__version__, "owner/repo")
    french, english = body.split("<!-- lang:fr -->\n")[1].split("<!-- /lang -->")[0], body.split("<!-- lang:en -->\n")[1].split("<!-- /lang -->")[0]
    assert french.startswith("## Nouveautés") and "## Téléchargements" in french and "raw.githubusercontent.com/owner/repo/main/packaging/macos/install.sh" in french
    assert english.startswith("## What's new") and "## Downloads" in english and "brew tap owner/easy-ci" in english
    assert "What's Changed" not in body and "New Contributors" not in body

    (tmp_path / "CHANGELOG.md").write_text("## [Unreleased]\n\n### Added\n\n- Beta\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- One\n\n[1.0.0]: https://example.org/compare/v0.9.0...v1.0.0\n")
    (tmp_path / "CHANGELOG.fr.md").write_text("## [Unreleased]\n\n### Ajouté\n\n- Bêta\n")
    assert "- Beta" in notes.release_notes("1.1.0-beta.1", "owner/repo", tmp_path)
    assert "**Full changelog**: https://example.org/compare/v0.9.0...v1.0.0" in notes.language_block("en", "1.0.0", (tmp_path / "CHANGELOG.md").read_text(), "owner/repo")
    with pytest.raises(ValueError, match=r"CHANGELOG\.fr\.md"):
        notes.release_notes("1.0.0", "owner/repo", tmp_path)


def test_bump_cask_updates_version_and_checksums():
    bump = _load(ROOT / "packaging" / "homebrew" / "bump_cask.py").bump
    original = (ROOT / "Casks" / "easy-ci.rb").read_text()
    updated = bump(original, "1.2.3", "a" * 64, "b" * 64)
    assert 'version "1.2.3"' in updated and f'arm:   "{"a" * 64}"' in updated and f'intel: "{"b" * 64}"' in updated
    assert updated.count("\n") == original.count("\n")
    with pytest.raises(ValueError):
        bump(original, "v1.2.3", "a" * 64, "b" * 64)
    with pytest.raises(ValueError):
        bump(original.replace("sha256 arm:", "sha256 arm64:"), "1.2.3", "a" * 64, "b" * 64)


@pytest.mark.parametrize("workflow", sorted((ROOT / ".github" / "workflows").glob("*.yml")), ids=lambda p: p.name)
def test_project_workflows_are_valid(workflow):
    content = workflow.read_text()
    result = validate("github", content)
    assert result["errors"] == 0, result["problems"]
    document = yaml.safe_load(content)
    for job in document["jobs"].values():
        for step in job.get("steps", []):
            uses = step.get("uses", "")
            assert not uses or "@" in uses, uses
