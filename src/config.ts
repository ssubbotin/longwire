import { resolve } from "node:path";

export interface LongwireConfig {
  /** Base or full WebSocket URL (with or without /ws). */
  wsUrl: string;
  /** Shared secret matching grok agent --secret / GROK_AGENT_SECRET. */
  secret: string;
  /** Default cwd for session/new and session/load. */
  cwd: string;
}

/**
 * Normalize agent WS URL.
 * grok agent serve listens on ws://host:port/ws — append /ws when missing.
 */
export function normalizeWsUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/ws")) {
    return trimmed;
  }
  return `${trimmed}/ws`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LongwireConfig {
  const secret = (env.GROK_AGENT_SECRET ?? "").trim();
  if (!secret) {
    throw new Error(
      "GROK_AGENT_SECRET is required. Start the agent with " +
        "`grok agent --always-approve serve --bind 127.0.0.1:2419 --secret <token>` " +
        "and set the same token in GROK_AGENT_SECRET.",
    );
  }

  const wsUrl = normalizeWsUrl(
    (env.GROK_AGENT_WS_URL ?? "ws://127.0.0.1:2419").trim(),
  );
  const cwdRaw = (env.GROK_AGENT_CWD ?? ".").trim() || ".";
  const cwd = resolve(cwdRaw);

  return { wsUrl, secret, cwd };
}

/**
 * Build the authenticated WebSocket URL.
 * Grok serve accepts Authorization: Bearer OR ?server-key= (browser-friendly).
 * We put the secret in the query string so `ws` clients that cannot set headers
 * still work; connect() also sends the Bearer header when possible.
 */
export function buildAuthenticatedWsUrl(wsUrl: string, secret: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("server-key", secret);
  return url.toString();
}
