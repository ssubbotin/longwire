# longwire

MCP (Model Context Protocol) server that bridges **remote MCP clients** (Cursor, Grok Bot, Claude Desktop, etc.) to a **locally running [Grok Build](https://docs.x.ai/build/overview) agent** over ACP (Agent Client Protocol) WebSocket.

```
Remote MCP client  --stdio MCP-->  longwire  --WebSocket ACP-->  grok agent serve
```

## What it is / isn't

**Is**

- A thin MCP↔ACP bridge: create/load sessions, prompt, cancel, status
- Runs on your machine next to `grok agent serve`
- Speaks stdio MCP so any MCP-capable host can drive your local agent

**Isn't**

- Not a hosted Grok cloud sandbox / Grok Bot replacement
- Not a web UI (see [grok-remote](https://github.com/daniel-farina/grok-remote) for a Tailscale web UI)
- Not a substitute for `grok -p` one-shot headless prompts

## Prerequisites

- Node.js 20+
- [Grok CLI](https://docs.x.ai/build/overview) installed and authenticated (`curl -fsSL https://x.ai/cli/install.sh | bash`)
- A shared secret for serve auth

## Quickstart

### 1. Start the local agent

```bash
grok agent --always-approve serve --bind 127.0.0.1:2419 --secret <token>
```

The agent listens at `ws://127.0.0.1:2419/ws`. Clients authenticate with:

- `Authorization: Bearer <token>` (preferred), and/or
- `?server-key=<token>` query parameter

You can also set `GROK_AGENT_SECRET` instead of passing `--secret`.

### 2. Configure longwire

```bash
git clone https://github.com/ssubbotin/longwire.git
cd longwire
npm install
cp .env.example .env
# edit .env — set GROK_AGENT_SECRET to the same <token>
```

Environment variables:

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `GROK_AGENT_WS_URL` | `ws://127.0.0.1:2419` | `/ws` is appended if missing |
| `GROK_AGENT_SECRET` | *(required)* | Must match agent `--secret` |
| `GROK_AGENT_CWD` | `.` | Default cwd for new sessions |

### 3. Wire into Cursor (`mcp.json`)

```json
{
  "mcpServers": {
    "longwire": {
      "command": "node",
      "args": ["/absolute/path/to/longwire/dist/index.js"],
      "env": {
        "GROK_AGENT_WS_URL": "ws://127.0.0.1:2419",
        "GROK_AGENT_SECRET": "<token>",
        "GROK_AGENT_CWD": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Build first with `npm run build` (or use `npx tsx src/index.ts` for development).

### 4. Typical tool flow

1. `grok_status` — confirm connected
2. `grok_session_create` — get `sessionId`
3. `grok_prompt` — send work; wait for aggregated text + tool-call summary
4. `grok_cancel` — abort an in-flight turn (`session/cancel` notification)
5. `grok_session_load` — resume an existing session id

## MCP tools

| Tool | ACP method | Description |
| ---- | ---------- | ----------- |
| `grok_session_create` | `session/new` | Create session; returns `sessionId` |
| `grok_session_load` | `session/load` | Load/resume session |
| `grok_prompt` | `session/prompt` | Wait for turn completion; return text + tool summary; optional `includeThoughts` |
| `grok_cancel` | `session/cancel` | Cancel in-flight turn (notification) |
| `grok_status` | *(local)* | `connected`, `sessionIds`, `lastError`, `wsUrl` |

## Reaching your laptop from cloud bots

MCP hosts that run in the cloud cannot see `127.0.0.1` on your laptop. Expose the agent (or longwire) through a private tunnel:

| Option | Idea | Notes |
| ------ | ---- | ----- |
| **Tailscale** | Put laptop + bot on a tailnet; point `GROK_AGENT_WS_URL` at `ws://100.x.y.z:2419` | Prefer bind to Tailscale IP or use subnet routing; keep `--secret` strong |
| **SSH tunnel** | `ssh -N -L 2419:127.0.0.1:2419 user@laptop` from the bot host | Simple; requires SSH access |
| **ngrok / similar** | TCP or HTTP tunnel to `2419` | Treat the public URL as hostile — rotate secrets, restrict CIDRs if possible |

### Security

- **Never commit** `.env` or real secrets.
- Prefer **private** networks (Tailscale) over public ingress.
- The serve secret is a **bearer token**: anyone who has it can drive the agent (tools, filesystem under the agent cwd).
- Keep `grok agent serve` on `127.0.0.1` unless you intentionally expose it; use `--always-approve` only when you trust the clients.
- longwire itself speaks MCP over stdio to the local host process — protect that host the same way you protect any developer machine agent.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm start   # stdio MCP server (expects env set)
```

CI definition: [`ci/github-actions.yml`](./ci/github-actions.yml) (typecheck + test + build on Node 20/22).
See [`docs/CI.md`](./docs/CI.md) to enable GitHub Actions (requires `workflow` OAuth scope to place the file under `.github/workflows/`).

## Protocol notes

- Transport: WebSocket + ACP JSON-RPC ([agentclientprotocol.com](https://agentclientprotocol.com))
- Docs: [Grok agent mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md), [Grok Build overview](https://docs.x.ai/build/overview)
- Auth scheme verified against `xai-org/grok-build` `server.rs`: Bearer header **or** `server-key` query param on `/ws`

## Roadmap

- [ ] Optional permission proxy for non-`--always-approve` sessions (`session/request_permission`)
- [ ] Streaming MCP notifications for mid-turn `session/update` chunks
- [ ] Auto-reconnect + `session/resume` after WS drops
- [ ] npm package publish + `npx longwire`
- [ ] Multi-agent / multi-cwd profiles

## License

MIT — see [LICENSE](./LICENSE).
