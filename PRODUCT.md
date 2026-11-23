# Tessmora product context

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Tessmora is a self-hosted workspace for researching mixed source material. A user can upload a manual, spreadsheet, recording, or video, ask a question, and open the cited passage, image, or time range to check the answer.

## Users

Researchers and teams use the workspace to organize source files and compare evidence across them. First-time visitors can explore the architecture page without connecting a knowledge base. Its examples use recorded material and illustrations.

## Capabilities and Constraints

- MinIO keeps original files and derived media. Qdrant indexes searchable representations and knowledge-base profiles. Citations carry enough source information to open the underlying material.
- Direct runs one retrieval pass. The conventional Agent starts with the original question, can search again within its round and query budgets, and shares the standard answer generator. Auto chooses between these paths.
- Pi runs its own Node tool loop. The Python host restricts source access and records evidence. With the default Durable runtime, eligible interrupted runs can resume. The core compatibility runtime leaves interrupted runs stopped.
- Users can verify claims against cited sources. The host validates evidence identity and location. A citation can still be attached to an unsupported claim.
- The default deployment serves one trusted workspace. Data stays in the chosen storage directories, while configured cloud models receive the material required for their tasks.

## Brand Commitments

Use the Tessmora name and existing application shell. The Color Atlas design applies to the architecture route. Label source material, captured examples, and interactive illustrations so readers can tell what they are inspecting. [Design guide](DESIGN.md) · [System architecture](docs/MMA_ARCHITECTURE.md) · [Pi runtime](docs/PI_AGENT_MODE.md)
