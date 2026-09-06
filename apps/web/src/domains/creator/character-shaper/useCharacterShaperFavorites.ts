import { useSyncExternalStore } from "react";

import {
  CHARACTER_FAVORITES_KEY,
  EMPTY_CHARACTER_FAVORITES,
  createCharacterFavoriteStore,
} from "./character-shaper-favorites";

// No storage read at module initialization or during render. React subscribes after mounting.
const store = createCharacterFavoriteStore(() => typeof window === "undefined" ? null : window.localStorage);
const serverSnapshot = () => EMPTY_CHARACTER_FAVORITES;

function subscribe(listener: () => void): () => void {
  const unsubscribe = store.subscribe(listener);
  store.refresh();
  if (typeof window === "undefined") return unsubscribe;
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CHARACTER_FAVORITES_KEY) store.refresh();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}

export function useCharacterShaperFavorites() {
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot, serverSnapshot);
  return { ...snapshot, setFavorite: store.setFavorite, retrySave: store.retrySave };
}
