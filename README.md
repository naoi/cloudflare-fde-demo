# Cloudflare FDE AI Demo

## Project Overview

This project is a TypeScript API running on Cloudflare Workers. It accepts a text message, uses Workers AI to produce a one-sentence summary, and stores both the original text and summary in Cloudflare D1. The API also supports listing, retrieving, and deleting stored messages.

## Architecture

```text
HTTP client
    |
    v
Cloudflare Worker (src/index.ts)
    |-- AI Gateway (default) --> Workers AI binding (AI)
    |                              `-- Llama 3.2 3B Instruct summarization
    |
    `-- D1 binding (cf_fde_demo_db) --> messages table
```

The Worker performs routing, request validation, AI inference, persistence, and JSON response handling. Workers AI inference is routed through the account's `default` AI Gateway with logging enabled and caching skipped, preserving the existing per-request inference behavior. D1 queries that contain request-derived values use bound parameters.

## Endpoints

### `GET /`

Returns basic service information.

```json
{
  "message": "Cloudflare FDE AI demo"
}
```

### `POST /api/message`

Summarizes and saves a message.

Request:

```json
{
  "message": "A message to summarize"
}
```

The message must be non-empty and no longer than 2,000 characters. A successful response contains `original`, `summary`, and `saved: true`. Invalid input returns HTTP 400; unexpected processing errors return HTTP 500.

### `GET /api/messages`

Returns the 20 most recently created messages, ordered by descending ID.

```json
{
  "messages": []
}
```

### `GET /api/messages/:id`

Returns one message by positive integer ID. An invalid ID returns HTTP 400. A valid ID with no matching row returns HTTP 404:

```json
{
  "error": "message not found"
}
```

### `DELETE /api/messages/:id`

Deletes one message by positive integer ID using a parameterized D1 query.

Successful response:

```json
{
  "deleted": true,
  "id": 1
}
```

An invalid ID returns HTTP 400. A valid ID with no matching row returns HTTP 404 with `{"error":"message not found"}`.

## Cloudflare Services Used

- **Cloudflare Workers** runs the TypeScript request handler at the edge.
- **Cloudflare D1** stores message IDs, original text, summaries, and creation timestamps. It is exposed through the `cf_fde_demo_db` binding.
- **Workers AI** runs the `@cf/meta/llama-3.2-3b-instruct` model through the `AI` binding.
- **Cloudflare AI Gateway** observes Workers AI requests through the `default` gateway. The gateway is automatically created on the first authenticated request if it does not already exist. Request logging is enabled and response caching is bypassed to preserve existing behavior.
- **Workers Observability** is enabled in `wrangler.jsonc`, with source maps uploaded for deployed builds.
- **Wrangler** provides local development, type generation, D1 management, and deployment.

## AI Gateway Configuration

The existing Workers AI binding is routed through AI Gateway by passing gateway options as the third argument to `env.AI.run()`:

```typescript
const result = await env.AI.run(
  "@cf/meta/llama-3.2-3b-instruct",
  {
    prompt,
    max_tokens: 60,
    temperature: 0.2,
  },
  {
    gateway: {
      id: "default",
      skipCache: true,
      collectLog: true,
    },
  }
);
```

No separate AI Gateway binding or provider API key is required. The Workers AI binding supplies the Cloudflare account identity, and Cloudflare automatically creates the `default` gateway on the first authenticated inference request when necessary.

- `id: "default"` routes inference through the account's default gateway.
- `skipCache: true` prevents cached responses from changing the existing per-request inference behavior.
- `collectLog: true` records the request in AI Gateway for observability.

After sending a `POST /api/message` request, open **Cloudflare Dashboard → AI → AI Gateway → default → Logs** to verify the model, status, token usage, duration, prompt, and response. Because log payloads may contain submitted message text and generated summaries, review retention, access, and payload-logging settings before processing sensitive data.

## Local Development

Prerequisites:

- Node.js and npm
- A Cloudflare account authenticated through Wrangler for Workers AI access

Install dependencies:

```bash
npm install
npx wrangler login
```

Initialize the local D1 database:

```bash
npx wrangler d1 execute cf-fde-demo-db --local --file=./schema.sql
```

Generate binding types after changing `wrangler.jsonc`:

```bash
npm run cf-typegen
```

Start the local Worker:

```bash
npm run dev
```

The default local URL is `http://localhost:8787`. Workers AI inference and AI Gateway access Cloudflare remotely and may incur usage even while the Worker and D1 database run locally. The authenticated Cloudflare account must contain the Worker and Gateway; the binding uses the account identity automatically and does not require a provider API key.

Example request:

```bash
curl -X POST http://localhost:8787/api/message \
  -H 'Content-Type: application/json' \
  -d '{"message":"Cloudflare Workers runs serverless code at the edge."}'
```

## Deployment

Ensure the configured D1 database exists and initialize its remote schema once:

```bash
npx wrangler d1 execute cf-fde-demo-db --remote --file=./schema.sql
```

Review the deployment without publishing:

```bash
npx wrangler deploy --dry-run
```

Deploy the Worker:

```bash
npm run deploy
```

The `wrangler.jsonc` file defines the Worker name, compatibility settings, Workers AI binding, D1 binding, observability, and source-map upload behavior. AI Gateway routing is configured in the `env.AI.run()` request and needs no additional Wrangler binding. On the first authenticated inference request, Cloudflare creates the `default` gateway if necessary. For a different Cloudflare account or environment, create the corresponding D1 database and update its `database_id` before deployment.

## AI-Assisted Development Workflow

Requirements and acceptance criteria were defined first, then Codex was used to implement targeted changes. Generated code was reviewed for routing, validation, SQL parameterization, error handling, and regression risk, followed by automated tests and manual API validation.

The workflow used for each change was:

1. Define the endpoint contract, status codes, response bodies, and compatibility requirements.
2. Give Codex a narrowly scoped implementation request.
3. Review the generated diff against the existing Worker routes and Cloudflare D1 API behavior.
4. Verify that URL-derived values are validated and passed through prepared-statement bindings.
5. Run TypeScript checks and Worker-runtime tests.
6. Exercise the API manually with valid, invalid, and missing-resource cases before accepting the change.

Codex accelerated implementation and test creation, while human review and explicit acceptance criteria remained the control points for correctness and scope.

## Testing

The test suite uses Vitest with Cloudflare's Workers test pool and a local D1 binding. Tests create and reset the `messages` table, call the Worker handler, verify HTTP responses, and assert database state after deletion.

Run the test suite once:

```bash
npm test -- --run
```

Run tests in watch mode:

```bash
npm test
```

Run application and test TypeScript checks:

```bash
npx tsc --noEmit
npx tsc --noEmit -p test/tsconfig.json
```

Manual API validation can cover the main paths:

```bash
curl http://localhost:8787/api/messages
curl http://localhost:8787/api/messages/1
curl -X DELETE http://localhost:8787/api/messages/1
curl -i -X DELETE http://localhost:8787/api/messages/not-a-number
```

## Trade-offs / Future Improvements

- Move schema changes into versioned D1 migrations instead of applying a single schema file manually.
- Add authentication and authorization before exposing message reads or deletions publicly.
- Add pagination and configurable limits to the collection endpoint.
- Add structured error logging and request correlation IDs.
- Expand tests to cover message creation, AI failures, length validation, and all GET routes.
- Separate routing and domain logic as the API grows.
- Add staging and production Wrangler environments with separate D1 databases.
- Use separate named AI Gateways per environment and configure gateway caching, rate limits, and guardrails after measuring production traffic.
- Add rate limiting and abuse protection for the AI-backed endpoint.
