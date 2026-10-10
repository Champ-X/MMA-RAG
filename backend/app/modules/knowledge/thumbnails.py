"""Small, bounded gallery derivatives; original uploads remain untouched."""
import asyncio
from collections import OrderedDict
from io import BytesIO
from PIL import Image, ImageOps


def render_thumbnail(content: bytes) -> bytes:
    with Image.open(BytesIO(content)) as source:
        image = ImageOps.exif_transpose(source)
        image.thumbnail((640, 480), Image.Resampling.LANCZOS)
        if image.mode not in ('RGB', 'RGBA'):
            image = image.convert('RGBA' if 'transparency' in image.info else 'RGB')
        output = BytesIO()
        image.save(output, 'WEBP', quality=80, method=4)
        return output.getvalue()


class ThumbnailCache:
    def __init__(self, max_bytes=32 * 1024 * 1024):
        self.cache = OrderedDict()
        self.size = 0
        self.max_bytes = max_bytes
        self.pending = {}
        self.slots = asyncio.Semaphore(4)

    async def get(self, adapter, bucket: str, path: str) -> bytes:
        key = (bucket, path)
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        if key not in self.pending:
            async def build():
                try:
                    async with self.slots:
                        content = await adapter.get_file_content(bucket, path)
                        thumbnail = await asyncio.to_thread(render_thumbnail, content)
                        self.cache[key] = thumbnail
                        self.size += len(thumbnail)
                        while self.size > self.max_bytes and self.cache:
                            _, old = self.cache.popitem(last=False)
                            self.size -= len(old)
                        return thumbnail
                finally:
                    self.pending.pop(key, None)
            self.pending[key] = asyncio.create_task(build())
        return await asyncio.shield(self.pending[key])
