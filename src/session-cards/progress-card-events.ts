import { resolveGlobalSet } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";

type ProgressCardReset = { agentId: string; sessionKey: string };
const listeners = resolveGlobalSet<(event: ProgressCardReset) => void>(
  Symbol.for("openclaw.progressCardResetListeners"),
  "close-and-restart",
);

export function onProgressCardReset(listener: (event: ProgressCardReset) => void): () => void {
  return registerListener(listeners, listener);
}

/** Reset owners publish only after their card and context changes commit together. */
export function emitProgressCardReset(event: ProgressCardReset): void {
  notifyListeners(listeners, event);
}
