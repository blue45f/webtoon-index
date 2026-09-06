import {
  checksumCanonicalStudioDocumentEnvelope,
  createCanonicalStudioDocumentEnvelope,
  createStudioDocumentMigratorRegistry,
  serializeCanonicalStudioDocumentEnvelope,
  type CanonicalStudioDocumentEnvelope,
  type StudioDocumentChecksum,
  type StudioDocumentDiagnostic,
  type StudioDocumentJsonValue,
  type StudioDocumentMigrationReceipt,
} from "./studio-document-envelope";
import {
  parseStudioProjectFile,
  serializeStudioProjectFile,
  type StudioProjectFile,
} from "./studio-project-file";

export const STUDIO_PROJECT_DOCUMENT_FORMAT_ID =
  "toonspectrum.studio-project" as const;
export const STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE = "project" as const;
export const STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION = 2 as const;

export interface StudioProjectDocumentMetadata {
  readonly documentId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StudioProjectDocumentSaveArtifact {
  readonly project: StudioProjectFile;
  readonly envelope: CanonicalStudioDocumentEnvelope<
    typeof STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE
  >;
  readonly canonicalJson: string;
  readonly checksum: StudioDocumentChecksum;
}

export type StudioProjectDocumentLoadResult =
  | {
      readonly source: "legacy-project";
      readonly project: StudioProjectFile;
      readonly envelope: null;
      readonly receipt: null;
    }
  | {
      readonly source: "canonical-envelope";
      readonly project: StudioProjectFile;
      readonly envelope: CanonicalStudioDocumentEnvelope<
        typeof STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE
      >;
      readonly receipt: StudioDocumentMigrationReceipt;
    };

const preservedEnvelopeByProjectDocumentError = new WeakMap<
  object,
  CanonicalStudioDocumentEnvelope
>();
const preservedSourceByProjectDocumentError = new WeakMap<object, unknown>();

export class StudioProjectDocumentError extends Error {
  readonly diagnostic: StudioDocumentDiagnostic;

  constructor(
    diagnostic: StudioDocumentDiagnostic,
    preservedEnvelope?: CanonicalStudioDocumentEnvelope,
    preservedSource?: unknown
  ) {
    super(diagnostic.message);
    this.name = "StudioProjectDocumentError";
    this.diagnostic = diagnostic;
    if (preservedEnvelope !== undefined) {
      preservedEnvelopeByProjectDocumentError.set(this, preservedEnvelope);
    }
    if (preservedSource !== undefined) {
      preservedSourceByProjectDocumentError.set(this, preservedSource);
    }
  }

  /**
   * Recovery payloads deliberately live outside the Error object. Property access remains
   * backwards-compatible, while object enumeration, JSON serializers, and console inspection
   * cannot accidentally capture a creator's future document bytes.
   */
  get preservedEnvelope(): CanonicalStudioDocumentEnvelope | undefined {
    return preservedEnvelopeByProjectDocumentError.get(this);
  }

  get preservedSource(): unknown {
    return preservedSourceByProjectDocumentError.get(this);
  }

  /** Privacy-safe structured projection for JSON and console-oriented error reporting. */
  toJSON(): Readonly<{
    name: string;
    diagnostic: StudioDocumentDiagnostic;
  }> {
    return Object.freeze({
      name: this.name,
      diagnostic: this.diagnostic,
    });
  }
}

function detachedProjectJson(value: unknown): StudioProjectFile {
  return JSON.parse(serializeStudioProjectFile(value)) as StudioProjectFile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsImportedPromptText(value: unknown): boolean {
  if (typeof value === "string") return true;
  if (!isRecord(value) && !Array.isArray(value)) return false;

  const directPromptKeys = new Set([
    "rawPrompt",
    "promptText",
    "rawRevisedPrompt",
    "revisedPromptText",
  ]);
  const promptContainerKeys = new Set([
    "prompt",
    "revisedPrompt",
    "revised_prompt",
  ]);
  const stack: unknown[] = [value];
  const visited = new WeakSet<object>();
  let visitedNodes = 0;
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (
      (typeof candidate !== "object" || candidate === null)
      || visited.has(candidate)
    ) {
      continue;
    }
    visited.add(candidate);
    visitedNodes += 1;
    // Canonical envelopes are bounded already, but a future provenance shape should redact
    // rather than make import work unbounded.
    if (visitedNodes > 2_000) return true;

    if (Array.isArray(candidate)) {
      for (const child of candidate) stack.push(child);
      continue;
    }
    for (const [key, child] of Object.entries(candidate)) {
      if (directPromptKeys.has(key) && typeof child === "string") return true;
      if (promptContainerKeys.has(key)) {
        if (typeof child === "string") return true;
        if (
          isRecord(child)
          && ["raw", "text", "value"].some(
            (promptKey) => typeof child[promptKey] === "string",
          )
        ) {
          return true;
        }
      }
      if (typeof child === "object" && child !== null) stack.push(child);
    }
  }
  return false;
}

/**
 * Successful canonical imports preserve their exact envelope unless private prompt text is still
 * present. Redaction happens here, behind StudioPage's dynamic project-document boundary, so the
 * privacy guarantee does not pull the canonical/AI parser graph into the static Studio bundle.
 */
function privacySafeImportedEnvelope(
  envelope: CanonicalStudioDocumentEnvelope<
    typeof STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE
  >,
  project: StudioProjectFile
): CanonicalStudioDocumentEnvelope<
  typeof STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE
> {
  const sourceProject = isRecord(envelope.payload.data)
    ? envelope.payload.data
    : {};
  if (!containsImportedPromptText(sourceProject.aiProvenance)) return envelope;
  const safeProject = { ...sourceProject };
  if (project.aiProvenance === undefined) {
    delete safeProject.aiProvenance;
  } else {
    safeProject.aiProvenance = project.aiProvenance;
  }
  return createCanonicalStudioDocumentEnvelope({
    format: envelope.format,
    document: envelope.document,
    payload: {
      type: envelope.payload.type,
      data: safeProject,
    },
    extensions: envelope.extensions,
  });
}

function isStudioDocumentEnvelopeCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    isRecord(value.format) &&
    (Object.hasOwn(value.format, "id") || Object.hasOwn(value.format, "version"))
  ) {
    return true;
  }
  return (
    Object.hasOwn(value, "document") ||
    Object.hasOwn(value, "payload") ||
    Object.hasOwn(value, "extensions")
  );
}

function futureRawProjectVersion(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const rawVersion = value.version;
  const version = typeof rawVersion === "number"
    ? rawVersion
    : typeof rawVersion === "string"
      ? (() => {
          const match = /^(0|[1-9]\d*)(?:\.\d+)?$/u.exec(rawVersion.trim());
          if (!match) return Number.NaN;
          return Number(match[1]);
        })()
      : Number.NaN;
  if (
    !Number.isSafeInteger(version) ||
    version <= STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION
  ) {
    return null;
  }
  return version;
}

function decodeProjectDocumentInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("프로젝트 JSON을 해석하지 못했습니다.");
  }
}

const studioProjectDocumentRegistry = createStudioDocumentMigratorRegistry([
  {
    formatId: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
    payloadType: STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE,
    minimumVersion: 1,
    currentVersion: STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
    migrators: [
      {
        id: "studio-project.v1-to-v2",
        fromVersion: 1,
        toVersion: 2,
        migrate: (envelope) => ({
          ...envelope,
          format: {
            ...envelope.format,
            version: 2,
          },
          payload: {
            ...envelope.payload,
            data: detachedProjectJson(envelope.payload.data),
          },
        }),
      },
    ],
  },
]);

export function createStudioProjectDocumentEnvelope(
  value: unknown,
  metadata: StudioProjectDocumentMetadata,
  extensions: Readonly<Record<string, unknown>> = {}
): CanonicalStudioDocumentEnvelope<
  typeof STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE
> {
  return createCanonicalStudioDocumentEnvelope({
    format: {
      id: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
      version: STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
    },
    document: {
      id: metadata.documentId,
      revision: metadata.revision,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    },
    payload: {
      type: STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE,
      data: detachedProjectJson(value) as unknown as StudioDocumentJsonValue,
    },
    extensions,
  });
}

export function serializeStudioProjectDocument(
  value: unknown,
  metadata: StudioProjectDocumentMetadata,
  extensions: Readonly<Record<string, unknown>> = {}
): string {
  return serializeCanonicalStudioDocumentEnvelope(
    createStudioProjectDocumentEnvelope(value, metadata, extensions)
  );
}

/**
 * Produces the complete deterministic save artifact without changing the established synchronous
 * `serializeStudioProjectDocument` contract used by StudioPage.
 */
export async function buildStudioProjectDocumentSaveArtifact(
  value: unknown,
  metadata: StudioProjectDocumentMetadata,
  extensions: Readonly<Record<string, unknown>> = {}
): Promise<StudioProjectDocumentSaveArtifact> {
  const envelope = createStudioProjectDocumentEnvelope(
    value,
    metadata,
    extensions
  );
  const canonicalJson = serializeCanonicalStudioDocumentEnvelope(envelope);
  const checksum = await checksumCanonicalStudioDocumentEnvelope(envelope);
  return Object.freeze({
    project: parseStudioProjectFile(envelope.payload.data),
    envelope,
    canonicalJson,
    checksum,
  });
}

/**
 * Loads both the historical raw project JSON and the canonical Studio document envelope.
 *
 * An envelope-like object never falls back to the permissive legacy parser. This prevents a
 * damaged or future envelope from being partially interpreted as a raw project and losing
 * metadata or extensions.
 */
export async function parseStudioProjectDocument(
  value: unknown
): Promise<StudioProjectDocumentLoadResult> {
  const decoded = decodeProjectDocumentInput(value);
  if (!isStudioDocumentEnvelopeCandidate(decoded)) {
    const futureVersion = futureRawProjectVersion(decoded);
    if (futureVersion !== null) {
      throw new StudioProjectDocumentError(
        Object.freeze({
          severity: "error",
          code: "UNKNOWN_FUTURE_VERSION",
          message:
            "이 Studio 프로젝트는 현재 빌드보다 새로운 project version으로 저장되었습니다.",
          recoverable: true,
          recovery: "upgrade-client",
          formatId: STUDIO_PROJECT_DOCUMENT_FORMAT_ID,
          payloadType: STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE,
          actualVersion: futureVersion,
          currentVersion: STUDIO_PROJECT_DOCUMENT_CURRENT_VERSION,
        }),
        undefined,
        value
      );
    }
    return {
      source: "legacy-project",
      project: parseStudioProjectFile(decoded),
      envelope: null,
      receipt: null,
    };
  }

  const migrated = await studioProjectDocumentRegistry.migrate(decoded);
  if (!migrated.ok) {
    throw new StudioProjectDocumentError(
      migrated.diagnostics[0],
      migrated.preservedEnvelope
    );
  }
  const migratedEnvelope =
    migrated.envelope as CanonicalStudioDocumentEnvelope<
      typeof STUDIO_PROJECT_DOCUMENT_PAYLOAD_TYPE
    >;
  const project = parseStudioProjectFile(migratedEnvelope.payload.data);

  return {
    source: "canonical-envelope",
    project,
    envelope: privacySafeImportedEnvelope(migratedEnvelope, project),
    receipt: migrated.receipt,
  };
}
