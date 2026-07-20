from __future__ import annotations

import os

from nexus.shared.domain.errors import CapabilityUnavailableError, ValidationError


class EnvironmentCredentialStore:
    """Development bootstrap store. Production uses a scoped host secret broker."""

    def resolve(self, secret_ref: str) -> str:
        if not secret_ref.startswith("env://"):
            raise ValidationError("Only env:// secret references are available in this runtime")
        name = secret_ref.removeprefix("env://")
        value = os.environ.get(name)
        if not value:
            raise CapabilityUnavailableError(
                "Referenced credential is unavailable", details={"secret_ref": secret_ref}
            )
        return value
