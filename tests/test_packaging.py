import importlib.util
import re
import tomllib
from pathlib import Path

import pytest
import yaml

from easy_ci import __version__
from easy_ci.validation import validate

ROOT = Path(__file__).resolve().parents[1]


def _load(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_versions_are_consistent():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    cask = re.search(r'version "([^"]+)"', (ROOT / "Casks" / "easy-ci.rb").read_text()).group(1)
    assert project == __version__ == cask


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
