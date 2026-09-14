"""Erreurs métier remontées jusqu'à l'interface (messages en français)."""

from __future__ import annotations


class EasyCIError(Exception):
    code = "error"

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status

    def to_dict(self) -> dict:
        return {"code": self.code, "message": str(self)}


class NotAuthenticatedError(EasyCIError):
    code = "not_authenticated"


class NetworkError(EasyCIError):
    code = "network"


class GitHubError(EasyCIError):
    code = "github"


class AuthError(GitHubError):
    code = "unauthorized"


class ForbiddenError(GitHubError):
    code = "forbidden"


class NotFoundError(GitHubError):
    code = "not_found"


class RateLimitError(GitHubError):
    code = "rate_limited"

    def __init__(self, message: str, *, reset_at: int, status: int | None = None) -> None:
        super().__init__(message, status=status)
        self.reset_at = reset_at

    def to_dict(self) -> dict:
        return {**super().to_dict(), "reset_at": self.reset_at}


class LinkMismatchError(EasyCIError):
    """Le dossier choisi n'est pas un clone du dépôt : l'interface propose de lier quand même."""

    code = "link_mismatch"
