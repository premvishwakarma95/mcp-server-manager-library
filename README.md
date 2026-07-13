# Dynamic MCP Server Platform

A production-grade Node.js / Express / MongoDB platform that lets you create
**MCP (Model Context Protocol) servers and tools dynamically at runtime** from
database configuration — no hardcoded servers, no hardcoded tools, no code
deploys required to add a new MCP endpoint.
We don't need to create separate mcp for any third party and no need to write code for that it's a library that gives control to create just by admin panel.

> Create a server in the admin API. Add tools (each tool is a stored config:
> method, URL, JSON-Schema input, auth, timeout). The platform immediately
> exposes:
>
> - `GET /<server-slug>` → MCP-compatible manifest of all enabled tools
> - `POST /<server-slug>/tools/<tool-name>` → dynamic, validated execution
>
> Tool execution is fully generic: input is validated against a stored JSON
> Schema, auth is injected, headers/query are merged, upstream calls are made
> via Axios with retries + timeouts, every call is logged.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
  - [Dynamic MCP routes (public)](#dynamic-mcp-routes-public)
  - [Admin API (authenticated)](#admin-api-authenticated)
  - [System routes](#system-routes)
- [Tool configuration model](#tool-configuration-model)
- [Authentication model](#authentication-model)
- [Execution engine internals](#execution-engine-internals)
- [Caching](#caching)
- [Response format](#response-format)
- [Production checklist](#production-checklist)

---

## Features

- **Fully dynamic** — MCP servers and tools are stored in MongoDB; routes are
  resolved per-request from slugs.
- **MCP-compatible manifest** at `GET /:serverSlug` (tools, JSON Schemas,
  invoke URLs, version, capabilities).
- **Dynamic validation** — each tool's stored JSON Schema is compiled to a Zod
  validator on the fly for every invocation.
- **Generic execution engine** — HTTP tools (GET/POST/PUT/PATCH/DELETE) plus a
  built-in `echo` execution type for testing.
- **Auth injection** — `none | bearer | apiKey | basic`, configurable per
  server with per-tool overrides; secrets can be resolved from env vars at
  call time (`secretEnvVar`).
- **Retries + timeouts + URL templating** in the execution engine.
- **Execution logging** to MongoDB with body redaction and truncation.
- **Admin API** under `/api/v1/admin/...` protected by API-key auth.
- **Centralized error handling** with `ApiError`, Zod, Mongoose and duplicate-
  key handling.
- **Helmet, CORS, rate limiting, mongo-sanitize, hpp, compression**.
- **Optional Redis caching layer** (server + tool lookups by slug).
- **Swagger / OpenAPI** at `/docs` and `/openapi.json`.
- **Graceful shutdown**, request IDs, structured logging via Winston.
- **Idempotent seed script** with a sample `cloak-browser-mcp` server.
- **Built-in admin UI** at `/admin` — single-file vanilla page that consumes the
  admin API for full CRUD on servers and tools, a "Try It" runner, and a logs
  viewer.

---

## Architecture

```
┌─────────────┐    GET /:slug             ┌──────────────────────────────┐
│ MCP Client  │ ───────────────────────►  │ Dynamic Router (routes/)     │
│ (Claude     │                           │   • Resolves slug → server   │
│  Desktop,   │ ◄─── MCP manifest ─────── │   • Loads enabled tools      │
│  scripts)   │                           │   • Builds MCP manifest      │
└─────────────┘                           └──────────────────────────────┘
                                                       │
       POST /:slug/tools/:name                         ▼
              { ...input... }                  Execution Engine
                                                       │
                                          ┌────────────┼────────────────┐
                                          ▼            ▼                ▼
                                     Zod validator   Auth Injector   Axios + retries
                                     (from JSON       (server/tool   + timeouts
                                      Schema)         + env-var
                                                      secret)
                                          │            │                │
                                          └────────────┼────────────────┘
                                                       ▼
                                              ExecutionLog (Mongo)
```

Layers:

- **routes/** — top-level Express routers (system, admin namespace, dynamic).
- **modules/<feature>/** — each feature is a vertical: model → repository →
  service → controller → routes → validator.
- **middlewares/** — error handler, rate limiters, validation glue, sanitizers,
  request logger.
- **utils/** — `ApiError`, response helpers, async handler, logger, JSON-Schema
  → Zod compiler, Axios client with retries, slugify.
- **cache/** — thin wrapper over Redis (optional).
- **database/** — Mongo + Redis connection lifecycles.
- **loaders/** — wire mongoose and express on boot.

---

## Folder structure

```
src/
├── app.js                          # builds the Express app
├── server.js                       # process entrypoint (signals, listen)
├── config/
│   ├── env.js                      # validated env config
│   ├── index.js
│   └── swagger.js
├── database/
│   ├── mongo.js
│   └── redis.js
├── cache/
│   └── cache.service.js
├── utils/
│   ├── ApiError.js
│   ├── ApiResponse.js
│   ├── asyncHandler.js
│   ├── logger.js
│   ├── slugify.js
│   ├── httpClient.js
│   └── zodFromJsonSchema.js
├── middlewares/
│   ├── errorHandler.js
│   ├── notFound.js
│   ├── rateLimiter.js
│   ├── requestLogger.js
│   ├── sanitize.js
│   └── validate.js
├── modules/
│   ├── auth/
│   │   └── auth.middleware.js      # admin API-key middleware
│   ├── mcpServer/
│   │   ├── mcpServer.model.js
│   │   ├── mcpServer.repository.js
│   │   ├── mcpServer.service.js
│   │   ├── mcpServer.validator.js
│   │   ├── mcpServer.controller.js
│   │   └── mcpServer.routes.js
│   ├── tool/
│   │   ├── tool.model.js
│   │   ├── tool.repository.js
│   │   ├── tool.service.js
│   │   ├── tool.validator.js
│   │   ├── tool.controller.js
│   │   └── tool.routes.js
│   ├── execution/
│   │   ├── execution.engine.js
│   │   ├── execution.log.model.js
│   │   ├── execution.repository.js
│   │   ├── auth.injector.js
│   │   └── mcpManifest.js
│   └── logs/
│       ├── logs.controller.js
│       └── logs.routes.js
├── routes/
│   ├── index.js                    # top-level router composition
│   ├── admin.routes.js             # /api/v1/admin/*
│   ├── dynamic.routes.js           # /:serverSlug + /:serverSlug/tools/:name
│   └── health.routes.js            # /health, /ready, /metrics
├── loaders/
│   ├── index.js
│   ├── express.js
│   └── mongoose.js
└── seed/
    └── seed.js
```

---

## Quick start

### Prerequisites

- Node.js 18+
- MongoDB 5+ (local or Atlas)
- (Optional) Redis 6+ for the caching layer

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
# edit .env — at minimum set MONGO_URI and ADMIN_API_KEYS
```

### 3. Seed sample data (optional)

```bash
npm run seed
```

This creates an MCP server `cloak-browser-mcp` with tools `create_profile`,
`start_browser`, `stop_browser`, and a local `echo` tool.

### 4. Run

```bash
npm run dev     # nodemon
# or
npm start
```

Hit it:

```bash
# Manifest
curl http://localhost:4000/cloak-browser-mcp

# Execute a tool (echo — no upstream needed)
curl -X POST http://localhost:4000/cloak-browser-mcp/tools/echo \
     -H 'Content-Type: application/json' \
     -d '{"message":"hi"}'

# Admin: list servers
curl http://localhost:4000/api/v1/admin/servers \
     -H "x-api-key: $ADMIN_KEY"
```

Swagger UI: `http://localhost:4000/docs` - Here you will get the documentation
Admin UI:   `http://localhost:4000/admin` - Here you will get admin

---

## Using it with Claude (Custom Connectors, API, Desktop)

The platform speaks the **MCP "Streamable HTTP" transport** (JSON-RPC 2.0 over
HTTP, with SSE responses when the client asks for them). The MCP endpoint for
any server is:

```
POST /<serverSlug>/mcp
```

This is the URL you give to Claude. Implemented JSON-RPC methods:
`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`,
plus empty stubs for `prompts/list`, `resources/list`,
`resources/templates/list`. Tool errors are returned as MCP
`{ isError: true, content: [...] }` results (not as JSON-RPC errors), per spec.

### Step 1 — Expose your local server via ngrok

Claude.ai's Custom Connectors and the Claude API both need a **public HTTPS
URL**. ngrok is the quickest way:

```bash
# Once: install ngrok and authenticate (free account is fine)
#   https://dashboard.ngrok.com/get-started/your-authtoken
ngrok config add-authtoken <your-token>

# In one terminal:
npm run dev                       # platform on http://localhost:4000

# In another:
ngrok http 4000
```

ngrok prints a forwarding URL like `https://abc123.ngrok-free.app`. That's
your public base URL. Your MCP endpoint is therefore:

```
https://abc123.ngrok-free.app/jsonplaceholder-mcp/mcp
```

You can sanity-check it before wiring Claude:

```bash
curl -s -X POST https://abc123.ngrok-free.app/jsonplaceholder-mcp/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

You should get back a JSON-RPC response with `protocolVersion`, `capabilities`,
and `serverInfo`. If you do, every Claude surface below will work.

### Step 2a — claude.ai (Custom Connectors)

> Requires a paid Claude plan that exposes Custom Connectors in **Settings →
> Connectors**.

1. Settings → **Connectors** → **Add custom connector**.
2. **Name**: anything, e.g. *JSONPlaceholder MCP*.
3. **MCP server URL**: `https://abc123.ngrok-free.app/jsonplaceholder-mcp/mcp`
4. **Authentication**: *None* (the platform's MCP endpoint is unauthenticated;
   the admin API is what's protected). Add HTTP auth here if you front the
   service with a reverse proxy that requires it.
5. Save. Claude will call `initialize` and `tools/list`; you'll see your 4
   tools appear under the connector.
6. Start a new chat with that connector enabled and ask Claude something like
   *"Use the create_post tool to publish a hello-world post for user 1"*.
7. Watch the **Logs** tab in the admin UI — every Claude call lands there with
   full request/response, latency, and retry count.

### Step 2b — Claude API (`mcp_servers` parameter)

```bash
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-04-04" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "mcp_servers": [{
      "type": "url",
      "url": "https://abc123.ngrok-free.app/jsonplaceholder-mcp/mcp",
      "name": "jsonplaceholder"
    }],
    "messages": [{"role":"user","content":"List the first 3 posts using the tools."}]
  }'
```

### Step 2c — Claude Desktop (via `mcp-remote` bridge)

Claude Desktop's native transport is stdio. To point it at an HTTP MCP
endpoint, use the official `mcp-remote` bridge. Edit
`%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "jsonplaceholder": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://abc123.ngrok-free.app/jsonplaceholder-mcp/mcp"
      ]
    }
  }
}
```

Restart Claude Desktop. The four tools (`get_posts`, `create_post`,
`update_post`, `delete_post`) appear in the tool drawer.

### Notes & gotchas

- **ngrok free URLs change every restart.** Each run gives you a new
  `https://....ngrok-free.app` host — you have to update the URL in Claude
  every time. Get a [reserved domain](https://dashboard.ngrok.com/cloud-edge/domains)
  (free tier includes one) to lock the URL.
- **CORS** is already permissive (`CORS_ORIGINS=*` by default). For prod,
  scope it to claude.ai and your trusted hosts.
- The MCP endpoint itself is **unauthenticated** by design — the protocol
  doesn't define auth. If you need it, put a reverse proxy / Cloudflare
  Access in front of `/<slug>/mcp`. The admin namespace is separately
  protected via `ADMIN_API_KEYS`.
- Every Claude `tools/call` goes through the same execution engine as the UI
  Try-It and direct REST calls, so logs, retries, timeouts, and auth
  injection all work identically.

---

## Admin UI

Open **http://localhost:4000/admin** in a browser. Paste your admin API key
(default dev key: `local-admin-key`) and click **Connect** — the key is stored
in `localStorage` so you don't re-enter it on reload.

The UI has four tabs:

- **Servers** — list, create, edit, delete MCP servers. Each row gives you
  one-click access to the public manifest URL.
- **Tools** — pick a server, then list/create/edit/delete its tools. The form
  includes a JSON-Schema editor (with a *Format* button) for `inputSchema`,
  plus collapsible sections for headers, query params, per-tool auth override,
  and metadata.
- **Try It** — pick any server slug + tool, the body editor is pre-populated
  with a stub based on the tool's required fields, click **Run ▶** to invoke
  the public dynamic route. Result panel shows HTTP status, latency, and full
  response JSON.
- **Logs** — filter by server / status, paginate, click **Inspect** on any row
  to see the full request, response (truncated and header-redacted), retries,
  and error details.

The UI is a single static HTML file with embedded CSS + vanilla JS — no build
step. It talks to the same `/api/v1/admin/*` endpoints anyone else can call.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` is stricter. |
| `PORT` | `4000` | HTTP port. |
| `API_PREFIX` | `/api/v1` | Admin namespace prefix. |
| `MONGO_URI` | `mongodb://localhost:27017/dynamic_mcp` | Required. |
| `MONGO_DEBUG` | `false` | Log all queries. |
| `REDIS_ENABLED` | `false` | Toggle caching. |
| `REDIS_URL` | `redis://localhost:6379` | |
| `CACHE_TTL_SECONDS` | `60` | Cache TTL for server/tool lookups. |
| `CORS_ORIGINS` | `*` | Comma-separated list. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | |
| `RATE_LIMIT_MAX` | `300` | Global per-IP. |
| `EXEC_RATE_LIMIT_MAX` | `60` | Per-IP for tool execution. |
| `ADMIN_API_KEYS` | _empty_ | Comma-separated. **Required in production.** |
| `ADMIN_AUTH_ENABLED` | `true` | Disable only for local dev. |
| `DEFAULT_TOOL_TIMEOUT_MS` | `15000` | Used when a tool has no `timeout`. |
| `DEFAULT_TOOL_RETRIES` | `0` | |
| `MAX_TOOL_TIMEOUT_MS` | `120000` | Hard ceiling on per-tool timeout. |
| `LOG_LEVEL` | `info` | Winston level. |
| `EXECUTION_LOG_BODY_BYTES` | `8192` | Truncate logged bodies above this. |
| `SWAGGER_ENABLED` | `true` | Disable in prod if undesired. |

---

## API reference

All responses follow the [shared response format](#response-format).

### Dynamic MCP routes (public)

| Method | Path | Description |
|---|---|---|
| `GET` | `/:serverSlug` | MCP manifest: server + enabled tools. 404 if missing/inactive. |
| `GET` | `/:serverSlug/tools` | Just the `tools` array. |
| `POST` | `/:serverSlug/tools/:toolName` | Validate input, execute tool, return result. |
| `POST` | `/:serverSlug/tools/:toolName/test` | Same as above but flagged in logs. |
| `POST` | `/:serverSlug/mcp` | **MCP JSON-RPC 2.0** endpoint (Streamable HTTP). What Claude connects to. |
| `GET`  | `/:serverSlug/mcp` | MCP SSE server→client stream (keep-alives only). |
| `DELETE` | `/:serverSlug/mcp` | Stateless session-close no-op. |

### Admin API (authenticated)

All admin routes require either `x-api-key: <key>` or `Authorization: Bearer <key>`,
matched against `ADMIN_API_KEYS`.

**MCP Servers**

| Method | Path |
|---|---|
| `GET`    | `/api/v1/admin/servers` |
| `POST`   | `/api/v1/admin/servers` |
| `GET`    | `/api/v1/admin/servers/:id` |
| `PATCH`  | `/api/v1/admin/servers/:id` |
| `DELETE` | `/api/v1/admin/servers/:id` |

Example create:

```bash
curl -X POST http://localhost:4000/api/v1/admin/servers \
     -H "x-api-key: $ADMIN_KEY" -H "Content-Type: application/json" \
     -d '{
       "name": "Cloak Browser MCP",
       "slug": "cloak-browser-mcp",
       "baseUrl": "https://api.example.com",
       "authType": "bearer",
       "auth": { "type": "bearer", "secretEnvVar": "CLOAK_TOKEN" }
     }'
```

**Tools**

| Method | Path |
|---|---|
| `GET`    | `/api/v1/admin/tools?serverId=...` |
| `POST`   | `/api/v1/admin/tools` |
| `GET`    | `/api/v1/admin/tools/:id` |
| `PATCH`  | `/api/v1/admin/tools/:id` |
| `DELETE` | `/api/v1/admin/tools/:id` |

Example create:

```bash
curl -X POST http://localhost:4000/api/v1/admin/tools \
     -H "x-api-key: $ADMIN_KEY" -H "Content-Type: application/json" \
     -d '{
       "serverId": "65f0a...",
       "name": "create_profile",
       "method": "POST",
       "endpoint": "/profiles",
       "inputSchema": {
         "type": "object",
         "properties": { "name": { "type": "string", "minLength": 1 } },
         "required": ["name"],
         "additionalProperties": false
       },
       "timeout": 10000,
       "retries": 1
     }'
```

**Execution logs**

| Method | Path |
|---|---|
| `GET` | `/api/v1/admin/logs?serverId=&toolId=&status=&from=&to=&page=&limit=` |
| `GET` | `/api/v1/admin/logs/:id` |

### System routes

| Path | Description |
|---|---|
| `/`         | Index info. |
| `/health`   | Liveness — always 200 if process is up. |
| `/ready`    | Readiness — checks Mongo and (if enabled) Redis. |
| `/metrics`  | Lightweight process metrics. |
| `/admin`    | Built-in admin UI (single-file static page). |
| `/docs`     | Swagger UI (if `SWAGGER_ENABLED=true`). |
| `/openapi.json` | Raw OpenAPI spec. |

---

## Tool configuration model

```jsonc
{
  "serverId": "ObjectId of the parent server",
  "name": "create_profile",          // unique per server
  "description": "...",
  "method": "POST",                  // GET | POST | PUT | PATCH | DELETE
  "endpoint": "/profiles",           // absolute URL or path joined onto server.baseUrl
  "headers": { "X-Tenant": "acme" }, // merged onto request (server defaultHeaders → tool headers)
  "queryParams": { "trace": "true" },// always sent as query string
  "inputSchema": { /* JSON Schema */ },// compiled to Zod at runtime
  "outputSchema": null,              // advisory, used by manifest
  "executionType": "http",           // "http" or "echo" (for local tests)
  "timeout": 15000,                  // ms; capped by MAX_TOOL_TIMEOUT_MS
  "retries": 1,                      // 0–5, exponential backoff (300ms × 2^attempt)
  "enabled": true,
  "auth": { "type": "inherit" },     // see below
  "version": "1.0.0",
  "metadata": {}
}
```

**URL templating:** any `{placeholder}` token in `endpoint` is substituted from
the validated input before the call. Example: `endpoint: "/profiles/{profileId}"`
with input `{ "profileId": "abc" }` → `/profiles/abc`.

For `GET` and `DELETE`, the validated input is sent as **query params**.
For `POST`/`PUT`/`PATCH`, it is sent as the JSON **body**.

---

## Authentication model

There are two independent auth concerns:

1. **Admin auth** — protects `/api/v1/admin/*`. API key in `x-api-key` or
   `Authorization: Bearer ...`, validated against `ADMIN_API_KEYS`.
2. **Upstream tool auth** — what credentials to attach when calling the
   external API behind a tool.

Upstream auth is configured at the **server** level (defaults for all its
tools) and can be **overridden per tool**:

```jsonc
// Server-level
{ "auth": { "type": "bearer", "secretEnvVar": "ACME_TOKEN" } }

// Tool-level: "inherit" → use server's auth; anything else overrides.
{ "auth": { "type": "apiKey", "headerName": "X-Acme-Key",
            "secretEnvVar": "ACME_API_KEY" } }
```

Supported types: `none | bearer | apiKey | basic`.

**Best practice:** prefer `secretEnvVar` over `token` / `password`. Raw secrets
stored in the DB are returned as `***` in API responses but are not encrypted
at rest by this service. If you must store them inline, configure MongoDB CSFLE
or a KMS-backed envelope.

---

## Execution engine internals

For each `POST /:slug/tools/:name`:

1. Slug + tool name are loaded (cached for `CACHE_TTL_SECONDS` if Redis is on).
2. Tool's `inputSchema` is compiled to Zod via `zodFromJsonSchema` and parsed.
   On failure → `422 VALIDATION_ERROR` with structured `issues[]`.
3. If `executionType === "echo"`, the validated input is echoed back and logged.
4. Otherwise the URL is built (`server.baseUrl + tool.endpoint`, with `{token}`
   substitution), headers are merged (server defaults → tool headers → request
   id), auth is injected, and Axios runs the request.
5. Retries fire on network errors and on HTTP `5xx`/`408`/`425`/`429`, with
   exponential backoff (`300ms × 2^attempt`), bounded by `tool.retries`.
6. Result statuses:
   - `2xx/3xx` → `success` (data returned)
   - timeout → `504 TOOL_TIMEOUT`
   - `>=400` upstream → `502 TOOL_UPSTREAM_ERROR` (truncated upstream body in details)
7. Every attempt is summarized into a single `tool_execution_logs` row with
   redacted headers and truncated bodies.

---

## Caching

If `REDIS_ENABLED=true` the platform caches:

- `mcp:server:slug:<slug>` — full server doc (for both manifest and execution).
- `mcp:tools:<slug>` — server + enabled tools (for the manifest endpoint).
- `mcp:tool:<slug>:<name>` — server + single tool (for the execution endpoint).

Cache is invalidated on any server/tool mutation. Without Redis, every request
hits Mongo directly — still fast given the unique indexes on
`{ slug }` and `{ serverId, name }`.

---

## Response format

Success:

```json
{ "success": true, "message": "OK", "data": { /* ... */ } }
```

Paginated:

```json
{
  "success": true,
  "message": "OK",
  "data": { "items": [ /* ... */ ] },
  "meta": { "pagination": { "page": 1, "limit": 20, "total": 47, "totalPages": 3 } }
}
```

Error:

```json
{
  "success": false,
  "message": "Tool input validation failed",
  "error": {
    "message": "Tool input validation failed",
    "code": "VALIDATION_ERROR",
    "statusCode": 422,
    "details": { "issues": [ { "path": "name", "code": "too_small", "message": "..." } ] }
  }
}
```

---

## Production checklist

- Set `NODE_ENV=production` (stricter env validation; admin keys required).
- Strong `ADMIN_API_KEYS` (rotate via env). Prefer mTLS or an auth proxy in
  front of the admin namespace for higher-stakes deployments.
- Configure `CORS_ORIGINS` explicitly.
- Run MongoDB with auth + TLS; consider CSFLE if you store inline secrets.
- Enable `REDIS_ENABLED=true` for low-latency manifest lookups under load.
- Put the service behind a reverse proxy that sets `X-Forwarded-*` headers
  (the app trusts proxy hop = 1).
- Set log shipping to your stack (Winston writes JSON in production).
- Tune `RATE_LIMIT_MAX` and `EXEC_RATE_LIMIT_MAX` to your traffic shape.

---

## License

MIT
