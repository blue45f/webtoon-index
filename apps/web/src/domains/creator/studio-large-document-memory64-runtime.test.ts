import { describe, expect, it } from "vitest";

import {
  STUDIO_LARGE_DOCUMENT_MAX_HYDRATION_CHUNK_BYTES,
  StudioLargeDocumentMemory64Runtime,
  StudioLargeDocumentMemory64RuntimeError,
} from "./studio-large-document-memory64-runtime";
import {
  checkStudioWasm64Capability,
  createStudioWasmMemoryRuntime,
  STUDIO_WASM_PAGE_BYTES,
} from "./studio-wasm64-memory-governor";

import type {
  StudioLargeDocumentWorkingSetWindow,
} from "./studio-large-document-address-space";

const FOUR_GIB = BigInt(1) << BigInt(32);

function workingSetWindow(
  byteOffset: bigint,
  byteLength: bigint,
): StudioLargeDocumentWorkingSetWindow {
  return Object.freeze({
    focusSlotIndex: BigInt(0),
    firstSlotIndex: BigInt(0),
    lastSlotIndexExclusive: BigInt(1),
    tileCount: BigInt(1),
    byteOffset,
    byteLength,
    byteEndExclusive: byteOffset + byteLength,
  });
}

function memory32Bridge(input: {
  readonly initialPages?: bigint;
  readonly maximumPages?: bigint;
  readonly maxResidentBytes?: bigint;
  readonly chunkBytes?: number;
} = {}): {
  readonly bridge: StudioLargeDocumentMemory64Runtime;
  readonly runtime: NonNullable<
    ReturnType<typeof createStudioWasmMemoryRuntime> extends infer Result
      ? Result extends { readonly ok: true; readonly runtime: infer Runtime }
        ? Runtime
        : never
      : never
  >;
} {
  const result = createStudioWasmMemoryRuntime({
    selectedMode: "i32",
    initialPages: input.initialPages ?? BigInt(1),
    maximumPages: input.maximumPages ?? BigInt(4),
  });
  if (!result.ok) {
    throw new Error(`Memory32 test runtime unavailable: ${result.reason}`);
  }
  return {
    runtime: result.runtime,
    bridge: new StudioLargeDocumentMemory64Runtime({
      runtime: result.runtime,
      maxResidentBytes:
        input.maxResidentBytes ?? STUDIO_WASM_PAGE_BYTES * BigInt(4),
      ...(input.chunkBytes ? { chunkBytes: input.chunkBytes } : {}),
    }),
  };
}

describe("StudioLargeDocumentMemory64Runtime working-set mapping", () => {
  it("grows actual Memory32 memory and maps a >4 GiB logical window exactly", () => {
    const { bridge, runtime } = memory32Bridge();
    const globalOffset = FOUR_GIB + BigInt(17);
    const byteLength = STUDIO_WASM_PAGE_BYTES + BigInt(37);
    const activation = bridge.activateWindow(
      workingSetWindow(globalOffset, byteLength),
    );

    expect(activation.ok).toBe(true);
    if (!activation.ok) return;
    expect(runtime.currentPages).toBe(BigInt(2));
    expect(runtime.generation).toBe(1);
    expect(activation.handle.generation).toBe(1);
    expect(activation.handle.residentView.buffer).toBe(runtime.memory.buffer);
    expect(activation.handle.residentView.byteLength).toBe(Number(byteLength));

    expect(
      bridge.globalToResident(
        activation.handle,
        globalOffset + BigInt(123),
      ),
    ).toEqual({ ok: true, address: BigInt(123) });
    expect(
      bridge.residentToGlobal(activation.handle, BigInt(123)),
    ).toEqual({ ok: true, address: globalOffset + BigInt(123) });
    expect(
      bridge.globalToResident(
        activation.handle,
        globalOffset + byteLength,
      ),
    ).toEqual({ ok: false, reason: "address-outside-window" });

    const view = bridge.createResidentView(
      activation.handle,
      globalOffset + BigInt(8),
      4,
    );
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    view.viewHandle.view.set([7, 8, 9, 10]);
    expect(new Uint8Array(runtime.memory.buffer, 8, 4)).toEqual(
      new Uint8Array([7, 8, 9, 10]),
    );
    expect(bridge.isViewHandleCurrent(view.viewHandle)).toBe(true);
  });

  it("fails closed for malformed, Number-unsafe, and over-budget windows", () => {
    const { bridge } = memory32Bridge({
      maximumPages: BigInt(2),
      maxResidentBytes: STUDIO_WASM_PAGE_BYTES * BigInt(2),
    });
    const malformed = {
      ...workingSetWindow(BigInt(0), BigInt(1)),
      byteEndExclusive: BigInt(2),
    };

    expect(bridge.activateWindow(malformed)).toEqual({
      ok: false,
      reason: "invalid-window",
    });
    expect(
      bridge.activateWindow(
        workingSetWindow(
          BigInt(0),
          BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
        ),
      ),
    ).toEqual({ ok: false, reason: "number-safe-range-exceeded" });
    expect(
      bridge.activateWindow(
        workingSetWindow(
          BigInt(0),
          STUDIO_WASM_PAGE_BYTES * BigInt(2) + BigInt(1),
        ),
      ),
    ).toEqual({ ok: false, reason: "resident-budget-exceeded" });
  });

  it("invalidates old handles and detached views after a grow generation", () => {
    const { bridge, runtime } = memory32Bridge();
    const first = bridge.activateWindow(
      workingSetWindow(FOUR_GIB, STUDIO_WASM_PAGE_BYTES),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const oldBuffer = first.handle.residentView.buffer;

    const second = bridge.activateWindow(
      workingSetWindow(
        FOUR_GIB + STUDIO_WASM_PAGE_BYTES,
        STUDIO_WASM_PAGE_BYTES * BigInt(2),
      ),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(runtime.generation).toBe(1);
    expect(oldBuffer.byteLength).toBe(0);
    expect(bridge.isHandleCurrent(first.handle)).toBe(false);
    expect(bridge.isHandleCurrent(second.handle)).toBe(true);
    expect(
      bridge.createResidentView(first.handle, FOUR_GIB, 1),
    ).toEqual({ ok: false, reason: "stale-handle" });

    const externalGrow = runtime.growToFit(
      STUDIO_WASM_PAGE_BYTES * BigInt(3),
    );
    expect(externalGrow.ok).toBe(true);
    expect(runtime.generation).toBe(2);
    expect(bridge.isHandleCurrent(second.handle)).toBe(false);
  });
});

describe("StudioLargeDocumentMemory64Runtime chunking and hydration", () => {
  it("iterates bounded resident views without narrowing global BigInt addresses", () => {
    const { bridge } = memory32Bridge({
      chunkBytes: 16,
    });
    const activation = bridge.activateWindow(
      workingSetWindow(FOUR_GIB + BigInt(9), BigInt(37)),
    );
    expect(activation.ok).toBe(true);
    if (!activation.ok) return;

    const chunks = [...bridge.iterateChunks(activation.handle)];
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([16, 16, 5]);
    expect(chunks.map((chunk) => chunk.residentByteOffset)).toEqual([
      BigInt(0),
      BigInt(16),
      BigInt(32),
    ]);
    expect(chunks.map((chunk) => chunk.globalByteOffset)).toEqual([
      FOUR_GIB + BigInt(9),
      FOUR_GIB + BigInt(25),
      FOUR_GIB + BigInt(41),
    ]);
    expect(
      chunks.every(
        (chunk) =>
          chunk.byteLength
          <= STUDIO_LARGE_DOCUMENT_MAX_HYDRATION_CHUNK_BYTES,
      ),
    ).toBe(true);

    bridge.invalidateActiveWindow();
    expect(() => [...bridge.iterateChunks(activation.handle)]).toThrow(
      StudioLargeDocumentMemory64RuntimeError,
    );
  });

  it("hydrates through async ranges and publishes only the complete staged window", async () => {
    const { bridge } = memory32Bridge({ chunkBytes: 8 });
    const globalOffset = FOUR_GIB + BigInt(100);
    const activation = bridge.activateWindow(
      workingSetWindow(globalOffset, BigInt(19)),
    );
    expect(activation.ok).toBe(true);
    if (!activation.ok) return;

    const requests: Array<{ offset: bigint; length: number }> = [];
    const hydration = await bridge.hydrateWindow(activation.handle, {
      async readRange(request) {
        requests.push({
          offset: request.globalByteOffset,
          length: request.byteLength,
        });
        return Uint8Array.from(
          { length: request.byteLength },
          (_, index) =>
            Number(
              (request.globalByteOffset
                - globalOffset
                + BigInt(index))
              % BigInt(251),
            ),
        );
      },
    });

    expect(hydration.ok).toBe(true);
    if (!hydration.ok) return;
    expect(hydration.chunksHydrated).toBe(3);
    expect(hydration.bytesHydrated).toBe(BigInt(19));
    expect(requests).toEqual([
      { offset: globalOffset, length: 8 },
      { offset: globalOffset + BigInt(8), length: 8 },
      { offset: globalOffset + BigInt(16), length: 3 },
    ]);
    expect([...hydration.viewHandle.view]).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(bridge.isViewHandleCurrent(hydration.viewHandle)).toBe(true);
  });

  it("rejects aborted reads before publishing staged bytes", async () => {
    const { bridge } = memory32Bridge({ chunkBytes: 8 });
    const activation = bridge.activateWindow(
      workingSetWindow(BigInt(200), BigInt(8)),
    );
    expect(activation.ok).toBe(true);
    if (!activation.ok) return;
    activation.handle.residentView.fill(91);

    const abortController = new AbortController();
    let resolveRead:
      | ((value: Uint8Array) => void)
      | undefined;
    const pending = bridge.hydrateWindow(
      activation.handle,
      {
        readRange() {
          return new Promise<Uint8Array>((resolve) => {
            resolveRead = resolve;
          });
        },
      },
      { signal: abortController.signal },
    );
    abortController.abort();
    resolveRead?.(new Uint8Array(8).fill(3));

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "aborted",
    });
    expect([...activation.handle.residentView]).toEqual(
      new Array<number>(8).fill(91),
    );
  });

  it("rejects an old epoch before a delayed range can overwrite the new window", async () => {
    const { bridge } = memory32Bridge({ chunkBytes: 8 });
    const first = bridge.activateWindow(
      workingSetWindow(BigInt(300), BigInt(8)),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    let resolveRead:
      | ((value: Uint8Array) => void)
      | undefined;
    const pending = bridge.hydrateWindow(first.handle, {
      readRange() {
        return new Promise<Uint8Array>((resolve) => {
          resolveRead = resolve;
        });
      },
    });
    const second = bridge.activateWindow(
      workingSetWindow(BigInt(500), BigInt(8)),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    second.handle.residentView.fill(77);
    resolveRead?.(new Uint8Array(8).fill(4));

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "stale-handle",
    });
    expect([...second.handle.residentView]).toEqual(
      new Array<number>(8).fill(77),
    );
  });

  it("rejects short source ranges without exposing a partial write", async () => {
    const { bridge } = memory32Bridge({ chunkBytes: 8 });
    const activation = bridge.activateWindow(
      workingSetWindow(BigInt(0), BigInt(8)),
    );
    expect(activation.ok).toBe(true);
    if (!activation.ok) return;
    activation.handle.residentView.fill(55);

    const hydration = await bridge.hydrateWindow(activation.handle, {
      async readRange() {
        return new Uint8Array(7).fill(1);
      },
    });
    expect(hydration).toEqual({
      ok: false,
      reason: "source-byte-length-mismatch",
      failedGlobalByteOffset: BigInt(0),
      expectedByteLength: 8,
      actualByteLength: 7,
    });
    expect([...activation.handle.residentView]).toEqual(
      new Array<number>(8).fill(55),
    );
  });
});

describe("StudioLargeDocumentMemory64Runtime actual Memory64 path", () => {
  it("uses an i64-addressed WebAssembly.Memory when this host implements Memory64", () => {
    const capability = checkStudioWasm64Capability();
    const result = createStudioWasmMemoryRuntime({
      initialPages: BigInt(1),
      maximumPages: BigInt(3),
    });

    if (!capability.isWasm64Supported) {
      expect(result).toMatchObject({
        ok: false,
        reason: "memory64-unsupported",
      });
      return;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bridge = new StudioLargeDocumentMemory64Runtime({
      runtime: result.runtime,
      maxResidentBytes: STUDIO_WASM_PAGE_BYTES * BigInt(3),
      chunkBytes: 1024,
    });
    const globalOffset = FOUR_GIB + BigInt(123_456);
    const activation = bridge.activateWindow(
      workingSetWindow(
        globalOffset,
        STUDIO_WASM_PAGE_BYTES + BigInt(1),
      ),
    );
    expect(activation.ok).toBe(true);
    if (!activation.ok) return;

    expect(result.runtime.addressType).toBe("i64");
    expect(result.runtime.selection).toBe("memory64");
    expect(activation.handle.residentView.buffer).toBe(
      result.runtime.memory.buffer,
    );
    expect(
      bridge.globalToResident(
        activation.handle,
        globalOffset + STUDIO_WASM_PAGE_BYTES,
      ),
    ).toEqual({
      ok: true,
      address: STUDIO_WASM_PAGE_BYTES,
    });
  });

  it("refuses chunk sizes above the 64 MiB transfer boundary", () => {
    const result = createStudioWasmMemoryRuntime({
      selectedMode: "i32",
      initialPages: BigInt(1),
      maximumPages: BigInt(2),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      () =>
        new StudioLargeDocumentMemory64Runtime({
          runtime: result.runtime,
          maxResidentBytes: STUDIO_WASM_PAGE_BYTES * BigInt(2),
          chunkBytes:
            STUDIO_LARGE_DOCUMENT_MAX_HYDRATION_CHUNK_BYTES + 1,
        }),
    ).toThrow(/chunkBytes/);
  });
});
