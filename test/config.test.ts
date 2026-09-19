import { describe, expect, it } from "vitest";
import {
  buildAuthenticatedWsUrl,
  loadConfig,
  normalizeWsUrl,
} from "../src/config.js";

describe("normalizeWsUrl", () => {
  it("appends /ws when missing", () => {
    expect(normalizeWsUrl("ws://127.0.0.1:2419")).toBe("ws://127.0.0.1:2419/ws");
  });

  it("keeps existing /ws", () => {
    expect(normalizeWsUrl("ws://127.0.0.1:2419/ws")).toBe("ws://127.0.0.1:2419/ws");
  });

  it("strips trailing slashes before appending", () => {
    expect(normalizeWsUrl("ws://127.0.0.1:2419/")).toBe("ws://127.0.0.1:2419/ws");
  });
});

describe("buildAuthenticatedWsUrl", () => {
  it("adds server-key query param", () => {
    const url = buildAuthenticatedWsUrl("ws://127.0.0.1:2419/ws", "s3cret");
    expect(url).toContain("server-key=s3cret");
    expect(url.startsWith("ws://127.0.0.1:2419/ws")).toBe(true);
  });
});

describe("loadConfig", () => {
  it("requires GROK_AGENT_SECRET", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/GROK_AGENT_SECRET/);
  });

  it("loads defaults", () => {
    const cfg = loadConfig({
      GROK_AGENT_SECRET: "tok",
    } as NodeJS.ProcessEnv);
    expect(cfg.secret).toBe("tok");
    expect(cfg.wsUrl).toBe("ws://127.0.0.1:2419/ws");
    expect(cfg.cwd).toBeTruthy();
  });
});
