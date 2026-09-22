# Nubia AI

Cyber-Nubian sovereign cultural intelligence for the Nile Valley: an interactive WebGL journey, historical archive, language cards, living village matrix, and edge AI Copilot.

## Local setup

```bash
npm install
npm run dev
```

Deploy with `npm run deploy`. The static experience lives in `public/index.html`; the edge routes live in `src/worker.js`.

## Edge AI

Workers AI is attempted first with `@cf/meta/llama-3-8b-instruct`, followed by Groq and OpenRouter free-compatible endpoints. If no provider is available, the Copilot returns a safe deterministic response instead of failing. Configure these as Worker secrets:

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
```

The Copilot routes are `/api/ai/copilot` and `/api/ai/nubia`. Add a KV binding named `RATE_LIMIT_KV` for globally shared rate limiting; otherwise an isolate-local sliding window is used.

## Cultural safety

The prompt distinguishes documented history, community memory, and user-provided archive material. It is intentionally instructed not to invent translations, dates, lineages, images, or oral-history details.
