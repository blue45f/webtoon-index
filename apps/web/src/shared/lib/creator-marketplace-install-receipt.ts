import { isCreatorMarketplaceStudioPackId } from "./creator-marketplace-package-identity";
import {
  compareCreatorMarketplaceSemver,
  isCreatorMarketplaceSemver,
  normalizeCreatorMarketplaceLegacySemver,
} from "./creator-marketplace-semver";

import type { CreatorMarketplaceResourceKind } from "./creator-marketplace-resource-contract";

export const CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY =
  "toonspectrum.creator-marketplace-install-receipts.v1" as const;
export const CREATOR_MARKETPLACE_INSTALL_RECEIPT_EVENT =
  "toonspectrum:creator-marketplace-install-receipt" as const;
export const CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_ENTRIES = 64;
export const CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_CHARACTERS = 32_768;
export const CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_AGE_MS =
  365 * 24 * 60 * 60 * 1_000;

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const RECEIPT_KINDS = new Set<CreatorMarketplaceInstallReceiptKind>([
  "brush",
  "filter",
  "palette",
]);
const ROOT_KEYS = new Set(["version", "receipts"]);
const RECEIPT_KEYS = new Set([
  "packageVersion",
  "packageFingerprint",
  "kind",
  "installedAt",
]);

export type CreatorMarketplaceInstallReceiptKind = Extract<
  CreatorMarketplaceResourceKind,
  "brush" | "filter" | "palette"
>;

export interface CreatorMarketplaceInstallReceipt {
  readonly packageVersion: string;
  readonly packageFingerprint: string;
  readonly kind: CreatorMarketplaceInstallReceiptKind;
  readonly installedAt: number;
}

export interface CreatorMarketplaceInstallReceiptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type CreatorMarketplaceInstallReceiptState =
  | "installed-current"
  | "update-available"
  | "no-verified-receipt";

interface StoredReceiptEnvelope {
  readonly version: 1;
  readonly receipts: Readonly<Record<string, CreatorMarketplaceInstallReceipt>>;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isCreatorMarketplaceInstallReceiptKind(
  value: string,
): value is CreatorMarketplaceInstallReceiptKind {
  return RECEIPT_KINDS.has(value as CreatorMarketplaceInstallReceiptKind);
}

function parseReceipt(
  value: unknown,
  nowMs: number,
): CreatorMarketplaceInstallReceipt | null {
  const candidate = objectRecord(value);
  if (
    !candidate
    || !hasOnlyKeys(candidate, RECEIPT_KEYS)
    || Object.keys(candidate).length !== RECEIPT_KEYS.size
    || typeof candidate.packageVersion !== "string"
    || !isCreatorMarketplaceSemver(candidate.packageVersion)
    || typeof candidate.packageFingerprint !== "string"
    || !FINGERPRINT_PATTERN.test(candidate.packageFingerprint)
    || typeof candidate.kind !== "string"
    || !RECEIPT_KINDS.has(candidate.kind as CreatorMarketplaceInstallReceiptKind)
    || typeof candidate.installedAt !== "number"
    || !Number.isSafeInteger(candidate.installedAt)
    || candidate.installedAt < 0
    || candidate.installedAt > nowMs
    || nowMs - candidate.installedAt > CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_AGE_MS
  ) {
    return null;
  }
  return {
    packageVersion: candidate.packageVersion,
    packageFingerprint: candidate.packageFingerprint,
    kind: candidate.kind as CreatorMarketplaceInstallReceiptKind,
    installedAt: candidate.installedAt,
  };
}

function removeEnvelope(storage: CreatorMarketplaceInstallReceiptStorage): void {
  try {
    storage.removeItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY);
  } catch {
    // An unwritable browser store is equivalent to having no verifiable local receipt.
  }
}

function serializeEnvelope(
  receipts: ReadonlyMap<string, CreatorMarketplaceInstallReceipt>,
): string {
  return JSON.stringify({
    version: 1,
    receipts: Object.fromEntries(receipts),
  } satisfies StoredReceiptEnvelope);
}

function newestReceipts(
  receipts: Iterable<readonly [string, CreatorMarketplaceInstallReceipt]>,
): Map<string, CreatorMarketplaceInstallReceipt> {
  return new Map(
    [...receipts]
      .sort((left, right) => {
        if (left[1].installedAt !== right[1].installedAt) {
          return right[1].installedAt - left[1].installedAt;
        }
        return left[0].localeCompare(right[0]);
      })
      .slice(0, CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_ENTRIES),
  );
}

function persistCleanEnvelope(
  storage: CreatorMarketplaceInstallReceiptStorage,
  receipts: ReadonlyMap<string, CreatorMarketplaceInstallReceipt>,
): boolean {
  try {
    if (receipts.size === 0) {
      storage.removeItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY);
      return storage.getItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY) === null;
    }
    const serialized = serializeEnvelope(receipts);
    if (serialized.length > CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_CHARACTERS) {
      removeEnvelope(storage);
      return false;
    }
    storage.setItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY, serialized);
    return storage.getItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

function loadReceipts(
  storage: CreatorMarketplaceInstallReceiptStorage,
  nowMs: number,
): Map<string, CreatorMarketplaceInstallReceipt> {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return new Map();
  let raw: string | null;
  try {
    raw = storage.getItem(CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY);
  } catch {
    return new Map();
  }
  if (raw === null) return new Map();
  if (
    raw.length === 0
    || raw.length > CREATOR_MARKETPLACE_INSTALL_RECEIPT_MAX_CHARACTERS
  ) {
    removeEnvelope(storage);
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    removeEnvelope(storage);
    return new Map();
  }
  const envelope = objectRecord(parsed);
  const rawReceipts = objectRecord(envelope?.receipts);
  if (
    !envelope
    || !hasOnlyKeys(envelope, ROOT_KEYS)
    || Object.keys(envelope).length !== ROOT_KEYS.size
    || envelope.version !== 1
    || !rawReceipts
  ) {
    removeEnvelope(storage);
    return new Map();
  }

  let dirty = false;
  const receipts = new Map<string, CreatorMarketplaceInstallReceipt>();
  for (const [logicalPackId, value] of Object.entries(rawReceipts)) {
    const receipt = isCreatorMarketplaceStudioPackId(logicalPackId)
      ? parseReceipt(value, nowMs)
      : null;
    if (!receipt) {
      dirty = true;
      continue;
    }
    receipts.set(logicalPackId, receipt);
  }
  const bounded = newestReceipts(receipts);
  if (bounded.size !== receipts.size) dirty = true;
  if (dirty) persistCleanEnvelope(storage, bounded);
  return bounded;
}

function browserStorage(): CreatorMarketplaceInstallReceiptStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

function dispatchReceiptEvent(logicalPackId: string): void {
  try {
    if (
      typeof globalThis.dispatchEvent !== "function"
      || typeof globalThis.CustomEvent !== "function"
    ) return;
    globalThis.dispatchEvent(new CustomEvent(
      CREATOR_MARKETPLACE_INSTALL_RECEIPT_EVENT,
      { detail: { logicalPackId } },
    ));
  } catch {
    // The receipt is already durable. A missing same-document refresh signal is non-authoritative.
  }
}

export function readCreatorMarketplaceInstallReceipt(
  logicalPackId: string,
  storage: CreatorMarketplaceInstallReceiptStorage | null = browserStorage(),
  nowMs = Date.now(),
): CreatorMarketplaceInstallReceipt | null {
  if (!storage || !isCreatorMarketplaceStudioPackId(logicalPackId)) return null;
  return loadReceipts(storage, nowMs).get(logicalPackId) ?? null;
}

export function writeCreatorMarketplaceInstallReceipt(
  input: CreatorMarketplaceInstallReceipt & { readonly logicalPackId: string },
  storage: CreatorMarketplaceInstallReceiptStorage | null = browserStorage(),
  nowMs = Date.now(),
): boolean {
  if (
    !storage
    || !Number.isSafeInteger(nowMs)
    || nowMs < 0
    || !isCreatorMarketplaceStudioPackId(input.logicalPackId)
  ) return false;
  const receipt = parseReceipt({
    packageVersion: input.packageVersion,
    packageFingerprint: input.packageFingerprint,
    kind: input.kind,
    installedAt: input.installedAt,
  }, nowMs);
  if (!receipt) return false;
  const receipts = loadReceipts(storage, nowMs);
  receipts.set(input.logicalPackId, receipt);
  const persisted = persistCleanEnvelope(storage, newestReceipts(receipts));
  if (persisted) dispatchReceiptEvent(input.logicalPackId);
  return persisted;
}

export function removeCreatorMarketplaceInstallReceipt(
  logicalPackId: string,
  storage: CreatorMarketplaceInstallReceiptStorage | null = browserStorage(),
  nowMs = Date.now(),
): boolean {
  if (!storage || !isCreatorMarketplaceStudioPackId(logicalPackId)) return false;
  const receipts = loadReceipts(storage, nowMs);
  if (!receipts.delete(logicalPackId)) return true;
  const persisted = persistCleanEnvelope(storage, receipts);
  if (persisted) dispatchReceiptEvent(logicalPackId);
  return persisted;
}

export function resolveCreatorMarketplaceInstallReceiptState(
  current: Readonly<{
    resourceVersion: string;
    manifestHash: string;
    kind: CreatorMarketplaceResourceKind;
  }>,
  receipt: CreatorMarketplaceInstallReceipt | null,
): CreatorMarketplaceInstallReceiptState {
  if (!receipt || !isCreatorMarketplaceInstallReceiptKind(current.kind)) {
    return "no-verified-receipt";
  }
  const currentVersion = normalizeCreatorMarketplaceLegacySemver(
    current.resourceVersion,
  );
  if (!currentVersion) return "no-verified-receipt";
  if (
    receipt.kind !== current.kind
    || receipt.packageVersion === currentVersion
      && receipt.packageFingerprint !== current.manifestHash
  ) {
    return "no-verified-receipt";
  }
  if (
    receipt.packageVersion === currentVersion
    && receipt.packageFingerprint === current.manifestHash
  ) {
    return "installed-current";
  }
  try {
    return compareCreatorMarketplaceSemver(
      receipt.packageVersion,
      currentVersion,
    ) < 0
      ? "update-available"
      : "no-verified-receipt";
  } catch {
    return "no-verified-receipt";
  }
}
