# Tessmora product context

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Tessmora is a self-hostable multimodal retrieval and Agent research workspace. Users ingest documents, spreadsheets, images, audio and video, search or ask questions, and return from citations to source material. These facts are grounded in README.md and current implementation.

## Users

The architecture page explains the project's design thinking and architecture. The user explicitly requested both substantive explanation and a more expressive, artistic design. The user confirmed a dual audience: first-time product visitors and technical peers/reviewers, with an overview first and technical depth afterward.

## Capabilities and Constraints

- Preserve original material and derived representations; MinIO and Qdrant have separate responsibilities.
- Direct and bounded Agent share conventional retrieval and generation; Pi has an independent Node tool loop and generation path, supervised by Python.
- Conventional Agent retrieves the original question before planning additional searches. Round and query limits stop the loop; evidence limits constrain the merged result.
- Pi host constrains source access and persists task events and evidence. Identity validation does not establish semantic entailment.
- Self-hosted storage does not imply offline model inference, complete multi-tenant authentication, or automatic task resumption after host restart.
- Page demonstrations must be labeled as illustrative and must not imply actual knowledge-base reads or live service status.

## Brand Commitments

Keep the Tessmora name and existing application shell. The user rejected the prior architecture page's monotonous appearance and authorized a substantial redesign of this surface. No new product-wide visual style is implied.

## Evidence on Hand

README.md; docs/MMA_ARCHITECTURE.md; docs/PI_AGENT_MODE.md; backend/app/modules/; agent-runtime/src/; existing architecture components. No benchmark or accuracy claims are authorized by these materials.
