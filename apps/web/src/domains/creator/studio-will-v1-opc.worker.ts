import {
  buildStudioWillV1OpcBytes,
  importStudioWillV1Opc,
  StudioWillV1OpcInterchangeError,
} from "./studio-will-v1-opc-interchange";
import {
  packStudioWillV1OpcBuildResult,
  packStudioWillV1OpcImportResult,
  unpackStudioWillV1OpcExportInput,
} from "./studio-will-v1-opc-packed-codec";
import {
  STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
  isStudioWillV1OpcWorkerRequest,
  isStudioWillV1OpcWorkerResponse,
  studioWillV1OpcWorkerCorrelation,
  studioWillV1OpcWorkerResponseTransfers,
  type StudioWillV1OpcWorkerFailure,
  type StudioWillV1OpcWorkerFailureCode,
  type StudioWillV1OpcWorkerCodecOptions,
  type StudioWillV1OpcWorkerRequest,
  type StudioWillV1OpcWorkerResponse,
} from "./studio-will-v1-opc-worker-protocol";

interface StudioWillV1OpcWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioWillV1OpcWorkerResponse, transfer: Transferable[]): void;
  close?(): void;
}

const workerScope = globalThis as unknown as StudioWillV1OpcWorkerScope;
let acceptedRequestId: string | null = null;

function boundedText(value: string, maximum: number, fallback: string): string {
  const text = value.trim();
  return (text || fallback).slice(0, maximum);
}

function failureResponse(
  requestId: string,
  operation: "decode" | "encode",
  cause: unknown,
  overrideCode?: StudioWillV1OpcWorkerFailureCode
): StudioWillV1OpcWorkerFailure {
  const known = cause instanceof StudioWillV1OpcInterchangeError;
  const code = overrideCode ?? (known ? cause.code : "OPERATION_FAILED");
  const name = known ? boundedText(cause.name, 128, "Error") : "Error";
  const message = known
    ? boundedText(cause.message, 2_048, "WILL v1 OPC Worker 작업에 실패했습니다.")
    : overrideCode === "INVALID_REQUEST"
      ? "WILL v1 OPC Worker 요청 프로토콜이 올바르지 않습니다."
      : "WILL v1 OPC Worker 작업에 실패했습니다.";
  return {
    type: "studio-will-v1-opc/failure",
    version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
    requestId,
    operation,
    error: {
      code,
      name,
      message,
      ...(known && cause.path ? { path: cause.path.slice(0, 1_024) } : {}),
    },
  };
}

function safeClose(): void {
  try {
    workerScope.close?.();
  } catch {
    // A failed close cannot be recovered inside an already broken Worker channel.
  }
}

function post(response: StudioWillV1OpcWorkerResponse): boolean {
  if (!isStudioWillV1OpcWorkerResponse(response)) {
    safeClose();
    return false;
  }
  try {
    workerScope.postMessage(
      response,
      studioWillV1OpcWorkerResponseTransfers(response),
    );
    return true;
  } catch {
    safeClose();
    return false;
  }
}

function ownedBytes(bytes: Uint8Array): Uint8Array {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes;
  }
  return Uint8Array.from(bytes);
}

function boundedCodecOptions(
  request: StudioWillV1OpcWorkerRequest,
): StudioWillV1OpcWorkerCodecOptions {
  return {
    ...(request.options?.limits
      ? { limits: { ...request.options.limits } }
      : {}),
    ...(request.options?.willLimits
      ? { willLimits: { ...request.options.willLimits } }
      : {}),
  };
}

async function execute(request: StudioWillV1OpcWorkerRequest): Promise<void> {
  try {
    const options = {
      ...boundedCodecOptions(request),
      crc32ExecutionMode: "direct-headless" as const,
    };
    if (request.type === "studio-will-v1-opc/encode") {
      const input = unpackStudioWillV1OpcExportInput(
        request.packedInput,
        options,
      );
      const result = await buildStudioWillV1OpcBytes(
        input,
        options,
      );
      const archive = ownedBytes(result.bytes);
      const packedResult = packStudioWillV1OpcBuildResult(result, options);
      post({
        type: "studio-will-v1-opc/encode-success",
        version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        archive,
        packedResult,
      });
      return;
    }
    const result = await importStudioWillV1Opc(
      request.source,
      options,
    );
    post({
      type: "studio-will-v1-opc/decode-success",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      packedResult: packStudioWillV1OpcImportResult(result, options),
    });
  } catch (cause) {
    post(
      failureResponse(
        request.requestId,
        request.type === "studio-will-v1-opc/encode" ? "encode" : "decode",
        cause
      )
    );
  }
}

workerScope.onmessage = (event) => {
  const correlation = studioWillV1OpcWorkerCorrelation(event.data);
  if (!isStudioWillV1OpcWorkerRequest(event.data)) {
    if (correlation?.operation) {
      post(
        failureResponse(
          correlation.requestId,
          correlation.operation,
          new Error("WILL v1 OPC Worker 요청 프로토콜이 올바르지 않습니다."),
          "INVALID_REQUEST"
        )
      );
    }
    return;
  }
  if (acceptedRequestId !== null) {
    post(
      failureResponse(
        event.data.requestId,
        event.data.type === "studio-will-v1-opc/encode" ? "encode" : "decode",
        new Error("전용 WILL v1 OPC Worker는 하나의 요청만 처리합니다."),
        "INVALID_REQUEST"
      )
    );
    return;
  }
  acceptedRequestId = event.data.requestId;
  void execute(event.data);
};
