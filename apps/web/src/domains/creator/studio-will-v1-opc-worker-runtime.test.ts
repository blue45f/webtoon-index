import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStudioWillV1OpcBytes,
  STUDIO_WILL_V1_OPC_ASSURANCE,
} from "./studio-will-v1-opc-interchange";
import {
  packStudioWillV1OpcExportInput,
  unpackStudioWillV1OpcBuildResult,
  unpackStudioWillV1OpcImportResult,
} from "./studio-will-v1-opc-packed-codec";
import {
  STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
  type StudioWillV1OpcWorkerRequest,
  type StudioWillV1OpcWorkerResponse,
} from "./studio-will-v1-opc-worker-protocol";

const SAMPLE_INPUT = {
  width: 48,
  height: 36,
  title: "Runtime sample",
  paths: [
    {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
      strokeWidths: [1, 2, 3, 4],
      strokeColor: { r: 12, g: 34, b: 56, a: 255 },
    },
  ],
};

interface PostedResponse {
  readonly response: StudioWillV1OpcWorkerResponse;
  readonly transfer: Transferable[];
}

interface LoadedWorker {
  readonly posted: PostedResponse[];
  readonly close: ReturnType<typeof vi.fn>;
  dispatch(request: unknown): void;
}

async function loadWorker(
  options: { readonly postThrows?: boolean } = {},
): Promise<LoadedWorker> {
  vi.resetModules();
  const posted: PostedResponse[] = [];
  const close = vi.fn();
  vi.stubGlobal(
    "postMessage",
    vi.fn((response: StudioWillV1OpcWorkerResponse, transfer: Transferable[]) => {
      if (options.postThrows) {
        throw new DOMException("/private/raw/clone failed", "DataCloneError");
      }
      posted.push({ response, transfer: [...transfer] });
    }),
  );
  vi.stubGlobal("close", close);
  await import("./studio-will-v1-opc.worker");
  const scope = globalThis as unknown as {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
  };
  if (!scope.onmessage) throw new Error("Worker handler missing");
  return {
    posted,
    close,
    dispatch(request) {
      scope.onmessage?.({ data: request } as MessageEvent<unknown>);
    },
  };
}

function encodeRequest(requestId: string): StudioWillV1OpcWorkerRequest {
  return {
    type: "studio-will-v1-opc/encode",
    version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
    requestId,
    packedInput: packStudioWillV1OpcExportInput(SAMPLE_INPUT),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "onmessage");
});

describe("WILL v1 OPC packed dedicated Worker runtime", () => {
  it("unpacks the encode request and transfers archive plus packed result", async () => {
    const worker = await loadWorker();
    worker.dispatch(encodeRequest("runtime-encode"));
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));

    const dispatch = worker.posted[0]!;
    expect(dispatch.response).toMatchObject({
      type: "studio-will-v1-opc/encode-success",
      requestId: "runtime-encode",
    });
    if (dispatch.response.type !== "studio-will-v1-opc/encode-success") {
      throw new Error("Expected encode success");
    }
    expect(dispatch.transfer).toEqual([
      dispatch.response.archive.buffer,
      dispatch.response.packedResult.buffer,
    ]);
    const result = unpackStudioWillV1OpcBuildResult(
      dispatch.response.archive,
      dispatch.response.packedResult,
    );
    expect(result).toMatchObject({
      assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
      paths: [{ strokeWidths: [1, 2, 3, 4] }],
    });
  });

  it("reads Blob input in-Worker and transfers a packed decode result", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const worker = await loadWorker();
    worker.dispatch({
      type: "studio-will-v1-opc/decode",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "runtime-decode",
      source: new Blob([built.bytes.slice().buffer as ArrayBuffer]),
    } satisfies StudioWillV1OpcWorkerRequest);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));

    const dispatch = worker.posted[0]!;
    expect(dispatch.response.type).toBe("studio-will-v1-opc/decode-success");
    if (dispatch.response.type !== "studio-will-v1-opc/decode-success") {
      throw new Error("Expected decode success");
    }
    expect(dispatch.transfer).toEqual([dispatch.response.packedResult.buffer]);
    expect(unpackStudioWillV1OpcImportResult(
      dispatch.response.packedResult,
    )).toMatchObject({
      width: SAMPLE_INPUT.width,
      height: SAMPLE_INPUT.height,
      title: SAMPLE_INPUT.title,
      assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
    });
  });

  it("applies the UI point-object admission budget inside the Worker parser", async () => {
    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const worker = await loadWorker();
    worker.dispatch({
      type: "studio-will-v1-opc/decode",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "runtime-bounded-decode",
      source: built.bytes.slice(),
      options: {
        willLimits: {
          maxTotalPoints: 3,
        },
      },
    } satisfies StudioWillV1OpcWorkerRequest);
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));

    expect(worker.posted[0]!.response).toMatchObject({
      type: "studio-will-v1-opc/failure",
      requestId: "runtime-bounded-decode",
      operation: "decode",
      error: { code: "RESOURCE_LIMIT" },
    });
  });

  it("returns typed failures for malformed packets and archives", async () => {
    const malformedWorker = await loadWorker();
    const malformed = encodeRequest("malformed");
    if (malformed.type !== "studio-will-v1-opc/encode") throw new Error("encode");
    malformed.packedInput[0] = 0;
    malformedWorker.dispatch(malformed);
    await vi.waitFor(() => expect(malformedWorker.posted).toHaveLength(1));
    expect(malformedWorker.posted[0]!.response).toMatchObject({
      type: "studio-will-v1-opc/failure",
      requestId: "malformed",
      operation: "encode",
      error: { code: "INVALID_REQUEST" },
    });

    const archiveWorker = await loadWorker();
    archiveWorker.dispatch({
      type: "studio-will-v1-opc/decode",
      version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
      requestId: "bad-archive",
      source: new Uint8Array([1, 2, 3]),
    });
    await vi.waitFor(() => expect(archiveWorker.posted).toHaveLength(1));
    expect(archiveWorker.posted[0]!.response).toMatchObject({
      type: "studio-will-v1-opc/failure",
      requestId: "bad-archive",
      operation: "decode",
      error: { code: "ARCHIVE_INVALID" },
    });
  });

  it("remains one-shot and fails closed when response postMessage fails", async () => {
    const oneShot = await loadWorker();
    oneShot.dispatch(encodeRequest("first"));
    oneShot.dispatch(encodeRequest("second"));
    await vi.waitFor(() => expect(oneShot.posted).toHaveLength(2));
    expect(oneShot.posted.some(({ response }) =>
      response.type === "studio-will-v1-opc/failure"
      && response.requestId === "second"
      && response.error.code === "INVALID_REQUEST"
    )).toBe(true);

    const broken = await loadWorker({ postThrows: true });
    broken.dispatch(encodeRequest("post-failure"));
    await vi.waitFor(() => expect(broken.close).toHaveBeenCalledOnce());
    expect(broken.posted).toHaveLength(0);
  });
});
