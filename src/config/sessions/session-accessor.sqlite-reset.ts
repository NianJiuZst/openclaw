import { emitProgressCardReset } from "../../session-cards/progress-card-events.js";
import {
  readSessionProgressCard,
  writeSessionProgressCard,
} from "../../session-cards/progress-card-store.js";
import {
  deferOpenClawAgentPostCommitPublication,
  type OpenClawAgentDatabase,
} from "../../state/openclaw-agent-db.js";
import type { SessionResetBoundaryWrite } from "./session-accessor.lifecycle-types.js";
import { loadTranscriptEventsFromDatabase } from "./session-accessor.sqlite-read.js";
import type { ResolvedTranscriptScope } from "./session-accessor.sqlite-scope.js";
import {
  appendTranscriptEventsInTransaction,
  ensureTranscriptHeader,
} from "./session-accessor.sqlite-transcript-store.js";
import { buildSessionResetBoundaryEvent } from "./session-reset-boundary-event.js";
import { resolveResetBoundaryHeaderCwd } from "./transcript-header.js";
import type { InternalSessionEntry } from "./types.js";

export function appendSessionResetBoundaryInTransaction(
  database: OpenClawAgentDatabase,
  scope: ResolvedTranscriptScope,
  entry: InternalSessionEntry,
  boundary: SessionResetBoundaryWrite,
): void {
  // Reset may be the first append; initialize its header in the same guarded
  // transaction so the resulting transcript is readable even before another turn.
  ensureTranscriptHeader(database, scope, resolveResetBoundaryHeaderCwd(entry, boundary.cwd));
  const event = buildSessionResetBoundaryEvent({
    events: loadTranscriptEventsFromDatabase(database, scope.sessionId, {
      projection: "reset-boundary",
    }),
    ...boundary,
  });
  if (appendTranscriptEventsInTransaction(database, scope, [event]) !== 1) {
    throw new Error(`Failed to append reset boundary for ${scope.sessionKey}`);
  }
  // Explicit context clearing retires the task card atomically with the reset.
  // Continuity resets preserve it; unused stores must not gain a companion table.
  if (boundary.context === "clear" && readSessionProgressCard(database.db, scope.sessionKey)) {
    writeSessionProgressCard(database.db, scope.sessionKey, {});
    deferOpenClawAgentPostCommitPublication(database, () =>
      emitProgressCardReset({ agentId: scope.agentId, sessionKey: scope.sessionKey }),
    );
  }
}
