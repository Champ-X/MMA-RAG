# Security

## Secrets and environment files

- Never commit `backend/.env` or real API keys, tokens, or Feishu app credentials.
- Use [`backend/.env.example`](backend/.env.example) as a template: copy to `backend/.env` and fill in your own values.
- If this repository ever contained tracked `.env` files or keys were pushed to a remote, **rotate all affected credentials** (LLM providers, Tavily, MinerU, Feishu, etc.) and treat the old values as compromised.

## Reporting

If you discover a security issue, please open a private GitHub Security Advisory or contact the maintainers through an appropriate private channel rather than filing a public issue with exploit details.
