import {
  appendStudioAiOperation,
  projectStudioAiProvenanceForPublish,
  updateStudioAiOperation,
  type StudioAiOperationErrorCategory,
  type StudioAiOperationInput,
  type StudioAiOperationTarget,
  type StudioAiOperationUsage,
  type StudioAiProvenanceDocument,
  type StudioAiRequestedSize,
} from "./studio-ai-provenance";

import type { StudioAiErrorCode, StudioAiSettings, StudioTextAiTransport } from "./studio-ai-client";
import type { StudioPublishAiProvenance } from "../studio-publish-preflight";

export type StudioAiPendingOperationInput = Omit<
  StudioAiOperationInput,
  "createdAt" | "status"
>;

export interface StudioAiOperationProviderContext {
  provider: string;
  model: string;
  transport: "server" | "byok";
}

export interface StudioServerAiMetadata {
  provider?: string;
  model?: string;
}

export interface StudioAiObservableResult {
  ok: boolean;
  code?: StudioAiErrorCode | string;
}

export interface SettleStudioAiOperationOptions {
  now?: Date;
  aborted?: boolean;
  usage?: StudioAiOperationUsage;
  provider?: string;
  model?: string;
  target?: StudioAiOperationTarget;
  requestId?: string;
}

function safeProviderHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).hostname || "custom";
  } catch {
    return "custom";
  }
}

export function studioTextAiProviderContext(
  settings: Pick<StudioAiSettings, "baseUrl" | "textModel">,
  transport: Pick<StudioTextAiTransport, "mode">,
  server?: StudioServerAiMetadata | null
): StudioAiOperationProviderContext {
  if (transport.mode === "server") {
    return {
      provider: server?.provider?.trim() || "unknown",
      model: server?.model?.trim() || "unknown",
      transport: "server",
    };
  }
  return {
    provider: safeProviderHostname(settings.baseUrl),
    model: settings.textModel.trim() || "unknown",
    transport: "byok",
  };
}

export function studioImageAiProviderContext(
  settings: Pick<StudioAiSettings, "baseUrl" | "imageModel">
): StudioAiOperationProviderContext {
  return {
    provider: safeProviderHostname(settings.baseUrl),
    model: settings.imageModel.trim() || "unknown",
    transport: "byok",
  };
}

export function parseStudioAiRequestedSize(value: string): StudioAiRequestedSize | undefined {
  const match = /^(\d{1,5})x(\d{1,5})$/u.exec(value.trim().toLowerCase());
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
    || width > 16_384
    || height > 16_384
  ) {
    return undefined;
  }
  return { width, height };
}

/** Best-effort UI recording: provenance limits must never break the creator operation itself. */
export function recordPendingStudioAiOperation(
  document: StudioAiProvenanceDocument,
  input: StudioAiPendingOperationInput,
  now = new Date()
): StudioAiProvenanceDocument {
  try {
    return appendStudioAiOperation(
      document,
      { ...input, status: "pending", createdAt: now },
      { now }
    );
  } catch {
    return document;
  }
}

function errorCategory(code: string | undefined): {
  category: StudioAiOperationErrorCategory;
  retriable: boolean;
} {
  if (code === "not_configured" || code === "invalid_input") {
    return { category: "configuration", retriable: false };
  }
  if (code === "network_error") return { category: "network", retriable: true };
  if (code === "http_error") return { category: "provider", retriable: true };
  if (code === "parse_error") return { category: "provider", retriable: false };
  return { category: "unknown", retriable: false };
}

export function settleStudioAiOperation(
  document: StudioAiProvenanceDocument,
  operationId: string,
  result: StudioAiObservableResult,
  options: SettleStudioAiOperationOptions = {}
): StudioAiProvenanceDocument {
  const now = options.now ?? new Date();
  try {
    if (options.aborted) {
      return updateStudioAiOperation(
        document,
        operationId,
        {
          status: "cancelled",
          error: { category: "cancelled", code: "USER_CANCELLED", retriable: false },
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.model ? { model: options.model } : {}),
        },
        { now }
      );
    }
    if (result.ok) {
      return updateStudioAiOperation(
        document,
        operationId,
        {
          status: "succeeded",
          ...(options.usage ? { usage: options.usage } : {}),
          ...(options.provider ? { provider: options.provider } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.target ? { target: options.target } : {}),
          ...(options.requestId ? { requestId: options.requestId } : {}),
        },
        { now }
      );
    }
    const code = result.code || "UNKNOWN";
    const classified = errorCategory(code);
    return updateStudioAiOperation(
      document,
      operationId,
      {
        status: "failed",
        error: { ...classified, code },
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
      },
      { now }
    );
  } catch {
    return document;
  }
}

/**
 * 브라우저가 닫히거나 문서를 다른 세션에서 열면 클라이언트 fetch는 재개할 수 없다. 저장된 pending을
 * 영구적인 "진행 중"으로 남기지 않고 개인정보가 없는 중단 코드로 취소 처리한다.
 */
export function recoverInterruptedStudioAiOperations(
  document: StudioAiProvenanceDocument,
  now = new Date()
): StudioAiProvenanceDocument {
  let recovered = document;
  for (const operation of document.operations) {
    if (operation.status !== "pending") continue;
    const recoveredAt = new Date(Math.max(now.getTime(), Date.parse(operation.updatedAt)));
    try {
      recovered = updateStudioAiOperation(
        recovered,
        operation.id,
        {
          status: "cancelled",
          error: {
            category: "cancelled",
            code: "SESSION_INTERRUPTED",
            retriable: true,
          },
        },
        { now: recoveredAt }
      );
    } catch {
      // 손상된 단일 항목 때문에 나머지 문서 복구를 막지 않는다.
    }
  }
  return recovered;
}

function publishAction(
  kind: "text" | "image",
  task: string
): StudioPublishAiProvenance["action"] {
  if (task === "translation") return "translated";
  if (kind === "image") {
    return task === "image-edit" || task === "colorize" ? "edited" : "generated";
  }
  return "other";
}

/**
 * Converts the private operation log into the existing Publish Pack shape without identifiers,
 * prompt hashes, reference digests, request IDs, seeds, or error/provider payloads.
 */
export function studioAiProvenanceToPublishPack(
  document: StudioAiProvenanceDocument
): StudioPublishAiProvenance[] {
  return projectStudioAiProvenanceForPublish(document).operations.map((operation) => ({
    action: publishAction(operation.kind, operation.task),
    provider: operation.provider,
    model: operation.model,
    ...(operation.transport === "server" || operation.transport === "byok"
      ? { transport: operation.transport }
      : {}),
    promptVersion: operation.promptVersion,
    ...(operation.usage ? { usage: operation.usage } : {}),
    createdAt: operation.createdAt,
  }));
}
