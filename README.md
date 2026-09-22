# Bizna AI

Premium Arabic-first decision intelligence for Egyptian micro-businesses.

## Local setup

```bash
npm install -D wrangler
npx wrangler dev
```

Set the Worker secrets before deploying:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
```

Workers AI is the first Copilot provider. Groq and OpenRouter are attempted next, and the UI always keeps a useful deterministic fallback when providers are unavailable. Add a KV binding named `RATE_LIMIT_KV` in the Cloudflare dashboard for globally shared rate limiting; without it, the Worker uses an isolate-local sliding window.

The existing Supabase tables remain supported through the browser client: `business_profiles` and its related `experiments` records.
