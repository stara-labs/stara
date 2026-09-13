# Stara MCP scaffold

This local MCP server exposes Stara's existing HTTP API through stdio. It uses
the [official TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server).
It runs as a separate process within `@stara/api`; the HTTP service does not
start an MCP listener. Both entrypoints compile with the normal API build and
participate in the API package's existing tests, coverage, and gates.

## Run and connect

From the repository root, install the workspace and start Stara using the
[setup guide](../../docs/setup.md), then compile the MCP entrypoint:

```sh
pnpm --filter @stara/api build
```

Configure a stdio-capable MCP client to launch Node directly. Replace the
example absolute path with this checkout's location:

```json
{
  "mcpServers": {
    "stara": {
      "command": "node",
      "args": ["C:/code/stara/stara/backend/api/dist/mcp/index.js"],
      "env": {
        "STARA_API_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

Client configuration formats vary; the command, arguments, and environment
above are the launch contract. Use the pinned Node version in `.node-version`.
Launch Node directly from clients so package-manager banners cannot enter the
JSON-RPC stream. For terminal development, `pnpm --filter @stara/api mcp:dev`
runs the TypeScript entrypoint; `mcp:start` runs its compiled output. These
commands wait for MCP input and do not display a web interface.

`STARA_API_URL` defaults to `http://127.0.0.1:3000`. An override must be an HTTP
origin using `127.0.0.1` or `[::1]`, with an optional port. Hostnames (including
`localhost`), credentials, paths other than `/`, queries, and fragments are
rejected. Set the port to match `STARA_API_PORT` if startup uses an alternate
port. Configuration comes from the process environment, without dotenv loading.

## Available tools

| Tool                       | API                       | Successful structured result                                   |
| -------------------------- | ------------------------- | -------------------------------------------------------------- |
| `stara_get_health`         | `GET /api/health`         | `{"status":"ok"}`                                              |
| `stara_get_runtime_config` | `GET /api/runtime-config` | `{"schemaVersion":1,"environment":"development"}` or `staging` |

Both tools accept empty or omitted arguments and reject extra arguments. They
declare read-only, non-destructive, idempotent annotations, return JSON text and
structured content, and declare output schemas. Health establishes only that
the HTTP handler answers; it does not establish product health or readiness.

Discovery works while the HTTP API is offline. Calls fail with `isError: true`
when the API is unavailable, times out, redirects, or returns an invalid
response. Requests have a five-second deadline and propagate MCP cancellation.
Responses retain only public schema fields. Raw exceptions and upstream bodies
are not returned in diagnostics. Startup errors go to stderr and exit nonzero;
stdout is reserved for MCP messages.

## Extend the scaffold

`src/mcp/server.ts` owns the transport-independent server factory and tool
registration. `src/mcp/config.ts` validates the operator-selected API origin.
`src/mcp/index.ts` connects stdio. Add new tools alongside these registrations
when a corresponding product API and its behavior contract exist; test the
protocol response and real HTTP interaction. Keep authorization in the product
service when authenticated operations arrive.

Work items and conversations currently exist as synthetic UI fixtures. This
server does not expose them as live records or provide persistence, writes,
agent execution, authentication, remote MCP hosting, or deployment. No global
client configuration is installed by the scaffold.

## Verify

```sh
pnpm --filter @stara/api typecheck
pnpm --filter @stara/api test:coverage
pnpm --filter @stara/api build
```

The MCP tests cover discovery, schemas, input rejection, output allowlisting,
API errors, configuration, entrypoint behavior, redirects, a compiled stdio
client-to-server journey against real loopback HTTP, and process exit on EOF
or invalid configuration. Test API data is synthetic and customer-independent.
Full API coverage includes the MCP source with no exclusions.
