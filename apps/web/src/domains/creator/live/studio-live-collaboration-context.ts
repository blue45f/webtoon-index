import { createContext, useContext } from "react";

import {
  INITIAL_STUDIO_LIVE_SYNC_SNAPSHOT,
  type StudioLiveSyncSnapshot,
} from "./studio-live-sync-safety";

import type {
  StudioLiveChatMessage,
  StudioLiveLock,
  StudioLivePeer,
  StudioLiveRoom,
} from "./studio-live-collaboration-room";
import type { StudioLiveTransportMode } from "./studio-live-collaboration-transport";

export type StudioLiveAvailability = "idle" | "connecting" | "ready" | "unsupported" | "error";

export interface StudioLiveRecoveryState {
  vaultId: string | null;
  updateCount: number;
  exportAvailable: boolean;
  exported: boolean;
  message: string;
}

export interface StudioLiveCollaborationContextValue {
  room: StudioLiveRoom | null;
  availability: StudioLiveAvailability;
  mode: StudioLiveTransportMode | null;
  peers: StudioLivePeer[];
  locks: StudioLiveLock[];
  chatMessages: StudioLiveChatMessage[];
  /** UX gate only. The server rejects chat from roles without comment/edit capability anyway. */
  canChat: boolean;
  error: string | null;
  serverAvailable: boolean;
  localFallbackAllowed: boolean;
  usingLocalFallback: boolean;
  sendChatMessage: (text: string) => boolean;
  /** Structured, fail-closed durability state for always-visible editor chrome. */
  sync: StudioLiveSyncSnapshot;
  recovery: StudioLiveRecoveryState | null;
  exportRecovery: () => Promise<void>;
  reloadAuthoritative: () => void;
  retryServer: () => void;
  useLocalFallback: () => void;
}

export const EMPTY_STUDIO_LIVE_CONTEXT: StudioLiveCollaborationContextValue = {
  room: null,
  availability: "idle",
  mode: null,
  peers: [],
  locks: [],
  chatMessages: [],
  canChat: false,
  error: null,
  serverAvailable: false,
  localFallbackAllowed: false,
  usingLocalFallback: false,
  sendChatMessage: () => false,
  sync: INITIAL_STUDIO_LIVE_SYNC_SNAPSHOT,
  recovery: null,
  exportRecovery: async () => undefined,
  reloadAuthoritative: () => undefined,
  retryServer: () => undefined,
  useLocalFallback: () => undefined,
};

export const StudioLiveCollaborationContext =
  createContext<StudioLiveCollaborationContextValue>(EMPTY_STUDIO_LIVE_CONTEXT);

export function useStudioLiveCollaboration(): StudioLiveCollaborationContextValue {
  return useContext(StudioLiveCollaborationContext);
}
