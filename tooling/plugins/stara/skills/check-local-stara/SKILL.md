---
name: check-local-stara
description: Check a locally running Stara API through its MCP health and public runtime configuration tools, and explain connection failures. Use for local Stara connectivity or environment checks.
---

# Check local Stara

Use the plugin's `stara_get_health` and `stara_get_runtime_config` MCP tools.
Both take empty or omitted arguments. Report their results separately:

- Health `{ "status": "ok" }` means the HTTP handler answered. It does not
  establish dependency readiness, product health, or a successful deployment.
- Runtime configuration supplies only `schemaVersion: 1` and `environment`,
  which is `development` or `staging`. A local `staging` value is a configuration
  label, not evidence that the hosted staging deployment was contacted.

If a tool returns `isError`, report the failed check. For a requested diagnosis,
check that the user-selected local API is running and that `STARA_API_URL`
matches its loopback port. The default is `http://127.0.0.1:3000`; only HTTP
origins using `127.0.0.1` or `[::1]` are supported. Remote hosts, credentials,
queries and redirects are rejected by the existing server. Do not replace a
failed call with a guessed result or a different API origin.

If the MCP tools are missing, consult [plugin setup](../../README.md). The
plugin requires a built, trusted Stara checkout matching its packaged binding
and `STARA_REPO_ROOT`. A different checkout needs a fresh configured copy from
that checkout's setup helper.
It does not start or build the HTTP API automatically.

Stara currently uses synthetic UI fixtures. These two tools cannot read or
create work items, conversations, client records, legal documents, persistent
data, or execute agents. Explain that limitation when asked for those actions;
do not describe fixtures as live business data.
