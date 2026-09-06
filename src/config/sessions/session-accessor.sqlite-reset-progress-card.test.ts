import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onProgressCardReset } from "../../session-cards/progress-card-events.js";
import {
  readSessionProgressCard,
  writeSessionProgressCard,
} from "../../session-cards/progress-card-store.js";
import {
  closeOpenClawAgentDatabasesForTest,
  openOpenClawAgentDatabase,
} from "../../state/openclaw-agent-db.js";
import {
  createOpenClawTestState,
  type OpenClawTestState,
} from "../../test-utils/openclaw-test-state.js";
import {
  applySessionEntryLifecycleMutation,
  loadSessionEntry,
  loadTranscriptEvents,
  replaceSessionEntry,
  resetSessionEntryLifecycle,
} from "./session-accessor.js";
import type { SessionResetBoundaryRequest } from "./session-reset-boundary-event.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";

describe("SQLite reset progress-card lifecycle", () => {
  let testState: OpenClawTestState;
  let storePath: string;
  let stopObserving: () => void;
  const observedReset = vi.fn();
  const sessionKey = "agent:main:reset-progress";
  const sessionId = "reset-progress-window";
  const initialEntry = { sessionId, updatedAt: 10, lifecycleRevision: "original" };

  beforeEach(async () => {
    testState = await createOpenClawTestState({
      prefix: "openclaw-reset-progress-",
      layout: "state-only",
    });
    fs.mkdirSync(testState.sessionsDir(), { recursive: true });
    storePath = path.join(testState.sessionsDir(), "sessions.json");
    await replaceSessionEntry({ sessionKey, storePath }, initialEntry);
    observedReset.mockReset();
    stopObserving = onProgressCardReset((event) => {
      observedReset(event, readSessionProgressCard(database().db, sessionKey));
    });
  });

  afterEach(async () => {
    stopObserving();
    closeOpenClawAgentDatabasesForTest();
    await testState.cleanup();
  });

  function database() {
    const target = resolveSqliteTargetFromSessionStorePath(storePath);
    if (!target.path) {
      throw new Error("expected SQLite database path");
    }
    return openOpenClawAgentDatabase({ agentId: target.agentId ?? "main", path: target.path });
  }

  async function reset(kind: "single" | "projection", boundary: SessionResetBoundaryRequest) {
    const entry = { sessionId, updatedAt: 20, lifecycleRevision: "reset" };
    if (kind === "single") {
      return resetSessionEntryLifecycle({
        storePath,
        target: { canonicalKey: sessionKey, storeKeys: [sessionKey] },
        resetBoundary: { ...boundary, cwd: "/tmp/reset-progress-workspace" },
        buildNextEntry: () => entry,
      });
    }
    return applySessionEntryLifecycleMutation({
      storePath,
      upserts: [
        { sessionKey, entry, resetBoundary: { ...boundary, cwd: "/tmp/reset-progress-workspace" } },
      ],
      skipMaintenance: true,
    });
  }

  it.each(
    (["single", "projection"] as const).flatMap((kind) =>
      [
        { shape: "markdown", input: { markdown: "Previous work" } },
        {
          shape: "active plan",
          input: { steps: [{ step: "Previous task", status: "in_progress" as const }] },
        },
        {
          shape: "completed plan and markdown",
          input: {
            markdown: "Previous work",
            steps: [{ step: "Previous task", status: "completed" as const }],
          },
        },
      ].map(({ shape, input }) => ({ kind, shape, input })),
    ),
  )(
    "clears $shape through $kind reset and preserves revision ordering after reopen",
    async ({ kind, input }) => {
      const db = database();
      writeSessionProgressCard(db.db, sessionKey, input);
      await replaceSessionEntry(
        { sessionKey: "agent:main:other-progress", storePath },
        { sessionId: "other-window", updatedAt: 10 },
      );
      writeSessionProgressCard(db.db, "agent:main:other-progress", { markdown: "Other task" });

      await reset(kind, { context: "clear", reason: "reset" });

      expect(observedReset).toHaveBeenCalledExactlyOnceWith({ agentId: "main", sessionKey }, null);
      closeOpenClawAgentDatabasesForTest();
      const reopened = database();
      expect(readSessionProgressCard(reopened.db, sessionKey)).toBeNull();
      expect(readSessionProgressCard(reopened.db, "agent:main:other-progress")?.markdown).toBe(
        "Other task",
      );
      const replacement = writeSessionProgressCard(reopened.db, sessionKey, {
        steps: [{ step: "New task", status: "completed" }],
      });
      expect(replacement).toMatchObject({ card: { revision: 3 } });
      expect(writeSessionProgressCard(reopened.db, sessionKey, { expectedRevision: 1 })).toEqual(
        replacement,
      );
    },
  );

  it.each(["single", "projection"] as const)(
    "does not provision progress-card storage for a %s reset without a card",
    async (kind) => {
      database().db.exec("DROP TABLE IF EXISTS session_progress_cards");
      await reset(kind, { context: "clear", reason: "new" });
      expect(
        database()
          .db.prepare("SELECT name FROM sqlite_master WHERE name = 'session_progress_cards'")
          .get(),
      ).toBeUndefined();
      expect(observedReset).not.toHaveBeenCalled();
    },
  );

  it.each(["single", "projection"] as const)(
    "preserves the card across a %s continuity reset",
    async (kind) => {
      writeSessionProgressCard(database().db, sessionKey, {
        markdown: "Work continues",
        steps: [{ step: "Finish task", status: "in_progress" }],
      });
      const before = readSessionProgressCard(database().db, sessionKey);
      await reset(kind, { context: "preserve-tail", reason: "idle" });
      expect(readSessionProgressCard(database().db, sessionKey)).toEqual(before);
      expect(observedReset).not.toHaveBeenCalled();
    },
  );

  it.each(["single", "projection"] as const)(
    "rolls back the card together with a failed %s reset",
    async (kind) => {
      const db = database();
      writeSessionProgressCard(db.db, sessionKey, { markdown: "Uncommitted reset" });
      const before = readSessionProgressCard(db.db, sessionKey);
      // Fail the entry write after the boundary append, inside the same transaction.
      db.db.exec(`CREATE TEMP TRIGGER reject_reset BEFORE UPDATE OF entry_json ON session_nodes
        BEGIN SELECT RAISE(ABORT, 'injected reset commit failure'); END;`);
      try {
        await expect(reset(kind, { context: "clear", reason: "new" })).rejects.toThrow(
          "injected reset commit failure",
        );
      } finally {
        db.db.exec("DROP TRIGGER reject_reset");
      }
      expect(readSessionProgressCard(db.db, sessionKey)).toEqual(before);
      expect(observedReset).not.toHaveBeenCalled();
      expect(loadSessionEntry({ sessionKey, storePath })).toMatchObject(initialEntry);
      expect(await loadTranscriptEvents({ sessionKey, sessionId, storePath })).not.toContainEqual(
        expect.objectContaining({ type: "reset" }),
      );
    },
  );
});
