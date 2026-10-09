"""Single-use subprocess for the existing DashScope local-video transport."""
import asyncio
import json
import sys

from loguru import logger

from app.core.llm.connection_probe import VIDEO_FIXTURE, safe_error_code
from app.core.llm.providers.aliyun_bailian import AliyunBailianProvider


async def main() -> None:
    # stdout is a tiny private protocol, never SDK logs or credentials.
    logger.remove()
    try:
        request = json.loads(sys.stdin.buffer.read(16384))
        provider = AliyunBailianProvider(request["api_key"], base_url=request["base_url"])
        data = await provider.chat_completion(
            messages=[{"role": "user", "content": [
                {"type": "text", "text": "Describe how the color changes in this short video briefly."},
                {"type": "video_local", "path": str(VIDEO_FIXTURE), "fps": 1},
            ]}],
            model=request["model"], max_tokens=256, timeout=50, temperature=0.1,
        )
        payload = {"success": True, "data": data}
    except Exception as exc:
        payload = {"success": False, "error_code": safe_error_code(exc)}
    sys.stdout.write(json.dumps(payload))


if __name__ == "__main__":
    asyncio.run(main())
