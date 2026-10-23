# English interface and online prompts

Tessmora supports `zh-CN` and `en-US`. Choose **Interface language** in the sidebar, settings, or first-run setup. The preference is saved locally and applies immediately without remounting conversations or clearing drafts. Chinese remains the default for older clients and unrecognized language values.

## Scope

The preference controls product UI copy and the language of Tessmora-authored instructions used by online retrieval and answer generation. Direct retrieval, conventional Agent research, and Pi Agent use equivalent English prompt variants when English is selected. Existing English Decision/Jev prompts keep their established versions.

This does not introduce a separate answer-language preference or force English answers. Existing answer-language rules still apply. User questions, conversation history, document contents, filenames, source excerpts, and model-generated text retain their original language. Switching languages does not translate prior answers or research prose.

Indexing and ingestion prompts, embeddings, retrieval/ranking algorithms, tool identifiers, JSON fields, citation identifiers, and source scopes are unchanged. No reindexing is needed.

## Request behavior

The frontend captures the language when the user submits a question, before awaiting attachment preparation. That snapshot is sent as:

- `language` in `/api/chat/message` JSON.
- `language` in `/api/chat/stream` GET query or multipart form.
- `language` inside the Pi run request JSON, including multipart `request`.
- Optional `language` in `/api/v1/retrieval/search` JSON.

Pi persists this value with the run; retries and resumed work retain it. Changing the UI language affects subsequent submissions, while each running request continues with its original prompt language. Python uses a request-local `ContextVar`; streaming iteration and cleanup explicitly bind the snapshot. Pi passes the persisted language into the Node runtime.

## Maintaining translations

Frontend localization uses i18next/react-i18next. Catalogs live in `frontend/src/i18n/`; Chinese source messages are keys. Translate authored interface text at rendering time, including accessible labels. Keep variable text in interpolation values and avoid translating user data. Use complete sentences for counts and status messages so English word order and spacing remain correct. Components that display translations subscribe with `useTranslation()`; locale-dependent memoized values must update when language changes.

Online prompt variants live in `backend/app/core/llm/online_prompts_en.py`, generation templates, and `agent-runtime/src/prompts.mjs`. Pi's authored tool and schema descriptions use `backend/app/modules/pi_agent/prompt_translations.json`. Keep placeholders, schema keys, enumerated values, source restrictions, and answer/citation rules equivalent across variants.

## Verification

The language regression tests cover catalog keys and interpolation parity; language preference persistence and model-draft isolation; JSON/GET/multipart propagation; submission and retry snapshots; concurrent request isolation; streaming cleanup; prompt/schema equivalence; and preservation of source and user text. DOM tests exercise switching languages without clearing drafts, knowledge/architecture/settings copy, and Pi trace presentation.

Run frontend checks from `frontend/` with `npm test`, `npm run test:dom`, and `npm run build`. Backend and Node prompt tests use local fixtures/provider stubs and do not require paid model calls.
