# Dynamic MCP Platform — Developer Reference

> **Scope:** Architecture, data models, API contracts, execution flows, auth, caching, and environment config.

---

## Table of Contents

1. [What This System Does](#1-what-this-system-does)
2. [Tech Stack](#2-tech-stack)
3. [Repository Layout](#3-repository-layout)
4. [Architecture Overview](#4-architecture-overview)
5. [Data Models & Schemas](#5-data-models--schemas)
6. [API Reference](#6-api-reference)
7. [Request Flow Walkthroughs](#7-request-flow-walkthroughs)
8. [Authentication Systems](#8-authentication-systems)
9. [Caching Layer](#9-caching-layer)
10. [Environment Variables](#10-environment-variables)

---

## 1. What This System Does

This is a **Dynamic MCP (Model Context Protocol) Server Platform**. It acts as a management layer and proxy that lets you:

1. Register upstream API servers as **MCP Servers** (with auth config, base URL, etc.)
2. Define **Tools** on each server — each tool maps to an HTTP endpoint on the upstream
3. Expose those tools over two protocols:
   - **REST**: `POST /:serverSlug/tools/:toolName` — direct tool execution
   - **MCP JSON-RPC 2.0**: `POST /:serverSlug/mcp` — used by MCP clients like Claude
4. Log every execution, validate inputs, inject auth, and cache hot lookup paths

The platform sits between an MCP client (e.g. Claude) and real upstream APIs, handling auth injection, input validation, retries, and execution logging.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| HTTP framework | Express 4 |
| Database | MongoDB via Mongoose 8 |
| Cache | Redis via ioredis 5 (optional) |
| Validation | Zod 3 |
| HTTP client | Axios 1 |
| Logging | Winston 3 |
| API docs | Swagger (swagger-jsdoc + swagger-ui-express) |

---

## 3. Repository Layout

```
src/
├── app.js                        # Express app factory
├── server.js                     # Process entry point, graceful shutdown
├── config/
│   └── env.js                    # All env vars parsed + typed here (single source of truth)
├── database/
│   ├── mongo.js                  # Mongoose connection
│   └── redis.js                  # ioredis client (lazy, optional)
├── loaders/
│   ├── express.js                # Middleware stack, routes, swagger
│   └── mongoose.js               # DB connect on startup
├── middlewares/
│   ├── errorHandler.js           # Global error → ApiError response
│   ├── notFound.js               # 404 catch-all
│   ├── rateLimiter.js            # General + execution-specific limiters
│   ├── requestLogger.js          # Morgan HTTP logging
│   ├── sanitize.js               # express-mongo-sanitize + hpp
│   └── validate.js               # Zod schema middleware (body/query/params)
├── cache/
│   └── cache.service.js          # Redis get/set/del/delByPattern (namespace: "mcp")
├── routes/
│   ├── index.js                  # Root router — mounts health, admin, dynamic
│   ├── health.routes.js          # /health, /ready, /metrics
│   ├── admin.routes.js           # /api/v1/admin/* (applies adminAuth middleware)
│   └── dynamic.routes.js         # /:serverSlug/* (manifest, tool exec, MCP transport)
├── modules/
│   ├── auth/
│   │   └── auth.middleware.js    # Admin API key check
│   ├── mcpServer/                # CRUD for registered MCP servers
│   │   ├── mcpServer.model.js
│   │   ├── mcpServer.repository.js
│   │   ├── mcpServer.service.js
│   │   ├── mcpServer.controller.js
│   │   ├── mcpServer.routes.js
│   │   └── mcpServer.validator.js
│   ├── tool/                     # CRUD + OpenAPI import for tools
│   │   ├── tool.model.js
│   │   ├── tool.repository.js
│   │   ├── tool.service.js
│   │   ├── tool.controller.js
│   │   ├── tool.routes.js
│   │   └── tool.validator.js
│   ├── execution/
│   │   ├── execution.engine.js   # Core: validate → resolve → auth inject → HTTP call → log
│   │   ├── auth.injector.js      # Upstream auth resolution (bearer/apiKey/basic)
│   │   ├── execution.log.model.js
│   │   ├── execution.repository.js
│   │   └── mcpManifest.js        # Builds MCP-compatible manifest JSON
│   ├── mcp/
│   │   ├── mcp.dispatcher.js     # JSON-RPC 2.0 method router
│   │   └── mcp.routes.js         # MCP transport (POST/GET/DELETE /:serverSlug/mcp)
│   └── logs/
│       ├── logs.controller.js    # Read-only views over execution logs
│       └── logs.routes.js
└── utils/
    ├── ApiError.js               # Typed HTTP error class
    ├── ApiResponse.js            # success / created / paginated response helpers
    ├── asyncHandler.js           # Express async error wrapper
    ├── httpClient.js             # Axios wrapper with retry logic
    ├── logger.js                 # Winston instance
    ├── openApiParser.js          # OpenAPI 3.x / Swagger 2.x → Tool[] converter
    ├── slugify.js                # URL-safe slug generation + validation
    └── zodFromJsonSchema.js      # Converts stored JSON Schema to Zod for runtime validation
```

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         MCP Client                              │
│              (Claude, custom client, REST caller)               │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express Application                          │
│                                                                 │
│  /health /ready /metrics     (unauthenticated)                 │
│  /api/v1/admin/*             (Admin API Key required)          │
│  /:serverSlug/*              (per-server optional MCP key)     │
│                                                                 │
│  Middleware stack:                                              │
│    helmet → cors → compression → sanitize → rateLimiter        │
│    → requestLogger → validate (Zod) → adminAuth                │
└──────────────┬──────────────────────────┬───────────────────────┘
               │                          │
               ▼                          ▼
   ┌───────────────────┐      ┌───────────────────────────┐
   │   Admin Layer     │      │     Dynamic MCP Layer     │
   │ /api/v1/admin/    │      │     /:serverSlug/         │
   │                   │      │                           │
   │ servers CRUD      │      │  GET /:slug  → Manifest   │
   │ tools CRUD        │      │  GET /:slug/tools         │
   │ tools/import      │      │  POST /:slug/tools/:name  │
   │ logs read         │      │  POST /:slug/mcp  (RPC)   │
   │                   │      │  GET  /:slug/mcp  (SSE)   │
   └────────┬──────────┘      └────────────┬──────────────┘
            │                              │
            ▼                              ▼
   ┌───────────────────────────────────────────────────────┐
   │                  Service Layer                        │
   │       mcpServer.service   |   tool.service            │
   │                                                       │
   │             ┌─────────────────────┐                  │
   │             │  Execution Engine   │                  │
   │             │  - Input validation │                  │
   │             │  - URL resolution   │                  │
   │             │  - Auth injection   │                  │
   │             │  - HTTP + retries   │                  │
   │             │  - Execution log    │                  │
   │             └─────────────────────┘                  │
   └─────────────────────────┬─────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         ┌─────────┐  ┌──────────┐  ┌────────────┐
         │ MongoDB │  │  Redis   │  │  Upstream  │
         │         │  │ (cache)  │  │    APIs    │
         │ servers │  │          │  │            │
         │ tools   │  │ TTL 60s  │  │ (tool      │
         │ logs    │  │ optional │  │  targets)  │
         └─────────┘  └──────────┘  └────────────┘
```

---

## 5. Data Models & Schemas

### 5.1 McpServer

**Collection:** `mcp_servers`

Represents a registered upstream MCP server. Credentials stored here are masked in JSON responses (`***`).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | String | Yes | — | 2–120 chars |
| `slug` | String | Yes | auto-generated from name | Unique, lowercase, URL-safe. Pattern: `/^[a-z0-9]+(-[a-z0-9]+)*$/` |
| `description` | String | No | `""` | Max 2000 chars |
| `status` | `"active"` \| `"inactive"` | No | `"active"` | Indexed |
| `authType` | `"none"` \| `"bearer"` \| `"apiKey"` \| `"basic"` | No | `"none"` | Kept in sync with `auth.type` via pre-save hook |
| `auth` | AuthConfig (embedded) | No | `{ type: "none" }` | Server-level upstream auth |
| `baseUrl` | String | No | `null` | Base URL for all relative tool endpoints |
| `defaultHeaders` | Object | No | `{}` | Merged into every upstream request from this server |
| `mcpAccessKey` | String | No | `null` | If set, callers must supply this key to access `/:serverSlug/mcp` |
| `mcpAccessKeyHeader` | String | No | `"x-mcp-key"` | Header name to check for `mcpAccessKey` |
| `mcpIpFilterEnabled` | Boolean | No | `false` | When `true`, only IPs in `mcpAllowedIps` may reach this server's `/:serverSlug/mcp` |
| `mcpAllowedIps` | String[] | No | `[]` | Per-server IP allowlist. Empty list + enabled = block everyone |
| `metadata` | Object | No | `{}` | Free-form |
| `version` | String | No | `"1.0.0"` | |
| `createdAt` | Date | — | auto | |
| `updatedAt` | Date | — | auto | |

**AuthConfig (embedded, no `_id`):**

| Field | Type | Notes |
|---|---|---|
| `type` | `"none"` \| `"bearer"` \| `"apiKey"` \| `"basic"` | |
| `token` | String \| null | Bearer token or API key value |
| `headerName` | String \| null | Custom header name for `apiKey` type (e.g. `"x-api-key"`) |
| `username` | String \| null | For `basic` auth |
| `password` | String \| null | For `basic` auth (masked in responses) |
| `secretEnvVar` | String \| null | If set, secret is read from `process.env[secretEnvVar]` at execution time instead of from stored value |

**Indexes:**
- `slug` — unique
- `{ status, slug }` — compound
- `{ name, description }` — text search

**Virtual:**
- `tools` → `McpTool[]` (ref by `serverId`)

---

### 5.2 McpTool

**Collection:** `mcp_tools`

Represents a single tool (endpoint) on an MCP server.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `serverId` | ObjectId → McpServer | Yes | — | Indexed |
| `name` | String | Yes | — | 1–80 chars. Pattern: `/^[a-zA-Z][a-zA-Z0-9_.\-]{0,79}$/` |
| `description` | String | No | `""` | Max 2000 chars |
| `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | No | `"POST"` | |
| `endpoint` | String \| null | No | `null` | Absolute URL or relative path (joined onto `server.baseUrl`). Supports `{placeholder}` templating from input |
| `headers` | Object | No | `{}` | Extra headers merged into upstream request |
| `queryParams` | Object | No | `{}` | Static query params always appended |
| `inputSchema` | JSON Schema object | No | `{ type: "object", properties: {}, additionalProperties: true }` | Validated at execution time via Zod |
| `outputSchema` | JSON Schema object \| null | No | `null` | Advisory only, not enforced |
| `executionType` | `"http"` \| `"echo"` | No | `"http"` | `echo` returns input as-is (no upstream call, useful for testing) |
| `timeout` | Number (ms) \| null | No | `null` | null → falls back to `DEFAULT_TOOL_TIMEOUT_MS`. Capped at `MAX_TOOL_TIMEOUT_MS` |
| `retries` | Number 0–5 | No | `0` | Retry count on network failure |
| `enabled` | Boolean | No | `true` | Disabled tools are excluded from all lookups |
| `auth` | ToolAuth (embedded) | No | `{ type: "inherit" }` | Overrides server auth when type ≠ `"inherit"` |
| `version` | String | No | `"1.0.0"` | |
| `metadata` | Object | No | `{}` | Free-form |

**ToolAuth (embedded):**

Same fields as `AuthConfig` above, plus:

| Field | Type | Notes |
|---|---|---|
| `type` | `"inherit"` \| `"none"` \| `"bearer"` \| `"apiKey"` \| `"basic"` | `"inherit"` = use server-level auth |

**Indexes:**
- `{ serverId, name }` — unique
- `{ serverId, enabled }` — compound
- `serverId` — single field

---

### 5.3 ExecutionLog

**Collection:** `tool_execution_logs`

Append-only record of every tool execution attempt. `updatedAt` is disabled — logs are never modified.

| Field | Type | Notes |
|---|---|---|
| `serverId` | ObjectId → McpServer | Indexed |
| `toolId` | ObjectId → McpTool | Indexed |
| `serverSlug` | String | Denormalized for fast filtering without joins |
| `toolName` | String | Denormalized |
| `requestId` | String \| null | Passed in from the calling HTTP request. Test executions prefixed with `"test:"` |
| `request.method` | String \| null | HTTP method used |
| `request.url` | String \| null | Resolved upstream URL |
| `request.headers` | Object \| null | Auth headers redacted to `***` |
| `request.query` | Object \| null | Query params |
| `request.body` | Mixed \| null | Truncated to `EXECUTION_LOG_BODY_BYTES` (default 8192 bytes) |
| `response.status` | Number \| null | HTTP status from upstream |
| `response.headers` | Object \| null | Sensitive headers redacted |
| `response.body` | Mixed \| null | Truncated if over limit |
| `response.bodyTruncated` | Boolean | `true` if body was cut |
| `status` | `"success"` \| `"validation_error"` \| `"upstream_error"` \| `"timeout"` \| `"internal_error"` | Indexed |
| `attempts` | Number | How many HTTP attempts were made (includes retries) |
| `durationMs` | Number | Wall-clock time from start to finish |
| `error.message` | String \| null | |
| `error.code` | String \| null | |
| `error.details` | Mixed \| null | Stack trace in non-production |
| `createdAt` | Date | Indexed descending |

**Indexes:**
- `{ createdAt: -1 }`
- `{ serverId, createdAt: -1 }`
- `{ toolId, createdAt: -1 }`
- `{ status, createdAt: -1 }`

---

## 6. API Reference

### 6.1 System Endpoints (no auth)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness probe. Returns `{ status: "ok", uptime }` |
| GET | `/ready` | Readiness probe. Checks MongoDB connection state and Redis (if enabled). Returns 503 if not ready |
| GET | `/metrics` | Process metrics: uptime, memory (rss/heap), PID, Node version |

---

### 6.2 Admin Endpoints

**Auth:** All admin endpoints require the header `x-api-key: <key>` where `<key>` is one of the comma-separated values in `ADMIN_API_KEYS`. In production, requests without a valid key return `401`.

Base path: `/api/v1/admin`

#### MCP Servers

| Method | Path | Description |
|---|---|---|
| GET | `/servers` | List servers with pagination |
| POST | `/servers` | Create a new server |
| GET | `/servers/:id` | Get server by MongoDB ObjectId |
| PATCH | `/servers/:id` | Partial update (any create fields are patchable) |
| DELETE | `/servers/:id` | Delete server; cascades to all its tools |

**GET /servers — query params:**

| Param | Type | Default |
|---|---|---|
| `page` | integer | 1 |
| `limit` | integer (max 100) | 20 |
| `status` | `"active"` \| `"inactive"` | — |
| `search` | string | — (MongoDB text search on name+description) |
| `sort` | string | — |

**POST /servers — request body:**

```json
{
  "name": "My API Server",           // required, 2–120 chars
  "slug": "my-api-server",           // optional, auto-generated from name if omitted
  "description": "...",              // optional
  "status": "active",                // optional, default "active"
  "baseUrl": "https://api.example.com", // optional
  "authType": "bearer",              // optional, synced with auth.type
  "auth": {
    "type": "bearer",
    "token": "secret-token",         // or use secretEnvVar to reference process.env
    "secretEnvVar": "MY_TOKEN_ENV"   // optional: read token from env at runtime
  },
  "defaultHeaders": { "X-App": "1" }, // optional
  "mcpAccessKey": "client-key",      // optional: requires callers to supply this key
  "mcpAccessKeyHeader": "x-mcp-key", // optional, default "x-mcp-key"
  "metadata": {},                    // optional
  "version": "1.0.0"                 // optional
}
```

**Response (201):**

```json
{
  "success": true,
  "message": "MCP server created",
  "data": { /* McpServer document with auth.token masked as "***" */ }
}
```

---

#### Tools

| Method | Path | Description |
|---|---|---|
| GET | `/tools` | List tools with pagination |
| POST | `/tools` | Create a tool |
| POST | `/tools/import/openapi` | Bulk-import tools from an OpenAPI spec |
| GET | `/tools/:id` | Get tool by ObjectId |
| PATCH | `/tools/:id` | Partial update (`serverId` is immutable) |
| DELETE | `/tools/:id` | Delete a tool |

**GET /tools — query params:**

| Param | Type |
|---|---|
| `page` | integer |
| `limit` | integer (max 100) |
| `serverId` | ObjectId string |
| `enabled` | `"true"` \| `"false"` |
| `search` | string |
| `sort` | string |

**POST /tools — request body:**

```json
{
  "serverId": "<ObjectId>",           // required
  "name": "get_user",                 // required, snake/kebab/dot-case
  "description": "Fetch a user by ID",
  "method": "GET",                    // GET/POST/PUT/PATCH/DELETE, default POST
  "endpoint": "/users/{userId}",      // relative (joined to server.baseUrl) or absolute URL
  "headers": { "X-Custom": "value" },
  "queryParams": { "format": "json" }, // static params always sent
  "inputSchema": {                    // JSON Schema — validated at execution time
    "type": "object",
    "properties": {
      "userId": { "type": "string" }
    },
    "required": ["userId"]
  },
  "outputSchema": null,               // optional, advisory
  "executionType": "http",            // "http" or "echo"
  "timeout": 5000,                    // ms, null → server default
  "retries": 2,                       // 0–5
  "enabled": true,
  "auth": { "type": "inherit" },      // inherit server auth or override
  "version": "1.0.0",
  "metadata": {}
}
```

**POST /tools/import/openapi — request body:**

```json
{
  "serverId": "<ObjectId>",   // required
  "spec": { /* OpenAPI 3.x or Swagger 2.x object */ }, // required
  "dryRun": false             // true = preview only, no writes
}
```

Response includes `created[]`, `skipped[]` (name already exists), `errors[]`.

---

#### Logs

| Method | Path | Description |
|---|---|---|
| GET | `/logs` | List execution logs |
| GET | `/logs/:id` | Get a single log |

**GET /logs — query params:**

| Param | Type |
|---|---|
| `page` | integer |
| `limit` | integer (max 100) |
| `serverId` | ObjectId |
| `toolId` | ObjectId |
| `status` | `"success"` \| `"validation_error"` \| `"upstream_error"` \| `"timeout"` \| `"internal_error"` |
| `from` | ISO 8601 datetime |
| `to` | ISO 8601 datetime |

---

### 6.3 Dynamic MCP Endpoints (public / per-server auth)

These endpoints are unauthenticated at the platform level. If a server has `mcpAccessKey` configured, callers must supply it in the header named by `mcpAccessKeyHeader` (default: `x-mcp-key`), or as query param `mcp_key`.

| Method | Path | Description |
|---|---|---|
| GET | `/:serverSlug` | Server manifest (MCP-compatible JSON) |
| GET | `/:serverSlug/tools` | List of enabled tools only (subset of manifest) |
| POST | `/:serverSlug/tools/:toolName` | Execute a tool (rate-limited) |
| POST | `/:serverSlug/tools/:toolName/test` | Execute a tool in test mode (logs tagged `test:`) |
| POST | `/:serverSlug/mcp` | MCP JSON-RPC 2.0 — primary MCP transport |
| GET | `/:serverSlug/mcp` | Server-sent event stream (SSE keep-alive channel) |
| DELETE | `/:serverSlug/mcp` | Session close (stateless, always 200) |

**GET /:serverSlug — response shape:**

```json
{
  "protocol": "mcp",
  "protocolVersion": "2024-11-05",
  "server": { "id", "name", "slug", "description", "version", "status", "metadata" },
  "endpoints": {
    "mcp": "https://host/my-server/mcp",
    "manifest": "https://host/my-server"
  },
  "capabilities": { "tools": { "listChanged": false } },
  "tools": [
    {
      "name": "get_user",
      "description": "...",
      "inputSchema": { /* JSON Schema */ },
      "method": "GET",
      "version": "1.0.0",
      "invokeUrl": "https://host/my-server/tools/get_user"
    }
  ]
}
```

**POST /:serverSlug/tools/:toolName — request body:**

Free-form JSON that matches the tool's `inputSchema`. Validated via Zod at runtime.

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "tool": "get_user",
    "server": "my-server",
    "result": { /* upstream response body */ },
    "durationMs": 142,
    "attempts": 1,
    "upstreamStatus": 200
  }
}
```

**POST /:serverSlug/mcp — MCP JSON-RPC request body:**

Single message or batch array. Follows JSON-RPC 2.0 envelope:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "get_user", "arguments": { "userId": "abc" } } }
```

**Supported MCP methods:**

| Method | Behaviour |
|---|---|
| `initialize` | Handshake; returns server info + capabilities |
| `ping` | Returns `{}` |
| `tools/list` | Returns all enabled tools for the server |
| `tools/call` | Executes the named tool via the execution engine |
| `prompts/list` | Returns `{ prompts: [] }` |
| `resources/list` | Returns `{ resources: [] }` |
| `resources/templates/list` | Returns `{ resourceTemplates: [] }` |
| `logging/setLevel` | No-op, returns `{}` |
| `notifications/*` | Silently ignored — no response (per JSON-RPC notification spec) |

If the client sends `Accept: text/event-stream`, the response is delivered as an SSE event instead of plain JSON.

---

## 7. Request Flow Walkthroughs

### 7.1 REST Tool Execution: `POST /:serverSlug/tools/:toolName`

```
Client
  │
  ├─ POST /my-server/tools/get_user  { userId: "123" }
  │
  ▼
rateLimiter (executionLimiter — 60 req/min by default)
  │
  ▼
toolService.getEnabledToolByServerSlugAndName("my-server", "get_user")
  ├─ cache.get("mcp:tool:my-server:get_user")  → HIT → return bundle
  └─ MISS → serverRepo.findBySlug("my-server", { activeOnly: true })
           → toolRepo.findByServerAndName(serverId, "get_user", { enabledOnly: true })
           → cache.set(key, { server, tool }, 60s)
  │
  ▼
executionEngine.executeTool({ server, tool, input: { userId: "123" }, requestId })
  │
  ├─ 1. validateInput(tool, input)
  │       zodFromJsonSchema(tool.inputSchema).safeParse(input)
  │       → throws 422 on failure (logged, rethrown)
  │
  ├─ 2. if tool.executionType === "echo" → return echoed input, record log, done
  │
  ├─ 3. resolveUrl(server, tool, input)
  │       tool.endpoint = "/users/{userId}"
  │       → templateString → "/users/123"
  │       → server.baseUrl + "/users/123"
  │       = "https://api.example.com/users/123"
  │
  ├─ 4. resolveTimeout, resolveRetries (from tool or env defaults)
  │
  ├─ 5. mergeHeaders(content-type, server.defaultHeaders, tool.headers, x-request-id)
  │
  ├─ 6. applyAuth(axiosConfig, server, tool)
  │       → resolveEffectiveAuth: tool.auth.type="inherit" → use server.auth
  │       → server.auth.type="bearer" → axiosConfig.headers.Authorization = "Bearer <token>"
  │       → if auth.secretEnvVar set → read from process.env instead of stored value
  │
  ├─ 7. requestWithRetry(axiosConfig, { retries, retryDelayMs: 300 })
  │       → axios(config)
  │       → on network failure, retry up to `retries` times
  │
  ├─ 8. truncate response body for log (EXECUTION_LOG_BODY_BYTES, default 8192)
  │      redact auth headers in log
  │      executionRepo.record(log)  ← always written, even on failure
  │
  └─ 9. if upstream status >= 400 → throw ApiError.badGateway (502)
         if timeout → throw ApiError.gatewayTimeout (504)
         else → return { status: "success", response, durationMs, attempts, statusCode }
  │
  ▼
success(res, { tool, server, result, durationMs, attempts, upstreamStatus }, "OK")
```

---

### 7.2 MCP JSON-RPC: `POST /:serverSlug/mcp`

```
MCP Client (e.g. Claude)
  │
  ├─ POST /my-server/mcp
  │   Headers: { "Content-Type": "application/json", "x-mcp-key": "client-key" }
  │   Body: { "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  │            "params": { "name": "get_user", "arguments": { "userId": "abc" } } }
  │
  ▼
resolveServer middleware
  ├─ validate slug format
  ├─ serverService.getServerBySlug("my-server", { activeOnly: true })
  │     → cache hit or DB lookup
  └─ attach to req.mcpServer
  │
  ▼
ipFilter middleware  (per-server)
  ├─ if req.mcpServer.mcpIpFilterEnabled is false → skip
  └─ check client IP against req.mcpServer.mcpAllowedIps → 403 if not in list
  │
  ▼
mcpAuth middleware
  ├─ if server.mcpAccessKey is null → skip
  └─ read key from header "x-mcp-key" (or query ?mcp_key)
       → constant-time compare (safeEqual)
       → 401 if missing, 403 if wrong
  │
  ▼
dispatchAndRespond
  ├─ if Array.isArray(body) → batch: Promise.all(dispatch each)
  └─ single: dispatcher.dispatch({ server, message, requestId })
  │
  ▼
dispatcher.dispatch()
  ├─ validate JSON-RPC 2.0 envelope
  ├─ if method starts with "notifications/" → return null (no response)
  └─ switch(method):
       "initialize"             → return server info + capabilities
       "ping"                   → return {}
       "tools/list"             → toolService.listEnabledToolsForServerSlug
                                   → return tools[] with name/description/inputSchema
       "tools/call"             → toolService.getEnabledToolByServerSlugAndName
                                   → executeTool(...)
                                   → wrap result as { content: [{ type: "text", text: "..." }] }
       "prompts/list" etc.      → return empty arrays
       unknown method           → rpcError(-32601 METHOD_NOT_FOUND)
  │
  ▼
if Accept: text/event-stream → SSE response
else → JSON response
```

---

### 7.3 Admin: Create Server + Tool

```
Admin Client
  │
  ├─ POST /api/v1/admin/servers
  │   Header: x-api-key: local-admin-key
  │   Body: { name: "Weather API", baseUrl: "https://weather.api.com", auth: { type: "apiKey", token: "abc", headerName: "X-API-Key" } }
  │
  ▼
adminAuth → verify x-api-key against ADMIN_API_KEYS
  │
  ▼
validate({ body: createSchema }) → Zod parse
  │
  ▼
mcpServerService.createServer(input)
  ├─ slugify("Weather API") → "weather-api"
  ├─ check slug uniqueness in DB
  ├─ mcpServerRepo.create({ ...input, slug })
  └─ cache.del("mcp:server:slug:weather-api")   ← pre-invalidate
  │
  ▼
201 Created: { data: { id, name, slug, auth: { type: "apiKey", token: "***" } } }

  ├─ POST /api/v1/admin/tools
  │   Body: { serverId: "<id>", name: "get_forecast", method: "GET",
  │           endpoint: "/forecast/{city}", inputSchema: { type: "object",
  │           properties: { city: { type: "string" } }, required: ["city"] } }
  │
  ▼
toolService.createTool(input)
  ├─ assertServerExists(serverId)
  ├─ check name uniqueness per server
  ├─ validate timeout against MAX_TOOL_TIMEOUT_MS
  ├─ toolRepo.create(...)
  └─ cache.delByPattern("mcp:tool:weather-api:*") + del("mcp:tools:weather-api")
  │
  ▼
201 Created
```

---

## 8. Authentication Systems

There are **three independent auth layers** in this system. They serve different purposes.

### 8.1 Admin API Key (`adminAuth`)

- **Scope:** All `/api/v1/admin/*` endpoints
- **Mechanism:** `x-api-key` header checked against `ADMIN_API_KEYS` (comma-separated env var)
- **In dev:** If `ADMIN_AUTH_ENABLED=false`, auth is skipped entirely
- **In prod:** App refuses to start if `ADMIN_AUTH_ENABLED=true` and `ADMIN_API_KEYS` is empty

### 8.2 MCP Access Key (`mcpAuth`)

- **Scope:** `/:serverSlug/mcp` endpoints (per-server, optional)
- **Mechanism:** If `McpServer.mcpAccessKey` is set, callers must provide it via:
  - Header: value of `McpServer.mcpAccessKeyHeader` (default `x-mcp-key`)
  - Or query param: `?mcp_key=<key>`
- Uses constant-time string comparison to prevent timing attacks
- No key set on server → auth skipped for that server

### 8.3 Upstream Auth Injection (`applyAuth`)

- **Scope:** Applied at execution time to every upstream HTTP call
- **Mechanism:** `auth.injector.js` resolves the effective auth config (tool overrides server if tool's `auth.type !== "inherit"`) and injects into the Axios config:

| Auth Type | What gets injected |
|---|---|
| `none` | Nothing |
| `bearer` | `Authorization: Bearer <token>` |
| `apiKey` | `<headerName>: <token>` (default header: `x-api-key`) |
| `basic` | Axios `auth: { username, password }` (→ `Authorization: Basic ...`) |

**Secret resolution order:** `secretEnvVar` → stored field value. If `secretEnvVar` is set, the secret is read from `process.env[secretEnvVar]` at call time — never stored in the token/password field.

---

## 9. Caching Layer

Redis caching is **optional** (`REDIS_ENABLED=false` by default). When disabled, all `cache.*` calls are no-ops and every lookup goes to MongoDB.

All keys are namespaced under `mcp:`.

| Cache Key | Value | TTL | Invalidated when |
|---|---|---|---|
| `mcp:server:slug:{slug}` | McpServer document | 60s | Server updated or deleted |
| `mcp:tool:{serverSlug}:{toolName}` | `{ server, tool }` bundle | 60s | Tool or its server updated/deleted |
| `mcp:tools:{serverSlug}` | `{ server, tools[] }` bundle | 60s | Any tool on server updated/deleted |

Cache misses fall through to MongoDB. Errors in Redis calls are caught and logged as warnings — they never cause a request to fail.

`delByPattern` uses Redis `SCAN` + pipeline `DEL` to atomically clear all tool keys for a server on invalidation.

---

## 10. Environment Variables

All variables are parsed and typed in [src/config/env.js](src/config/env.js). This file is the single source of truth — never read `process.env` directly anywhere else.

| Variable | Type | Default | Description |
|---|---|---|---|
| `NODE_ENV` | string | `"development"` | |
| `PORT` | integer | `4000` | HTTP server port |
| `API_PREFIX` | string | `"/api/v1"` | Prefix for all admin routes |
| `APP_NAME` | string | `"Dynamic MCP Platform"` | |
| `MONGO_URI` | string | `mongodb://localhost:27017/dynamic_mcp` | MongoDB connection string |
| `MONGO_DEBUG` | boolean | `false` | Enables Mongoose query logging |
| `REDIS_ENABLED` | boolean | `false` | Enable Redis caching |
| `REDIS_URL` | string | `redis://localhost:6379` | |
| `CACHE_TTL_SECONDS` | integer | `60` | Default Redis TTL |
| `CORS_ORIGINS` | comma-list | `["*"]` | Allowed CORS origins |
| `RATE_LIMIT_WINDOW_MS` | integer | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | integer | `300` | Max requests per window (general) |
| `EXEC_RATE_LIMIT_MAX` | integer | `60` | Max requests per window (tool execution) |
| `ADMIN_API_KEYS` | comma-list | `[]` | Valid admin API keys |
| `ADMIN_AUTH_ENABLED` | boolean | `true` | Set to `false` to disable in dev |
| `DEFAULT_TOOL_TIMEOUT_MS` | integer | `15000` | Default upstream call timeout |
| `DEFAULT_TOOL_RETRIES` | integer | `0` | Default retry count |
| `MAX_TOOL_TIMEOUT_MS` | integer | `120000` | Hard cap on any tool's timeout |
| `LOG_LEVEL` | string | `"info"` | Winston log level |
| `EXECUTION_LOG_BODY_BYTES` | integer | `8192` | Max bytes stored in execution log body fields |
| `SWAGGER_ENABLED` | boolean | `true` | Serve Swagger UI at `/docs` |

**Startup safety check:** In production (`NODE_ENV=production`), if `ADMIN_AUTH_ENABLED=true` and `ADMIN_API_KEYS` is empty, the process exits immediately with a fatal log.
