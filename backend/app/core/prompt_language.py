"""Request-scoped language for online prompts; never changes source text or indexes."""
from contextlib import contextmanager
from contextvars import ContextVar
from typing import AsyncIterator, Literal, TypeVar

PromptLanguage = Literal["zh-CN", "en-US"]
_language: ContextVar[PromptLanguage] = ContextVar("tessmora_prompt_language", default="zh-CN")
T = TypeVar("T")


def normalize_language(value: object = None) -> PromptLanguage:
    return "en-US" if value == "en-US" else "zh-CN"


def get_prompt_language() -> PromptLanguage:
    return _language.get()


@contextmanager
def prompt_language(language: object = None):
    token = _language.set(normalize_language(language))
    try:
        yield
    finally:
        _language.reset(token)


def localized(zh: T, en: T) -> T:
    return en if get_prompt_language() == "en-US" else zh


async def language_stream(stream: AsyncIterator[T], language: object = None) -> AsyncIterator[T]:
    """Bind lazy streaming work, including cleanup, without leaking across yields.

    StreamingResponse executes after the endpoint returns. Setting a context only
    around response creation cannot cover generation. Bind every advancement so
    child tasks inherit the request language and consumers keep their own context.
    """
    try:
        while True:
            with prompt_language(language):
                try:
                    item = await anext(stream)
                except StopAsyncIteration:
                    return
            yield item
    finally:
        with prompt_language(language):
            close = getattr(stream, "aclose", None)
            if close is not None:
                await close()
