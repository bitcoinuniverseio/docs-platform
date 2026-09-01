# docs-mcp

A read-only Model Context Protocol server over the public Bitcoin Universe
documentation estate.

It exists so an assistant can answer "does Core let me buy a Rune" with the
recorded reason rather than a guess. Every answer carries the exact commit its
capability data came from.

## Run it

```bash
node services/docs-mcp/bin/server.mjs
```

It speaks MCP over stdio as newline-delimited JSON-RPC 2.0, has no dependencies
beyond the workspace registry, and makes no network calls.

Register it with an MCP client:

```json
{
  "mcpServers": {
    "universe-docs": {
      "command": "node",
      "args": ["services/docs-mcp/bin/server.mjs"]
    }
  }
}
```

## Tools

| Tool | What it answers |
| --- | --- |
| `search_documentation` | Find a protocol, product, or chain by name, alias, ticker, carrier, or purpose |
| `list_catalog` | Everything in the estate, to discover ids |
| `get_protocol` | Full dossier, including the reason for every unimplemented action |
| `get_product` | A product and the protocols it implements, with per-protocol actions |
| `get_capability` | Whether a specific action works for a specific protocol, and why not |
| `get_chain` | Chain and network definitions, block target, finality wording |
| `get_interfaces` | Every API, schema, specification, CLI, and SDK, pinned to a commit |
| `get_documentation_health` | Which repositories are wired into the portal and what the rest are missing |

## What it will not do

It is read-only by construction: there is no write path and no private repository
access. It reads only the committed registry in `packages/ecosystem-registry`.

It does not replace project documentation. Each project's own site is the
authority for its subject, so answers point there rather than restating it.

It never conflates two different claims. Capability data says what product code
implements; whether that is switched on in production is a separate question
answered at `/status/live/`. `get_capability` says so in every response.

It also keeps creation separate from trading. Runes are read-only in the Core
marketplace and still etchable in Inscribe, so asking whether you can `buy` a Rune
and whether you can `etch` one give different answers on purpose. A test holds
that distinction.

## Test

```bash
node services/docs-mcp/test/server.test.mjs
```

The suite covers the tool behaviour and a real stdio round trip against the
spawned server, including that a notification produces no response.
