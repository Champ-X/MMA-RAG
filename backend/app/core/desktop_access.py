"""Authentication at the private FastAPI listener used by the desktop client."""
from __future__ import annotations

import hmac
import os
from uuid import UUID

from starlette.datastructures import Headers
from starlette.responses import JSONResponse


def desktop_profile() -> bool:
    return os.environ.get("TESSMORA_RUNTIME_PROFILE") == "desktop"


class DesktopAccess:
    def __init__(self, app):
        self.app = app
        secret = os.environ.get("TESSMORA_DESKTOP_TOKEN", "")
        if len(secret) < 32:
            raise RuntimeError("Desktop API requires an instance credential")
        self.bearer = f"Bearer {secret}".encode("ascii")
        workspace_id = str(UUID(os.environ["TESSMORA_WORKSPACE_ID"]))
        self.origin = f"tessmora://{workspace_id}"

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        host = headers.get("host", "").lower()
        host, _, port = host.partition(":")
        origin = headers.get("origin")
        if host not in {"localhost", "127.0.0.1"} or (port and not port.isdecimal()) or (
            origin is not None and origin != self.origin
        ):
            response = JSONResponse({"detail": "Untrusted desktop origin"}, status_code=403)
        else:
            # Object URLs are independently signed; HTML media elements cannot set headers.
            signed_object = scope["method"] in {"GET", "HEAD"} and scope["path"].startswith("/api/objects/")
            if signed_object or hmac.compare_digest(headers.get("authorization", "").encode("latin1"), self.bearer):
                await self.app(scope, receive, send)
                return
            response = JSONResponse({"detail": "Desktop workspace credential required"}, status_code=401)
        await response(scope, receive, send)
