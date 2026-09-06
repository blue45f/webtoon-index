/**
 * Explicit pre-V12 localStorage import/test seam for BG3D LT presets.
 *
 * Product boot must not call this adapter or probe its keys. V12 uses the shared SQLite/OPFS
 * repository and only user-initiated legacy import tooling may pass a storage object here.
 */

import {
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON,
  loadStudioBg3dLtUserPresetLibrary,
} from "./studio-bg3d-lt-preset-library";
import {
  STUDIO_BG3D_LT_PRESET_MAX_BYTES,
  type StudioBg3dLtPresetPayload,
} from "./studio-bg3d-lt-presets";

export const STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY =
  "toonspectrum.studio.bg3d.lt-presets.v1" as const;
export const STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY =
  "toonspectrum.studio.bg3d.lt-presets.corrupt.v1" as const;

export interface StudioBg3dLtPresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type StudioBg3dLtPresetStorageReadStatus =
  | "missing"
  | "loaded"
  | "recovered"
  | "unavailable";

export interface StudioBg3dLtPresetStorageReadResult {
  readonly status: StudioBg3dLtPresetStorageReadStatus;
  readonly payload: StudioBg3dLtPresetPayload;
  readonly quarantined: boolean;
  readonly rewritten: boolean;
}

function immutableResult(
  status: StudioBg3dLtPresetStorageReadStatus,
  payload: StudioBg3dLtPresetPayload,
  quarantined: boolean,
  rewritten: boolean
): StudioBg3dLtPresetStorageReadResult {
  return Object.freeze({ status, payload, quarantined, rewritten });
}

/**
 * Reads one canonical value. Present corruption is copied to one bounded quarantine slot before a
 * canonical empty payload is written back. Every storage operation is isolated because browsers
 * may independently reject reads, quarantine writes, or primary-key writes.
 */
export function loadStudioBg3dLtUserPresetsFromStorage(
  storage: StudioBg3dLtPresetStorage
): StudioBg3dLtPresetStorageReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY);
  } catch {
    return immutableResult(
      "unavailable",
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
      false,
      false
    );
  }

  const loaded = loadStudioBg3dLtUserPresetLibrary(raw);
  if (loaded.status === "missing") {
    return immutableResult("missing", loaded.payload, false, false);
  }
  if (loaded.status === "loaded") {
    return immutableResult("loaded", loaded.payload, false, false);
  }

  let quarantined = false;
  if (typeof raw === "string" && raw.length <= STUDIO_BG3D_LT_PRESET_MAX_BYTES) {
    try {
      storage.setItem(STUDIO_BG3D_LT_USER_PRESET_QUARANTINE_KEY, raw);
      quarantined = true;
    } catch {
      // A full or policy-blocked store can reject the backup while still allowing a shorter
      // overwrite of the existing primary value. Continue to the independent repair attempt.
    }
  }
  let rewritten = false;
  try {
    storage.setItem(
      STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY,
      EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD_JSON
    );
    rewritten = true;
  } catch {
    // The trusted in-memory payload is still safe. The UI can report that persistence remains
    // unavailable and retry on a later explicit mutation.
  }
  return immutableResult("recovered", loaded.payload, quarantined, rewritten);
}

/** Writes only canonical JSON returned by the pure library and never throws into the editor. */
export function saveStudioBg3dLtUserPresetsToStorage(
  storage: StudioBg3dLtPresetStorage,
  canonicalJson: string
): boolean {
  const validated = loadStudioBg3dLtUserPresetLibrary(canonicalJson);
  if (validated.status !== "loaded") return false;
  try {
    storage.setItem(STUDIO_BG3D_LT_USER_PRESET_STORAGE_KEY, validated.canonicalJson);
    return true;
  } catch {
    return false;
  }
}
