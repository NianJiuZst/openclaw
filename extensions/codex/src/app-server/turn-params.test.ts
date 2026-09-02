import type { EmbeddedRunAttemptParamsV2 as EmbeddedRunAttemptParams } from "openclaw/plugin-sdk/agent-harness-runtime";
import { describe, expect, it } from "vitest";
import { resolveCodexAppServerRuntimeOptions } from "./config.js";
import { buildTurnStartParams } from "./turn-params.js";

const appServer = resolveCodexAppServerRuntimeOptions({ env: {}, requirementsToml: null });

describe("buildTurnStartParams temporal context", () => {
  it("uses the configured user timezone on every turn without changing cron input", () => {
    const params = {
      provider: "openai",
      modelId: "gpt-5.4",
      prompt: "run exactly",
      trigger: "cron",
      bootstrapContextMode: "lightweight",
      bootstrapContextRunKind: "cron",
      startedAtMs: Date.parse("2026-09-02T00:30:00.000Z"),
      config: { agents: { defaults: { userTimezone: "America/Los_Angeles" } } },
    } as EmbeddedRunAttemptParams;
    const options = {
      threadId: "thread-1",
      cwd: "/repo",
      appServer,
    };

    const firstTurn = buildTurnStartParams(params, options);
    expect(firstTurn.input).toEqual([{ type: "text", text: "run exactly", text_elements: [] }]);
    expect(firstTurn.additionalContext).toEqual({
      openclaw_temporal_context: {
        kind: "application",
        value: "## Temporal Context\nCurrent date: 2026-09-01\nTime zone: America/Los_Angeles",
      },
    });

    const nextTurn = buildTurnStartParams(
      {
        ...params,
        startedAtMs: Date.parse("2026-09-03T00:30:00.000Z"),
      } as EmbeddedRunAttemptParams,
      options,
    );
    expect(nextTurn.input).toEqual(firstTurn.input);
    expect(nextTurn.additionalContext?.openclaw_temporal_context?.value).toContain(
      "Current date: 2026-09-02",
    );
  });

  it("emits the host fallback after a timezone override is removed", () => {
    const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";
    const options = {
      threadId: "thread-1",
      cwd: "/repo",
      appServer,
    };
    const configured = buildTurnStartParams(
      {
        provider: "openai",
        modelId: "gpt-5.4",
        prompt: "test prompt",
        startedAtMs: Date.parse("2026-09-02T00:30:00.000Z"),
        config: { agents: { defaults: { userTimezone: "America/Los_Angeles" } } },
      } as EmbeddedRunAttemptParams,
      options,
    );
    const fallback = buildTurnStartParams(
      {
        provider: "openai",
        modelId: "gpt-5.4",
        prompt: "test prompt",
        startedAtMs: Date.parse("2026-09-02T00:30:00.000Z"),
      } as EmbeddedRunAttemptParams,
      options,
    );

    expect(configured.additionalContext?.openclaw_temporal_context?.value).toContain(
      "Current date: 2026-09-01",
    );
    expect(fallback.additionalContext?.openclaw_temporal_context?.value).toContain(
      `Time zone: ${hostTimezone}`,
    );
  });
});
