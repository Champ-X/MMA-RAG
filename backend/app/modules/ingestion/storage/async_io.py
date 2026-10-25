"""Do not release upload ownership while a cancelled storage write still runs."""
import asyncio


async def settled_write(function, /, *args, **kwargs):
    operation = asyncio.create_task(asyncio.to_thread(function, *args, **kwargs))
    try:
        return await asyncio.shield(operation)
    except asyncio.CancelledError:
        while not operation.done():
            try:
                await asyncio.shield(operation)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        # Retrieve any exception but preserve the caller's cancellation.
        try:
            operation.result()
        except (Exception, asyncio.CancelledError):
            pass
        raise
