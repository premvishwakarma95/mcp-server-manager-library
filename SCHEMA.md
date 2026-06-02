# Database Schema

MongoDB database with 3 collections.

---

## Collections Overview

| Collection | Purpose |
|---|---|
| `mcp_servers` | One registered API integration (e.g. GitHub, Stripe) |
| `mcp_tools` | One callable endpoint belonging to a server |
| `tool_execution_logs` | Audit log — one record per tool call |

---

## mcp_servers

One document = one API you want to expose via MCP.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto-generated MongoDB ID |
| `name` | String | Human label, e.g. `"GitHub API"` |
| `slug` | String | **Unique.** URL-safe name used in all routes, e.g. `github-api` |
| `description` | String | Optional. Max 2000 chars |
| `status` | `"active"` \| `"inactive"` | Inactive servers are hidden from all routes |
| `baseUrl` | String | Root URL of the upstream API, e.g. `https://api.github.com` |
| `defaultHeaders` | Object | Headers sent on every tool request from this server |
| `auth.type` | `"none"` \| `"bearer"` \| `"apiKey"` \| `"basic"` | How to authenticate against the upstream API |
| `auth.token` | String | Bearer token or API key value. Masked as `***` in API responses |
| `auth.headerName` | String | Header name when using `apiKey` auth, e.g. `X-Api-Key` |
| `auth.username` | String | For `basic` auth |
| `auth.password` | String | For `basic` auth. Masked as `***` in API responses |
| `auth.secretEnvVar` | String | Env var name to read the secret from at runtime, e.g. `GITHUB_TOKEN` |
| `mcpAccessKey` | String | Optional password MCP clients must send to reach `/:slug/mcp` |
| `mcpAccessKeyHeader` | String | Header name for the access key. Default: `x-mcp-key` |
| `mcpIpFilterEnabled` | Boolean | If `true`, only IPs in `mcpAllowedIps` can reach this server's `/:slug/mcp` |
| `mcpAllowedIps` | String[] | Per-server IP allowlist, e.g. `["1.2.3.4"]`. Empty + enabled = block all |
| `metadata` | Object | Free-form extra data |
| `version` | String | Default: `1.0.0` |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Indexes:** `slug` (unique), `{ status, slug }`, text search on `name + description`

---

## mcp_tools

One document = one tool (one API endpoint) on a server.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto-generated MongoDB ID |
| `serverId` | ObjectId | **Foreign key → mcp_servers._id** |
| `name` | String | Tool identifier. **Unique per server.** e.g. `get_user` |
| `description` | String | Shown to Claude as the tool description |
| `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | HTTP method for the upstream call |
| `endpoint` | String | Path or full URL. Supports `{placeholder}` from input, e.g. `/users/{userId}` |
| `headers` | Object | Per-tool headers, merged on top of server `defaultHeaders` |
| `queryParams` | Object | Static query params always appended to the request |
| `inputSchema` | Object | JSON Schema — defines what input Claude must provide. Validated at runtime |
| `outputSchema` | Object | JSON Schema for the response. Advisory only, not enforced |
| `executionType` | `"http"` \| `"echo"` | `http` = real API call. `echo` = reflect input back (for testing) |
| `timeout` | Number | Per-call timeout in milliseconds. `null` = use server default |
| `retries` | Number | 0–5 retries on failure with exponential backoff |
| `enabled` | Boolean | `false` = soft-deleted, hidden from Claude and all routes |
| `auth.type` | `"inherit"` \| `"none"` \| `"bearer"` \| `"apiKey"` \| `"basic"` | `inherit` = use server auth. Anything else overrides it |
| `auth.token` | String | Override token. Masked as `***` in responses |
| `auth.headerName` | String | Override header name for `apiKey` |
| `auth.username` | String | Override username for `basic` |
| `auth.password` | String | Override password. Masked as `***` in responses |
| `auth.secretEnvVar` | String | Env var name to read the secret from at runtime |
| `metadata` | Object | Free-form extra data |
| `version` | String | Default: `1.0.0` |
| `createdAt` | Date | Auto |
| `updatedAt` | Date | Auto |

**Indexes:** `{ serverId, name }` (unique), `{ serverId, enabled }`

---

## tool_execution_logs

Append-only. One document written per tool call. Never updated.

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | Auto-generated |
| `serverId` | ObjectId | Reference to the server |
| `toolId` | ObjectId | Reference to the tool |
| `serverSlug` | String | Copied from server at call time — stays readable if server is renamed |
| `toolName` | String | Copied from tool at call time — same reason |
| `requestId` | String | HTTP request ID for tracing |
| `request.method` | String | HTTP method used for the upstream call |
| `request.url` | String | Full resolved URL sent to upstream |
| `request.headers` | Object | Outgoing headers. Auth values replaced with `***` |
| `request.query` | Object | Query params sent |
| `request.body` | Mixed | Request body sent |
| `response.status` | Number | HTTP status from upstream, e.g. `200`, `404`, `500` |
| `response.headers` | Object | Upstream response headers. Sensitive values redacted |
| `response.body` | Mixed | Upstream response body. Truncated if over 8192 bytes |
| `response.bodyTruncated` | Boolean | `true` if body was cut off |
| `status` | String | Outcome: `success` / `validation_error` / `upstream_error` / `timeout` / `internal_error` |
| `attempts` | Number | Total attempts made (1 = no retry needed) |
| `durationMs` | Number | Total time from start to finish including retries |
| `error.message` | String | Human-readable error (only on failure) |
| `error.code` | String | Machine-readable code, e.g. `ECONNRESET` |
| `error.details` | Mixed | Stack trace or upstream error body |
| `createdAt` | Date | Auto. No `updatedAt` — logs are never modified |

**Indexes:** All time-based, sorted `createdAt DESC`, filtered by `serverId`, `toolId`, `status`

---

## Relationships

```
mcp_servers  (1)
    │
    ├──── mcp_tools  (many)               serverId → mcp_servers._id
    │         │
    │         └──── tool_execution_logs   toolId   → mcp_tools._id
    │
    └──── tool_execution_logs  (many)     serverId → mcp_servers._id
```

---

## Key Rules

- A tool **name must be unique within its server** — two different servers can have a tool named `get_user`, but one server cannot.
- `auth.secretEnvVar` is preferred over storing raw tokens — set the secret as an env var on the server, store only the variable name in the DB.
- Raw secrets (`auth.token`, `auth.password`, `mcpAccessKey`) are always masked as `***` in any API response.
- Disabling a tool (`enabled: false`) hides it from Claude and the manifest without deleting it.
- Execution logs are never deleted or updated — they are a permanent audit trail.
- IP filtering is **per server**: configure `mcpIpFilterEnabled` + `mcpAllowedIps` on each server individually. There is no platform-wide IP allowlist.
