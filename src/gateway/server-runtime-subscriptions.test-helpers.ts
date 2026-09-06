import { vi } from "vitest";
import type { SubsystemLogger } from "../logging/subsystem.js";
import {
  createChatRunState,
  createSessionEventSubscriberRegistry,
  createSessionMessageSubscriberRegistry,
} from "./server-chat-state.js";
import type { startGatewayEventSubscriptions } from "./server-runtime-subscriptions.js";

type SubscriptionParams = Parameters<typeof startGatewayEventSubscriptions>[0];

export function createSubscriptionParams(log: SubsystemLogger): SubscriptionParams {
  return {
    log,
    broadcast: vi.fn(),
    broadcastToConnIds: vi.fn(),
    nodeSendToSession: vi.fn(),
    agentRunSeq: new Map(),
    ...(() => {
      const chatRunState = createChatRunState();
      return { chatRunState, toolEventRecipients: chatRunState.toolEventRecipients };
    })(),
    sessionEventSubscribers: createSessionEventSubscriberRegistry(),
    sessionMessageSubscribers: createSessionMessageSubscriberRegistry(),
    chatAbortControllers: new Map(),
    restartRecoveryCandidates: new Map(),
    terminalSessions: { closeTaskSessions: vi.fn() },
  };
}
