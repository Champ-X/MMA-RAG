from __future__ import annotations

from typing import Any


class DomainError(Exception):
    code = "DOMAIN_ERROR"
    status_code = 400
    retryable = False

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(DomainError):
    code = "NOT_FOUND"
    status_code = 404


class ConflictError(DomainError):
    code = "CONFLICT"
    status_code = 409


class ValidationError(DomainError):
    code = "VALIDATION_ERROR"
    status_code = 422


class CapabilityUnavailableError(DomainError):
    code = "CAPABILITY_UNAVAILABLE"
    status_code = 503
    retryable = True
