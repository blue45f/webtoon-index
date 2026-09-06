/** Ephemeral UI recovery only. All durable writes stay in the existing music repository. */
import type { LocalMusicTrack } from "./studio-music-client";

export interface MusicRecoveryPort {
  load(ownerId: string): Promise<LocalMusicTrack[]>;
  save(track: LocalMusicTrack): Promise<void>;
  remove(id: string, ownerId: string): Promise<void>;
}
export interface MusicRecoverySnapshot {
  readonly tracks: readonly LocalMusicTrack[];
  readonly savedIds: readonly string[];
  readonly pendingIds: readonly string[];
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly loadError: string;
}

function copyTrack(track: LocalMusicTrack, ownerId: string): LocalMusicTrack {
  if (!ownerId || track.ownerId !== ownerId || !track.metadata?.id) {
    throw new Error("음원과 보관함의 계정이 일치하지 않습니다.");
  }
  return Object.freeze({
    ...track,
    metadata: Object.freeze({
      ...track.metadata,
      brief: Object.freeze({
        ...track.metadata.brief,
        instruments: Object.freeze([...track.metadata.brief.instruments]) as unknown as string[],
      }),
    }),
  });
}

/** A workspace-owned store, never a singleton: account switches get a new isolated instance.
 * A failed local save never calls a generator. The original Blob remains downloadable.
 */
export function createMusicRecovery(ownerId: string, port: MusicRecoveryPort) {
  let state: MusicRecoverySnapshot = Object.freeze({
    tracks: Object.freeze([]), savedIds: Object.freeze([]), pendingIds: Object.freeze([]),
    loading: false, loaded: false, loadError: "",
  });
  const listeners = new Set<() => void>();
  let pendingLoad: Promise<void> | null = null;
  const publish = (patch: Partial<MusicRecoverySnapshot>) => {
    state = Object.freeze({ ...state, ...patch });
    listeners.forEach((listener) => listener());
  };
  const getTrack = (id: string) => {
    const track = state.tracks.find((item) => item.metadata.id === id);
    if (!track) throw new Error("이 화면에 보관된 음원을 찾지 못했습니다.");
    return track;
  };
  const mutate = async (id: string, operation: () => Promise<void>) => {
    if (state.loading || state.pendingIds.includes(id)) {
      throw new Error("해당 음원의 저장 또는 보관함 확인이 진행 중입니다.");
    }
    publish({ pendingIds: Object.freeze([...state.pendingIds, id]) });
    try { await operation(); }
    finally { publish({ pendingIds: Object.freeze(state.pendingIds.filter((value) => value !== id)) }); }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load(): Promise<void> {
      if (pendingLoad) return pendingLoad;
      if (!ownerId || state.pendingIds.length) return Promise.reject(new Error("진행 중인 저장을 마친 뒤 보관함을 다시 확인해 주세요."));
      publish({ loading: true, loadError: "" });
      pendingLoad = (async () => {
        try {
          const loaded = (await Promise.resolve().then(() => port.load(ownerId))).map((track) => copyTrack(track, ownerId));
          const ids = loaded.map((track) => track.metadata.id);
          if (new Set(ids).size !== ids.length) throw new Error("보관함에 중복된 음원 정보가 있습니다.");
          // Reconcile an unknown prior write outcome without dropping unpersisted paid audio.
          const unsaved = state.tracks.filter((track) => !state.savedIds.includes(track.metadata.id) && !ids.includes(track.metadata.id));
          publish({
            tracks: Object.freeze([...unsaved, ...loaded]), savedIds: Object.freeze(ids), loaded: true,
          });
        } catch (error) {
          publish({ loadError: error instanceof Error ? error.message : "기기 보관함을 확인하지 못했습니다." });
          throw error;
        } finally {
          pendingLoad = null;
          publish({ loading: false });
        }
      })();
      return pendingLoad;
    },
    retain(track: LocalMusicTrack): void {
      const copy = copyTrack(track, ownerId);
      if (state.tracks.some((item) => item.metadata.id === copy.metadata.id)) {
        throw new Error("이미 화면에 있는 음원입니다. 기존 음원을 덮어쓰지 않았습니다.");
      }
      publish({ tracks: Object.freeze([copy, ...state.tracks]) });
    },
    async save(id: string): Promise<void> {
      const track = getTrack(id);
      if (state.savedIds.includes(id)) return;
      await mutate(id, async () => {
        await port.save(track);
        publish({ savedIds: Object.freeze([...state.savedIds, id]) });
      });
    },
    async remove(id: string): Promise<void> {
      getTrack(id);
      await mutate(id, async () => {
        // Even an unacknowledged save may have committed. Always reconcile durable deletion.
        await port.remove(id, ownerId);
        publish({
          tracks: Object.freeze(state.tracks.filter((track) => track.metadata.id !== id)),
          savedIds: Object.freeze(state.savedIds.filter((value) => value !== id)),
        });
      });
    },
  };
}
