/**
 * Actual Chromium WebGPU readback for the exact per-deposition dual-tip v2 route.
 *
 * The selected center pixels sample constant R8 coverage, which lets the independent CPU oracle
 * exercise the normative ordering without reproducing the shader's rasterizer. This covers the
 * 0.0975 non-aggregate regression, all eight public blend families, append/rebuild, erasing and
 * varying paint color/alpha.
 */
import {
  combineStudioDualTipExactCoverageV2,
  compositeStudioDualTipExactDepositionV2,
} from "../apps/web/src/domains/creator/studio-dual-brush-tip-engine";
import {
  buildStudioDynamicDualTipExactPlanV2,
  createStudioDynamicDualTipExactWebGpuRuntimeV2,
} from "../apps/web/src/domains/creator/studio-dynamic-dual-tip-webgpu-runtime-v2";

import type {
  StudioDualTipExactBlendFamily,
  StudioDualTipExactDepositionPixel,
  StudioDualTipPremultipliedLinearRgba,
} from "../apps/web/src/domains/creator/studio-dual-brush-tip-engine";
import type {
  StudioDynamicDualTipExactDepositionInputV2,
  StudioDynamicDualTipExactPlanV2,
  StudioDynamicDualTipExactWebGpuReceiptV2,
  StudioDynamicDualTipExactWebGpuRuntimeV2,
} from "../apps/web/src/domains/creator/studio-dynamic-dual-tip-webgpu-runtime-v2";

const WIDTH = 80;
const HEIGHT = 32;
const DEVICE_EPOCH = 1;
const MAP_READ = 0x0001;
const BUFFER_COPY_DST = 0x0008;
const ROW_ALIGNMENT = 256;
const RGBA16_BYTES_PER_PIXEL = 8;
const TOLERANCE = 0.002;
const FULL_R8 = new Uint8Array([255]);
const FAMILIES: readonly PublicFamily[] = [
  "intersect",
  "darken",
  "lighten",
  "multiply",
  "screen",
  "add",
  "subtract",
  "difference",
];

type Pixel = readonly [number, number, number, number];
type PublicFamily = Exclude<StudioDualTipExactBlendFamily, "soft-intersect">;
type FamilyEvidence = Readonly<Record<
  PublicFamily,
  Readonly<{
    cpu: Pixel;
    gpu: Pixel;
    combinedCoverage: number;
    maxDelta: number;
  }>
>>;

type BrowserResult =
  | Readonly<{
      status: "ok";
      backend: "exact-dual-tip-v2-rgba16float-webgpu";
      capabilities: {
        readonly webgpu: true;
        readonly userAgent: string;
      };
      providerCapability: "dynamic-dual-tip-deposition-r8-v2";
      executionRoute: "webgpu-exact-packed-deposition-v2";
      tolerance: number;
      regression0975: {
        readonly cpu: Pixel;
        readonly gpu: Pixel;
        readonly expectedAlpha: 0.0975;
        readonly aggregateForbiddenAlpha: 0.1425;
        readonly maxDelta: number;
      };
      families: FamilyEvidence;
      append: {
        readonly cpu: Pixel;
        readonly gpu: Pixel;
        readonly maxDelta: number;
      };
      rebuild: {
        readonly cpu: Pixel;
        readonly gpu: Pixel;
        readonly maxDelta: number;
      };
      destinationOut: {
        readonly beforeAlpha: number;
        readonly cpu: Pixel;
        readonly gpu: Pixel;
        readonly maxDelta: number;
      };
      receipts: readonly StudioDynamicDualTipExactWebGpuReceiptV2[];
      shaderMessages: readonly {
        readonly type: string;
        readonly message: string;
        readonly lineNum: number;
        readonly linePos: number;
      }[][];
      gpuErrors: {
        readonly validation: string | null;
        readonly outOfMemory: string | null;
        readonly uncaptured: readonly string[];
      };
    }>
  | Readonly<{
      status: "unsupported";
      reason: string;
      capabilities: {
        readonly webgpu: boolean;
        readonly userAgent: string;
      };
    }>
  | Readonly<{
      status: "error";
      message: string;
      stack: string | null;
      capabilities: {
        readonly webgpu: boolean;
        readonly userAgent: string;
      };
    }>;

declare global {
  interface Window {
    __studioDynamicDualTipWebGpuV2Result?: BrowserResult;
  }
}

const float32Scratch = new Float32Array(1);
const uint32Scratch = new Uint32Array(float32Scratch.buffer);

function capabilities() {
  return {
    webgpu: navigator.gpu !== undefined,
    userAgent: navigator.userAgent,
  };
}

function nextAligned(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function float16ToFloat32(value: number): number {
  const sign = (value & 0x8000) << 16;
  let exponent = (value >>> 10) & 0x1f;
  let mantissa = value & 0x03ff;
  let bits: number;
  if (exponent === 0) {
    if (mantissa === 0) {
      bits = sign;
    } else {
      exponent = 1;
      while ((mantissa & 0x0400) === 0) {
        mantissa <<= 1;
        exponent -= 1;
      }
      mantissa &= 0x03ff;
      bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
    }
  } else if (exponent === 31) {
    bits = sign | 0x7f80_0000 | (mantissa << 13);
  } else {
    bits = sign | ((exponent + 112) << 23) | (mantissa << 13);
  }
  uint32Scratch[0] = bits >>> 0;
  return float32Scratch[0]!;
}

function pixel(words: Uint16Array, x: number, y: number): Pixel {
  const offset = (y * WIDTH + x) * 4;
  return [
    float16ToFloat32(words[offset]!),
    float16ToFloat32(words[offset + 1]!),
    float16ToFloat32(words[offset + 2]!),
    float16ToFloat32(words[offset + 3]!),
  ];
}

function maxDelta(left: Pixel, right: Pixel): number {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index]!)));
}

function deposition(
  center: readonly [number, number],
  family: StudioDualTipExactBlendFamily,
  paintAlpha: number,
  linearColor: readonly [number, number, number],
  options: Readonly<{
    primaryOpacity?: number;
    secondaryOpacity?: number;
    porterDuff?: "source-over" | "destination-out";
  }> = {},
): StudioDynamicDualTipExactDepositionInputV2 {
  return {
    primary: {
      center,
      localToDocument: [2, 0, 0, 2],
      maskOpacity: options.primaryOpacity ?? 1,
      hardness: -1,
    },
    secondary: {
      center,
      localToDocument: [2, 0, 0, 2],
      maskOpacity: options.secondaryOpacity ?? 1,
      hardness: -1,
    },
    paintAlpha,
    linearColor,
    blendFamily: family,
    porterDuff: options.porterDuff ?? "source-over",
  };
}

function plan(
  mode: "append" | "rebuild",
  commandSequence: number,
  depositions: readonly StudioDynamicDualTipExactDepositionInputV2[],
): StudioDynamicDualTipExactPlanV2 {
  const result = buildStudioDynamicDualTipExactPlanV2({
    mode,
    strokeId: `chromium-v2-${commandSequence}`,
    commandSequence,
    primaryAsset: {
      assetId: "chromium-v2-primary",
      width: 1,
      height: 1,
      channel: "alpha",
      bytes: FULL_R8,
    },
    secondaryAsset: {
      assetId: "chromium-v2-secondary",
      width: 1,
      height: 1,
      channel: "alpha",
      bytes: FULL_R8,
    },
    depositions,
  });
  if (result.status !== "ready") {
    throw new Error(`exact v2 plan failed: ${result.reason}`);
  }
  return result.plan;
}

function cpu(
  destination: StudioDualTipPremultipliedLinearRgba,
  input: Readonly<{
    primaryCoverage: number;
    secondaryCoverage: number;
    paintAlpha: number;
    linearColor: readonly [number, number, number];
    blendFamily: StudioDualTipExactBlendFamily;
    porterDuff?: "source-over" | "destination-out";
  }>,
): StudioDualTipPremultipliedLinearRgba {
  const oracle: StudioDualTipExactDepositionPixel = {
    primaryCoverage: input.primaryCoverage,
    secondaryCoverage: input.secondaryCoverage,
    paintAlpha: input.paintAlpha,
    linearColor: input.linearColor,
    blendFamily: input.blendFamily,
    porterDuff: input.porterDuff ?? "source-over",
  };
  return compositeStudioDualTipExactDepositionV2(destination, oracle);
}

function observeDevice(rawDevice: GPUDevice): Readonly<{
  device: GPUDevice;
  authorityTextures: GPUTexture[];
  shaderModules: GPUShaderModule[];
}> {
  const authorityTextures: GPUTexture[] = [];
  const shaderModules: GPUShaderModule[] = [];
  const queue = new Proxy(rawDevice.queue, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...arguments_: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  const device = new Proxy(rawDevice, {
    get(target, property) {
      if (property === "queue") return queue;
      if (property === "createTexture") {
        return (descriptor: GPUTextureDescriptor): GPUTexture => {
          const texture = target.createTexture(descriptor);
          if (
            descriptor.label
            === "Studio exact dual-tip v2 rgba16float authority"
          ) authorityTextures.push(texture);
          return texture;
        };
      }
      if (property === "createShaderModule") {
        return (descriptor: GPUShaderModuleDescriptor): GPUShaderModule => {
          const module = target.createShaderModule(descriptor);
          shaderModules.push(module);
          return module;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function"
        ? (value as (...arguments_: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as GPUDevice;
  return { device, authorityTextures, shaderModules };
}

async function readAuthority(
  rawDevice: GPUDevice,
  texture: GPUTexture,
): Promise<Uint16Array> {
  const bytesPerRow = nextAligned(WIDTH * RGBA16_BYTES_PER_PIXEL, ROW_ALIGNMENT);
  const buffer = rawDevice.createBuffer({
    label: "Studio exact dual-tip v2 aligned readback",
    size: bytesPerRow * HEIGHT,
    usage: MAP_READ | BUFFER_COPY_DST,
  });
  const encoder = rawDevice.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: HEIGHT },
    { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 },
  );
  rawDevice.queue.submit([encoder.finish()]);
  await rawDevice.queue.onSubmittedWorkDone();
  await buffer.mapAsync(MAP_READ);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const words = new Uint16Array(WIDTH * HEIGHT * 4);
  for (let row = 0; row < HEIGHT; row += 1) {
    words.set(
      new Uint16Array(
        mapped.buffer,
        mapped.byteOffset + row * bytesPerRow,
        WIDTH * 4,
      ),
      row * WIDTH * 4,
    );
  }
  buffer.unmap();
  buffer.destroy();
  return words;
}

async function execute(
  runtime: StudioDynamicDualTipExactWebGpuRuntimeV2,
  requestSequence: number,
  executionPlan: StudioDynamicDualTipExactPlanV2,
): Promise<StudioDynamicDualTipExactWebGpuReceiptV2> {
  const result = await runtime.execute({
    requestSequence,
    deviceEpoch: DEVICE_EPOCH,
    plan: executionPlan,
  });
  if (result.status !== "completed") {
    throw new Error(`exact v2 runtime failed: ${result.status}`);
  }
  return result.receipt;
}

async function run(): Promise<BrowserResult> {
  if (!navigator.gpu) {
    return {
      status: "unsupported",
      reason: "navigator.gpu unavailable",
      capabilities: capabilities(),
    };
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    return {
      status: "unsupported",
      reason: "GPU adapter unavailable",
      capabilities: capabilities(),
    };
  }
  const rawDevice = await adapter.requestDevice();
  const uncaptured: string[] = [];
  rawDevice.addEventListener("uncapturederror", (event) => {
    uncaptured.push(event.error.message);
  });
  rawDevice.pushErrorScope("validation");
  rawDevice.pushErrorScope("out-of-memory");
  const observed = observeDevice(rawDevice);
  const creation = createStudioDynamicDualTipExactWebGpuRuntimeV2({
    device: observed.device,
    width: WIDTH,
    height: HEIGHT,
    initialDeviceEpoch: DEVICE_EPOCH,
  });
  if (creation.status !== "ready") {
    throw new Error(`exact v2 runtime initialization failed: ${creation.reason}`);
  }
  const authority = observed.authorityTextures[0];
  if (!authority) throw new Error("exact v2 authority texture was not observed");
  const receipts: StudioDynamicDualTipExactWebGpuReceiptV2[] = [];

  const regressionCenter = [40.5, 20.5] as const;
  const regressionDeposition = deposition(
    regressionCenter,
    "intersect",
    0.2,
    [0.8, 0.4, 0.2],
    { primaryOpacity: 0.5, secondaryOpacity: 0.5 },
  );
  receipts.push(await execute(
    creation.runtime,
    1,
    plan("rebuild", 1, [regressionDeposition, regressionDeposition]),
  ));
  const regressionWords = await readAuthority(rawDevice, authority);
  let regressionCpu: StudioDualTipPremultipliedLinearRgba = [0, 0, 0, 0];
  regressionCpu = cpu(regressionCpu, {
    primaryCoverage: 0.5,
    secondaryCoverage: 0.5,
    paintAlpha: 0.2,
    linearColor: [0.8, 0.4, 0.2],
    blendFamily: "intersect",
  });
  regressionCpu = cpu(regressionCpu, {
    primaryCoverage: 0.5,
    secondaryCoverage: 0.5,
    paintAlpha: 0.2,
    linearColor: [0.8, 0.4, 0.2],
    blendFamily: "intersect",
  });
  const regressionGpu = pixel(
    regressionWords,
    Math.floor(regressionCenter[0]),
    Math.floor(regressionCenter[1]),
  );

  const familyDepositions = FAMILIES.map((family, index) => deposition(
    [5.5 + index * 9, 6.5],
    family,
    0.8,
    [0.15 + index * 0.07, 0.8 - index * 0.06, 0.25 + index * 0.05],
    { primaryOpacity: 0.35, secondaryOpacity: 0.65 },
  ));
  receipts.push(await execute(
    creation.runtime,
    2,
    plan("rebuild", 2, familyDepositions),
  ));
  const familyWords = await readAuthority(rawDevice, authority);
  const families = Object.fromEntries(FAMILIES.map((family, index) => {
    const color = familyDepositions[index]!.linearColor;
    const expected = cpu([0, 0, 0, 0], {
      primaryCoverage: 0.35,
      secondaryCoverage: 0.65,
      paintAlpha: 0.8,
      linearColor: color,
      blendFamily: family,
    });
    const actual = pixel(familyWords, 5 + index * 9, 6);
    return [family, {
      cpu: expected,
      gpu: actual,
      combinedCoverage: combineStudioDualTipExactCoverageV2(0.35, 0.65, family),
      maxDelta: maxDelta(expected, actual),
    }];
  })) as FamilyEvidence;

  const sequenceCenter = [30.5, 20.5] as const;
  const base = deposition(sequenceCenter, "multiply", 0.4, [1, 0, 0]);
  const added = deposition(sequenceCenter, "multiply", 0.5, [0, 0, 1]);
  receipts.push(await execute(creation.runtime, 3, plan("rebuild", 3, [base])));
  receipts.push(await execute(creation.runtime, 4, plan("append", 4, [added])));
  const appendGpu = pixel(
    await readAuthority(rawDevice, authority),
    Math.floor(sequenceCenter[0]),
    Math.floor(sequenceCenter[1]),
  );
  const appendCpu = cpu(
    cpu([0, 0, 0, 0], {
      primaryCoverage: 1,
      secondaryCoverage: 1,
      paintAlpha: 0.4,
      linearColor: [1, 0, 0],
      blendFamily: "multiply",
    }),
    {
      primaryCoverage: 1,
      secondaryCoverage: 1,
      paintAlpha: 0.5,
      linearColor: [0, 0, 1],
      blendFamily: "multiply",
    },
  );
  const rebuilt = deposition(sequenceCenter, "screen", 0.3, [0, 1, 0]);
  receipts.push(await execute(
    creation.runtime,
    5,
    plan("rebuild", 5, [rebuilt]),
  ));
  const rebuildGpu = pixel(
    await readAuthority(rawDevice, authority),
    Math.floor(sequenceCenter[0]),
    Math.floor(sequenceCenter[1]),
  );
  const rebuildCpu = cpu([0, 0, 0, 0], {
    primaryCoverage: 1,
    secondaryCoverage: 1,
    paintAlpha: 0.3,
    linearColor: [0, 1, 0],
    blendFamily: "screen",
  });

  const eraseBase = deposition(sequenceCenter, "add", 0.8, [0.25, 0.5, 1]);
  const erase = deposition(
    sequenceCenter,
    "add",
    0.25,
    [1, 1, 1],
    { porterDuff: "destination-out" },
  );
  receipts.push(await execute(
    creation.runtime,
    6,
    plan("rebuild", 6, [eraseBase]),
  ));
  const eraseBefore = pixel(
    await readAuthority(rawDevice, authority),
    Math.floor(sequenceCenter[0]),
    Math.floor(sequenceCenter[1]),
  );
  receipts.push(await execute(
    creation.runtime,
    7,
    plan("append", 7, [erase]),
  ));
  const eraseGpu = pixel(
    await readAuthority(rawDevice, authority),
    Math.floor(sequenceCenter[0]),
    Math.floor(sequenceCenter[1]),
  );
  const eraseCpu = cpu(
    cpu([0, 0, 0, 0], {
      primaryCoverage: 1,
      secondaryCoverage: 1,
      paintAlpha: 0.8,
      linearColor: [0.25, 0.5, 1],
      blendFamily: "add",
    }),
    {
      primaryCoverage: 1,
      secondaryCoverage: 1,
      paintAlpha: 0.25,
      linearColor: [1, 1, 1],
      blendFamily: "add",
      porterDuff: "destination-out",
    },
  );

  const shaderMessages = await Promise.all(observed.shaderModules.map(async (module) => (
    (await module.getCompilationInfo()).messages.map((message) => ({
      type: message.type,
      message: message.message,
      lineNum: message.lineNum,
      linePos: message.linePos,
    }))
  )));
  const outOfMemory = await rawDevice.popErrorScope();
  const validation = await rawDevice.popErrorScope();
  creation.runtime.dispose();
  rawDevice.destroy();

  return {
    status: "ok",
    backend: "exact-dual-tip-v2-rgba16float-webgpu",
    capabilities: { webgpu: true, userAgent: navigator.userAgent },
    providerCapability: "dynamic-dual-tip-deposition-r8-v2",
    executionRoute: "webgpu-exact-packed-deposition-v2",
    tolerance: TOLERANCE,
    regression0975: {
      cpu: regressionCpu,
      gpu: regressionGpu,
      expectedAlpha: 0.0975,
      aggregateForbiddenAlpha: 0.1425,
      maxDelta: maxDelta(regressionCpu, regressionGpu),
    },
    families,
    append: {
      cpu: appendCpu,
      gpu: appendGpu,
      maxDelta: maxDelta(appendCpu, appendGpu),
    },
    rebuild: {
      cpu: rebuildCpu,
      gpu: rebuildGpu,
      maxDelta: maxDelta(rebuildCpu, rebuildGpu),
    },
    destinationOut: {
      beforeAlpha: eraseBefore[3],
      cpu: eraseCpu,
      gpu: eraseGpu,
      maxDelta: maxDelta(eraseCpu, eraseGpu),
    },
    receipts,
    shaderMessages,
    gpuErrors: {
      validation: validation?.message ?? null,
      outOfMemory: outOfMemory?.message ?? null,
      uncaptured,
    },
  };
}

void run()
  .then((result) => {
    window.__studioDynamicDualTipWebGpuV2Result = result;
  })
  .catch((error: unknown) => {
    window.__studioDynamicDualTipWebGpuV2Result = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: capabilities(),
    };
  });
