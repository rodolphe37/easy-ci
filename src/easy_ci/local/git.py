"""Appels au `git` installé sur la machine.

On utilise volontairement le binaire de l'utilisateur : mêmes identifiants (SSH, trousseau,
credential helper), même configuration, même comportement que dans son terminal.
"""

from __future__ import annotations

import fnmatch
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from easy_ci.errors import EasyCIError

DEFAULT_TIMEOUT = 20
NETWORK_TIMEOUT = 120


class GitError(EasyCIError):
    code = "git"


class GitNotInstalledError(GitError):
    code = "git_missing"


@dataclass
class GitResult:
    returncode: int
    stdout: str
    stderr: str


def git_path() -> str | None:
    return shutil.which("git")


def git_version() -> str | None:
    binary = git_path()
    if not binary:
        return None
    try:
        output = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return output.strip().removeprefix("git version ").strip() or None


def run_git(args: list[str], cwd: Path | str | None = None, *, timeout: int = DEFAULT_TIMEOUT, check: bool = True) -> GitResult:
    binary = git_path()
    if not binary:
        raise GitNotInstalledError("Git n'est pas installé ou introuvable dans le PATH.")
    env = {
        **os.environ,
        # Jamais de question interactive : l'app n'a pas de terminal pour y répondre.
        "GIT_TERMINAL_PROMPT": "0",
        "GCM_INTERACTIVE": "never",
        "GIT_SSH_COMMAND": os.environ.get("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15"),
        "LC_ALL": "C",
    }
    try:
        completed = subprocess.run([binary, *args], cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"La commande git {args[0]} a dépassé le délai de {timeout} s.") from exc
    except OSError as exc:
        raise GitError(f"Impossible d'exécuter git : {exc}") from exc
    result = GitResult(completed.returncode, completed.stdout, completed.stderr)
    if check and result.returncode != 0:
        raise GitError(explain_git_error(args, result.stderr or result.stdout))
    return result


def explain_git_error(args: list[str], output: str) -> str:
    """Traduit les erreurs git les plus fréquentes en messages actionnables."""
    text = output.strip()
    lower = text.lower()
    command = args[0] if args else "git"
    if "could not read username" in lower or "terminal prompts disabled" in lower or "authentication failed" in lower:
        return (
            "Git n'a pas pu s'authentifier auprès du serveur. Configurez un accès SSH ou un gestionnaire d'identifiants Git "
            "(par exemple « gh auth setup-git » pour GitHub), puis réessayez."
        )
    if "permission denied (publickey)" in lower or "host key verification failed" in lower:
        return "Accès SSH refusé : votre clé SSH n'est pas chargée ou n'est pas autorisée sur ce dépôt."
    if "not possible to fast-forward" in lower or "diverging branches" in lower or "have diverged" in lower:
        return "Votre branche locale et la branche distante ont divergé : fusionnez ou rebasez depuis votre terminal."
    if "would be overwritten" in lower or "please commit your changes or stash them" in lower:
        return "Des modifications locales non commitées bloquent la mise à jour. Commitez-les ou mettez-les de côté (stash)."
    if "no tracking information" in lower or "no upstream" in lower:
        return "La branche locale ne suit aucune branche distante."
    if "already exists and is not an empty directory" in lower:
        return "Le dossier de destination existe déjà et n'est pas vide."
    if "could not resolve host" in lower or "unable to access" in lower:
        return "Serveur Git injoignable. Vérifiez votre connexion."
    last_line = text.splitlines()[-1] if text else "erreur inconnue"
    return f"git {command} a échoué : {last_line.removeprefix('fatal: ').removeprefix('error: ')}"


# ---------------------------------------------------------------------------
# Lecture de l'état d'un dépôt
# ---------------------------------------------------------------------------


def repo_root(path: Path | str) -> Path | None:
    result = run_git(["rev-parse", "--show-toplevel"], cwd=path, check=False)
    return Path(result.stdout.strip()) if result.returncode == 0 and result.stdout.strip() else None


def remote_urls(path: Path | str) -> dict[str, str]:
    """{nom du remote: URL de fetch}."""
    result = run_git(["config", "--get-regexp", r"^remote\..*\.url$"], cwd=path, check=False)
    remotes: dict[str, str] = {}
    for line in result.stdout.splitlines():
        key, _, url = line.partition(" ")
        name = key.removeprefix("remote.").removesuffix(".url")
        if name and url:
            remotes[name] = url.strip()
    return remotes


def status(path: Path | str) -> dict[str, Any]:
    """Branche, suivi distant, avance/retard et fichiers modifiés (sans accès réseau)."""
    result = run_git(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"], cwd=path)
    branch = None
    upstream = None
    ahead = behind = 0
    detached = False
    changes: list[dict[str, str]] = []

    entries = result.stdout.split("\0")
    index = 0
    while index < len(entries):
        entry = entries[index]
        index += 1
        if not entry:
            continue
        if entry.startswith("# branch.head "):
            head = entry.removeprefix("# branch.head ")
            detached = head == "(detached)"
            branch = None if detached else head
        elif entry.startswith("# branch.upstream "):
            upstream = entry.removeprefix("# branch.upstream ")
        elif entry.startswith("# branch.ab "):
            parts = entry.removeprefix("# branch.ab ").split()
            ahead, behind = abs(int(parts[0])), abs(int(parts[1]))
        elif entry[0] in "12u":
            fields = entry.split(" ")
            xy = fields[1]
            if entry[0] == "2":
                # Renommage : le chemin d'origine suit dans l'entrée suivante.
                file_path = entry.split(" ", 9)[9]
                index += 1
            elif entry[0] == "u":
                file_path = entry.split(" ", 10)[10]
            else:
                file_path = entry.split(" ", 8)[8]
            changes.append({"path": file_path, "status": _describe_xy(xy, entry[0] == "u")})
        elif entry.startswith("? "):
            changes.append({"path": entry[2:], "status": "untracked"})

    return {
        "branch": branch,
        "detached": detached,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "changes": changes,
        "dirty": bool(changes),
    }


def _describe_xy(xy: str, conflict: bool) -> str:
    if conflict:
        return "conflict"
    index_state, worktree_state = xy[0], xy[1]
    state = worktree_state if worktree_state != "." else index_state
    return {"M": "modified", "A": "added", "D": "deleted", "R": "renamed", "C": "copied", "T": "modified"}.get(state, "modified")


def last_commit(path: Path | str) -> dict[str, Any] | None:
    result = run_git(["log", "-1", "--format=%H%x00%s%x00%an%x00%cI"], cwd=path, check=False)
    if result.returncode != 0 or not result.stdout.strip():
        return None
    sha, subject, author, date = (result.stdout.strip().split("\0") + ["", "", "", ""])[:4]
    return {"sha": sha, "message": subject, "author": author, "date": date}


def last_fetch_time(path: Path | str) -> float | None:
    git_dir = run_git(["rev-parse", "--absolute-git-dir"], cwd=path, check=False).stdout.strip()
    fetch_head = Path(git_dir) / "FETCH_HEAD" if git_dir else None
    return fetch_head.stat().st_mtime if fetch_head and fetch_head.exists() else None


def list_files(path: Path | str, patterns: list[str]) -> list[str]:
    """Fichiers suivis ou non (hors ignorés) correspondant aux motifs, relatifs à la racine."""
    result = run_git(["ls-files", "--cached", "--others", "--exclude-standard", "--", *patterns], cwd=path, check=False)
    return sorted({line for line in result.stdout.splitlines() if line})


def ref_exists(path: Path | str, ref: str) -> bool:
    return run_git(["rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}"], cwd=path, check=False).returncode == 0


def show_file(path: Path | str, ref: str, file_path: str) -> str | None:
    result = run_git(["show", f"{ref}:{file_path}"], cwd=path, check=False)
    return result.stdout if result.returncode == 0 else None


def diff_against(path: Path | str, ref: str, file_path: str) -> str:
    """Diff unifié entre `ref` et la copie de travail pour un fichier."""
    result = run_git(["diff", "--no-color", "--no-ext-diff", ref, "--", file_path], cwd=path, check=False)
    return result.stdout


def fetch(path: Path | str) -> None:
    run_git(["fetch", "--prune", "--quiet"], cwd=path, timeout=NETWORK_TIMEOUT)


def pull_fast_forward(path: Path | str) -> None:
    run_git(["pull", "--ff-only", "--quiet"], cwd=path, timeout=NETWORK_TIMEOUT)


def clone(url: str, destination: Path) -> None:
    run_git(["clone", "--quiet", url, str(destination)], cwd=destination.parent, timeout=600)


def changed_between(path: Path | str, base: str, target: str, patterns: list[str]) -> set[str]:
    """Fichiers modifiés sur `target` depuis l'ancêtre commun avec `base` (syntaxe « base...target »)."""
    result = run_git(["diff", "--name-only", "--no-renames", f"{base}...{target}", "--", *patterns], cwd=path, check=False)
    return {line for line in result.stdout.splitlines() if line}


def ls_tree(path: Path | str, ref: str, patterns: list[str]) -> set[str]:
    """Fichiers de `ref` correspondant aux motifs (ls-tree ne gère pas les jokers : filtrage ici)."""
    prefixes = sorted({pattern.split("*", 1)[0].rsplit("/", 1)[0] for pattern in patterns if "/" in pattern.split("*", 1)[0]})
    result = run_git(["ls-tree", "-r", "--name-only", ref, "--", *(prefixes or ["."])], cwd=path, check=False)
    return {line for line in result.stdout.splitlines() if line and any(fnmatch.fnmatchcase(line, p) for p in patterns)}


# ---------------------------------------------------------------------------
# Écriture : branches, commits, envoi
# ---------------------------------------------------------------------------


def valid_branch_name(path: Path | str, name: str) -> bool:
    return run_git(["check-ref-format", "--branch", name], cwd=path, check=False).returncode == 0


def branch_exists(path: Path | str, name: str) -> bool:
    return run_git(["show-ref", "--verify", "--quiet", f"refs/heads/{name}"], cwd=path, check=False).returncode == 0


def create_branch(path: Path | str, name: str) -> None:
    """Crée la branche depuis HEAD et s'y place, en conservant les modifications en cours."""
    run_git(["switch", "-c", name], cwd=path)


def identity(path: Path | str) -> dict[str, str] | None:
    name = run_git(["config", "user.name"], cwd=path, check=False).stdout.strip()
    email = run_git(["config", "user.email"], cwd=path, check=False).stdout.strip()
    return {"name": name, "email": email} if name and email else None


def commit_paths(path: Path | str, paths: list[str], message: str) -> str:
    """Commite uniquement ces fichiers (ajouts, modifications, suppressions), sans toucher au reste de l'index."""
    run_git(["add", "-A", "--", *paths], cwd=path)
    run_git(["commit", "--quiet", "-m", message, "--", *paths], cwd=path)
    return run_git(["rev-parse", "HEAD"], cwd=path).stdout.strip()


def restore_path(path: Path | str, file_path: str) -> None:
    """Annule les modifications non commitées d'un fichier suivi (index et copie de travail)."""
    run_git(["restore", "--source=HEAD", "--staged", "--worktree", "--", file_path], cwd=path)


def is_tracked(path: Path | str, file_path: str) -> bool:
    return run_git(["ls-files", "--error-unmatch", "--", file_path], cwd=path, check=False).returncode == 0


def push_branch(path: Path | str, remote: str, branch: str) -> None:
    run_git(["push", "--quiet", "--set-upstream", remote, f"HEAD:refs/heads/{branch}"], cwd=path, timeout=NETWORK_TIMEOUT)


def list_local_branches(path: Path | str) -> list[str]:
    result = run_git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], cwd=path, check=False)
    return [line for line in result.stdout.splitlines() if line]
