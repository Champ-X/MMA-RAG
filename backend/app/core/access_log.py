"""Keep failed probes visible without drowning setup diagnostics in HTTP 200s."""
import logging


class QuietSuccessfulPolls(logging.Filter):
    PATHS = {"/health", "/api/setup/progress", "/api/setup/status", "/api/upload/progress", "/upload/progress"}

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # Uvicorn's access record: client, method, full_path, version, status.
        if isinstance(args, tuple) and len(args) == 5:
            _, method, path, _, status = args
            return not (method in {"GET", "HEAD"} and isinstance(path, str)
                        and path.split("?", 1)[0].rstrip("/") in self.PATHS
                        and str(status) == "200")
        return True
