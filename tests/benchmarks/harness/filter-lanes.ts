/**
 * Production filter-lane benchmark (V11 필터 레인 실측).
 *
 * 기존 필터 계측은 후보 라이브러리 512² 단발(filter-candidates.json)과 다운스케일·블러 품질
 * (quality-lab.json)뿐이었다. 이 하니스는 **실제 스튜디오가 태우는 필터 체인**을 현실적인
 * 캔버스 크기에서 레인별로 잰다. 프로덕션 폴백 순서는 StudioKonvaImageNode 가
 * planStudioFilterIslandLanes 로 세우는 `gpu-chain → worker → konva-native` 이고, 이 파일은
 * 그중 **CPU 두 레인 + Worker 레인**을 담당한다(GPU 레인은 브라우저에서만 가능 →
 * packages/studio-engine-registry/src/__tests__/filter-lanes-browser-probe.test.ts 가 같은
 * JSON 에 병합 기록한다).
 *
 * 측정 레인(전부 프로덕션 모듈 그대로, 재구현 없음):
 *  - `worker-cpu`     : src/domains/creator/studio-image-filter.worker.ts **원본 모듈**을
 *                       node worker_threads 안에서 그대로 import 하고(DedicatedWorkerGlobalScope
 *                       셰임만 얹는다), 프로덕션 상주 원본 프로토콜(load-source 1회 →
 *                       run-source 매 tick → 결과 ArrayBuffer transfer)로 왕복시킨 벽시계.
 *                       = 인터랙티브 슬라이더 tick 의 실제 메인스레드 지연.
 *  - `direct-cpu`     : studio-image-filter-worker-client.ts 의 `runImageFilterDirect` 와 동일한
 *                       구성(빈 레지스트리 + registerStudioKonvaFilters = 네이티브 포팅)으로
 *                       buildImageFilters/applyImageFilters 를 메인스레드 동기 실행.
 *                       messaging/transfer 가 0 이라 `worker-cpu` 와의 차이가 곧 왕복 비용이다.
 *  - `konva-fallback` : StudioKonvaImageNode 의 비-Worker 경로와 동일하게 **실제 konva 패키지
 *                       레지스트리**(Konva.Filters + registerStudioKonvaFilters)로 빌드해
 *                       필터 배열을 적용한다(Konva `_getCachedSceneCanvas` 의 filter.call 루프와
 *                       동일 — applyImageFilters 가 그 루프의 추출본이다).
 *
 * 정직성 규칙(main.ts 와 동일):
 *  - 전부 실제 실행. 반복마다 performance.now() 벽시계, 전체 표본을 JSON 에 보존해 p50/p95 재계산 가능.
 *  - 병행 부하를 측정 전/후 loadavg 와 함께 기록한다(이 머신은 다른 에이전트 빌드/소크가 병행).
 *    레인 간 비교는 중앙값(p50) 기준이고, 크기·체인 셀마다 레인을 **교차 실행**해 드리프트가
 *    한 레인에만 실리지 않게 한다.
 *  - 품질(최대 채널 오차)을 성능과 같은 실행에서 기록한다 — 빠른데 픽셀이 다르면 무의미하므로.
 *
 * 실행: pnpm exec tsx tests/benchmarks/harness/filter-lanes.ts
 *       (FILTER_LANES_QUICK=1 이면 1024² 만 짧게 — 스모크용)
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { arch, cpus, loadavg, platform, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

import {
  planStudioGpuFilterChain,
  isStudioGpuFilterChainEligible,
} from "../../../apps/web/src/domains/creator/render/studio-gpu-filter-apply";
import {
  applyImageFilters,
  buildImageFilters,
  registerStudioKonvaFilters,
  type KonvaLike,
} from "../../../apps/web/src/domains/creator/render/studio-konva-filters";
import { STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION } from "../../../apps/web/src/domains/creator/studio-image-filter-worker-protocol";

import type { ImageFilterFields } from "../../../apps/web/src/domains/creator/render/studio-konva-filter-fields";

const REPO_ROOT = new URL("../../..", import.meta.url);
const RESULTS_DIR = join(REPO_ROOT.pathname, "tests", "benchmarks", "results");
const RESULT_FILE = join(RESULTS_DIR, "filter-lanes.json");

const QUICK = process.env.FILTER_LANES_QUICK === "1";

// ---------------------------------------------------------------------------
// 매트릭스 — 캔버스 크기 × 필터 체인
// ---------------------------------------------------------------------------

/**
 * 1024² 는 컷 프리뷰/작은 말풍선 레이어, 2048² 는 세로 스크롤 웹툰 컷 한 장,
 * 4096² 는 원고 해상도 페이지 합성에 해당한다(512² 단발 계측이 놓치던 구간).
 * 256²/512² 는 레인 전환 임계를 실제로 가두기 위한 아래쪽 앵커다 — GPU 는 크기와 무관한
 * 제출/리드백 플로어(~3ms)를 무는 반면 CPU 는 픽셀 수에 선형이라, 교차점은 작은 캔버스에 있다.
 */
interface SizeSpec {
  readonly size: number;
  readonly warmup: number;
  readonly iterations: number;
}

const SIZES: readonly SizeSpec[] = QUICK
  ? [{ size: 1024, warmup: 1, iterations: 3 }]
  : [
    { size: 256, warmup: 5, iterations: 25 },
    { size: 512, warmup: 3, iterations: 20 },
    { size: 1024, warmup: 2, iterations: 15 },
    { size: 2048, warmup: 1, iterations: 9 },
    { size: 4096, warmup: 1, iterations: 5 },
  ];

/**
 * 체인은 GPU 레인이 담당하는 5 커널(밝기/대비 · HSL · 레벨 · 커브 · 컬러밸런스)을 기준으로
 * 1단 / 3단 / 5단 풀체인을 만든다 — GPU 가 감당 못 하는 필드를 하나라도 켜면 프로덕션은
 * 전체를 CPU 로 넘기므로(hasUnsupportedActiveFilters), 레인 비교가 성립하는 유일한 집합이다.
 */
interface ChainSpec {
  readonly id: string;
  readonly label: string;
  readonly steps: readonly string[];
  readonly el: ImageFilterFields;
}

const CHAINS: readonly ChainSpec[] = [
  {
    id: "single",
    label: "밝기 1단",
    steps: ["brightness"],
    el: { brightness: 0.2 },
  },
  {
    id: "triple",
    label: "밝기+대비+HSL 3단",
    steps: ["brightness", "contrast", "hsl"],
    el: { brightness: 0.2, contrast: 15, saturation: 0.4, hue: 30 },
  },
  {
    id: "full5",
    label: "밝기/대비+HSL+레벨+커브+컬러밸런스 5단 풀체인",
    steps: ["brightness", "contrast", "hsl", "levels", "curves", "colorBalance"],
    el: {
      brightness: 0.2,
      contrast: 15,
      saturation: 0.4,
      hue: 30,
      levelsBlack: 12,
      levelsWhite: 240,
      levelsGamma: 1.15,
      curve: [
        { x: 0, y: 0 },
        { x: 64, y: 48 },
        { x: 192, y: 214 },
        { x: 255, y: 255 },
      ],
      colorBalance: {
        shadows: [12, -6, -18],
        midtones: [-8, 4, 14],
        highlights: [18, 2, -10],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// 결정적 소스 픽셀 — 브라우저 프로브의 LCG 와 동일한 점화식이어야 품질 수치가 비교 가능하다.
// ---------------------------------------------------------------------------

function deterministicPixels(pixelCount: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixelCount * 4);
  let state = 0x2f6e2b1;
  for (let index = 0; index < data.length; index += 1) {
    state = (Math.imul(state, 48271) + 11) >>> 0;
    data[index] = state & 0xff;
  }
  return data;
}

// ---------------------------------------------------------------------------
// 통계
// ---------------------------------------------------------------------------

interface LaneStats {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** jank 프록시 — 병행 부하 머신에서 절대 시간보다 흔들림이 더 신호가 된다. */
  readonly jankP99OverP50: number;
  readonly mbPerSec: number;
  readonly megapixelsPerSec: number;
  readonly samplesMs: number[];
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[rank] ?? 0;
}

function summarize(samples: readonly number[], pixelCount: number): LaneStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p99 = percentile(sorted, 99);
  const megabytes = (pixelCount * 4) / 1_048_576;
  return {
    p50Ms: round3(p50),
    p95Ms: round3(percentile(sorted, 95)),
    p99Ms: round3(p99),
    meanMs: round3(samples.reduce((sum, value) => sum + value, 0) / samples.length),
    minMs: round3(sorted[0] ?? 0),
    maxMs: round3(sorted[sorted.length - 1] ?? 0),
    jankP99OverP50: p50 > 0 ? round3(p99 / p50) : 0,
    mbPerSec: p50 > 0 ? round3(megabytes / (p50 / 1000)) : 0,
    megapixelsPerSec: p50 > 0 ? round3(pixelCount / 1e6 / (p50 / 1000)) : 0,
    samplesMs: samples.map(round3),
  };
}

interface PixelDiff {
  readonly maxColorDiff: number;
  readonly mismatchedColorChannels: number;
  readonly alphaMismatches: number;
}

function diffPixels(
  actual: Uint8ClampedArray,
  expected: Uint8ClampedArray,
): PixelDiff {
  let maxColorDiff = 0;
  let mismatchedColorChannels = 0;
  let alphaMismatches = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const diff = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0));
    if (index % 4 === 3) {
      if (diff !== 0) alphaMismatches += 1;
      continue;
    }
    if (diff > 0) mismatchedColorChannels += 1;
    if (diff > maxColorDiff) maxColorDiff = diff;
  }
  return { maxColorDiff, mismatchedColorChannels, alphaMismatches };
}

// ---------------------------------------------------------------------------
// CPU 레인 레지스트리
// ---------------------------------------------------------------------------

/**
 * `runImageFilterDirect` 의 `directFilterRegistry` 와 동일 — 빈 레지스트리에
 * registerStudioKonvaFilters 가 attrs 기반 네이티브 포팅(nativeBrighten 등)을 채운다.
 * Worker 안 레지스트리와 같은 구성이라 이 레인의 픽셀이 CPU 참조가 된다.
 */
const nativeRegistry: KonvaLike = { Filters: {} };
registerStudioKonvaFilters(nativeRegistry);

/**
 * Konva 필터 함수의 `this` 는 실제 Konva 노드다. Konva 내장 필터(Brighten/Contrast/HSL …)는
 * `this.brightness()` 처럼 노드 **접근자**를 호출하므로 `{ attrs }` 대역으로는 돌지 않는다
 * (스튜디오 네이티브 포팅만 `this.attrs` 를 읽는다). 그래서 이 레인은 프로덕션과 동일하게
 * Konva.Image 노드를 만들어 `filter.call(node, imageData)` 로 태운다 —
 * Konva `_getCachedSceneCanvas` 내부 루프 그대로다.
 */
interface KonvaNodeLike {
  readonly attrs: Record<string, unknown>;
}

interface KonvaRuntimeLike extends KonvaLike {
  Image: new (config: Record<string, unknown>) => KonvaNodeLike;
}

/** StudioKonvaImageNode 의 비-Worker 경로 — 실제 konva 패키지 Filters 위에 커스텀 필터 부착. */
async function loadKonvaRuntime(): Promise<KonvaRuntimeLike> {
  const konvaModule = (await import("konva")) as unknown as { default?: KonvaRuntimeLike };
  const runtime = (konvaModule.default ?? (konvaModule as unknown)) as KonvaRuntimeLike;
  registerStudioKonvaFilters(runtime);
  return runtime;
}

/**
 * 타이밍 구간은 세 레인 모두 "원본 사본 → 필터 빌드 → 픽셀 적용"으로 맞춘다. 원본 사본을
 * 포함하는 이유: 필터 엔진이 제자리 변형 계약이라 프로덕션의 세 경로 전부 tick 마다 사본을
 * 만든다(Worker 는 상주 원본에서, 메인스레드는 sourcePixels 스냅샷에서). 사본을 빼면 왕복
 * 안쪽에서 사본을 만드는 Worker 레인만 불리해진다.
 */
function runNativeCpuLane(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  el: ImageFilterFields,
): { output: Uint8ClampedArray; ms: number } {
  const start = performance.now();
  const imageData = { data: new Uint8ClampedArray(source), width, height };
  const { filters, attrs } = buildImageFilters(el, nativeRegistry);
  applyImageFilters(imageData, filters, attrs);
  return { output: imageData.data, ms: performance.now() - start };
}

function runKonvaLane(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  el: ImageFilterFields,
  runtime: KonvaRuntimeLike,
  node: KonvaNodeLike,
): { output: Uint8ClampedArray; ms: number } {
  const start = performance.now();
  const imageData = { data: new Uint8ClampedArray(source), width, height };
  const { filters } = buildImageFilters(el, runtime);
  for (const filter of filters) filter.call(node, imageData);
  return { output: imageData.data, ms: performance.now() - start };
}

// ---------------------------------------------------------------------------
// Worker 레인 — 프로덕션 studio-image-filter.worker.ts 모듈을 node worker_threads 에서 그대로
// 돌린다. 그 모듈은 DedicatedWorkerGlobalScope 를 가정하므로(globalThis.postMessage /
// globalThis.onmessage) 셰임 두 줄만 얹고 나머지 로직(프로토콜 검증·상주 원본·transfer 목록
// 계산·에러 직렬화)은 손대지 않는다.
// ---------------------------------------------------------------------------

const WORKER_MODULE_URL = new URL("apps/web/src/domains/creator/studio-image-filter.worker.ts",
  REPO_ROOT,
).href;

const WORKER_BOOTSTRAP = `
import { parentPort } from "node:worker_threads";
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer ?? []);
await import(${JSON.stringify(WORKER_MODULE_URL)});
parentPort.on("message", (data) => { globalThis.onmessage({ data }); });
`;

interface WorkerResponseLike {
  readonly type: string;
  readonly requestId?: number;
  readonly imageData?: { data: Uint8ClampedArray; width: number; height: number };
  readonly error?: { readonly name: string; readonly message: string };
}

/** 프로덕션 상주 세션(studio-image-filter-worker-client 의 run-source 경로)과 같은 왕복. */
class ResidentFilterWorkerSession {
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    { resolve: (value: WorkerResponseLike) => void; reject: (error: Error) => void }
  >();

  private readonly ready: Promise<void>;
  private nextRequestId = 1;
  private sourceGeneration = 0;

  constructor() {
    this.worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      execArgv: process.execArgv,
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const onReady = (message: WorkerResponseLike): void => {
        if (message.type !== "studio-image-filter/ready") return;
        this.worker.off("message", onReady);
        resolve();
      };
      this.worker.on("message", onReady);
      this.worker.once("error", reject);
    });
    this.worker.on("message", (message: WorkerResponseLike) => {
      const settle = message.requestId === undefined
        ? undefined
        : this.pending.get(message.requestId);
      if (!settle) return;
      this.pending.delete(message.requestId!);
      if (message.type === "studio-image-filter/source-failure") {
        settle.reject(new Error(message.error?.message ?? "worker source failure"));
        return;
      }
      settle.resolve(message);
    });
  }

  /** 원본 1회 전송 — 프로덕션도 소스 정체성이 바뀔 때만 사본을 transfer 한다. */
  async loadSource(source: Uint8ClampedArray, width: number, height: number): Promise<void> {
    await this.ready;
    this.sourceGeneration += 1;
    const generation = this.sourceGeneration;
    const copy = new Uint8ClampedArray(source);
    await new Promise<void>((resolve, reject) => {
      const onMessage = (message: WorkerResponseLike): void => {
        if (message.type === "studio-image-filter/source-loaded") {
          this.worker.off("message", onMessage);
          resolve();
          return;
        }
        if (message.type === "studio-image-filter/source-failure") {
          this.worker.off("message", onMessage);
          reject(new Error(message.error?.message ?? "source load failed"));
        }
      };
      this.worker.on("message", onMessage);
      this.worker.postMessage(
        {
          type: "studio-image-filter/load-source",
          version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
          sourceId: "filter-lanes-bench",
          sourceGeneration: generation,
          imageData: { data: copy, width, height },
        },
        [copy.buffer],
      );
    });
  }

  /** 파라미터만 보내는 tick — 응답 픽셀은 transfer 로 돌아온다(제로카피). */
  run(el: ImageFilterFields): Promise<WorkerResponseLike> {
    const requestId = this.nextRequestId++;
    return new Promise<WorkerResponseLike>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({
        type: "studio-image-filter/run-source",
        version: STUDIO_IMAGE_FILTER_WORKER_PROTOCOL_VERSION,
        sourceId: "filter-lanes-bench",
        sourceGeneration: this.sourceGeneration,
        requestId,
        el,
      });
    });
  }

  async dispose(): Promise<void> {
    await this.worker.terminate();
  }
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

interface CellResult {
  readonly size: number;
  readonly pixels: number;
  readonly megabytes: number;
  readonly chain: string;
  readonly chainLabel: string;
  readonly chainSteps: readonly string[];
  readonly gpuPlan: {
    readonly eligible: boolean;
    readonly fusedDispatches: number | null;
    readonly fusedKernelIds: readonly string[] | null;
    readonly unfusedDispatches: number | null;
  };
  readonly iterations: number;
  readonly warmup: number;
  readonly lanes: Record<string, LaneStats>;
  readonly quality: Record<string, PixelDiff>;
}

/**
 * 같은 필드를 커널 그룹별로 따로 계획해 이어붙이면, 프로덕션 planner 가 LUT 융합 전에 만드는
 * 스텝 열과 동일한 "비융합" 체인이 된다(순서도 buildImageFilters 순서 그대로).
 * 브라우저 프로브가 GPU 융합/비융합을 비교할 때 쓰는 것과 같은 구성이다.
 */
function unfusedDispatchCount(el: ImageFilterFields): number | null {
  const groups: ImageFilterFields[] = [
    { brightness: el.brightness, contrast: el.contrast },
    { saturation: el.saturation, hue: el.hue },
    {
      levelsBlack: el.levelsBlack,
      levelsWhite: el.levelsWhite,
      levelsGamma: el.levelsGamma,
      levelsOutBlack: el.levelsOutBlack,
      levelsOutWhite: el.levelsOutWhite,
      levelsCh: el.levelsCh,
    },
    { curve: el.curve, curveCh: el.curveCh },
    { colorBalance: el.colorBalance },
  ];
  let total = 0;
  for (const group of groups) {
    total += planStudioGpuFilterChain(group)?.length ?? 0;
  }
  return total > 0 ? total : null;
}

async function measureCell(
  spec: SizeSpec,
  chain: ChainSpec,
  konvaRuntime: KonvaRuntimeLike,
  session: ResidentFilterWorkerSession,
  source: Uint8ClampedArray,
): Promise<CellResult> {
  const { size, warmup, iterations } = spec;
  const pixels = size * size;

  await session.loadSource(source, size, size);

  // Konva 노드는 셀당 한 번만 만든다 — 프로덕션도 React 가 attrs 를 노드에 한 번 얹고
  // tick 마다 필터만 다시 태운다(노드 생성 비용은 필터 레인 비용이 아니다).
  const konvaNode = new konvaRuntime.Image({
    ...buildImageFilters(chain.el, konvaRuntime).attrs,
  });

  const directSamples: number[] = [];
  const konvaSamples: number[] = [];
  const workerSamples: number[] = [];
  let directOutput: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(0);
  let konvaOutput: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(0);
  let workerOutput: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(0);

  const runDirect = (): number => {
    const result = runNativeCpuLane(source, size, size, chain.el);
    directOutput = result.output;
    return result.ms;
  };
  const runKonva = (): number => {
    const result = runKonvaLane(source, size, size, chain.el, konvaRuntime, konvaNode);
    konvaOutput = result.output;
    return result.ms;
  };
  const runWorker = async (): Promise<number> => {
    const start = performance.now();
    const response = await session.run(chain.el);
    const elapsed = performance.now() - start;
    if (response.imageData) workerOutput = response.imageData.data;
    return elapsed;
  };

  // 워밍업 — JIT/할당자 예열. 표본에 넣지 않는다.
  for (let index = 0; index < warmup; index += 1) {
    runDirect();
    runKonva();
    await runWorker();
  }
  // 레인 교차 실행 — 병행 부하 드리프트가 한 레인에만 실리지 않게 한다.
  for (let index = 0; index < iterations; index += 1) {
    directSamples.push(runDirect());
    konvaSamples.push(runKonva());
    workerSamples.push(await runWorker());
  }

  const plan = planStudioGpuFilterChain(chain.el);
  return {
    size,
    pixels,
    megabytes: round3((pixels * 4) / 1_048_576),
    chain: chain.id,
    chainLabel: chain.label,
    chainSteps: chain.steps,
    gpuPlan: {
      eligible: isStudioGpuFilterChainEligible(chain.el),
      fusedDispatches: plan?.length ?? null,
      fusedKernelIds: plan?.map((step) => step.kernelId) ?? null,
      unfusedDispatches: unfusedDispatchCount(chain.el),
    },
    iterations,
    warmup,
    lanes: {
      "worker-cpu": summarize(workerSamples, pixels),
      "direct-cpu": summarize(directSamples, pixels),
      "konva-fallback": summarize(konvaSamples, pixels),
    },
    quality: {
      // direct-cpu 가 CPU 참조(= Worker 안 엔진과 동일 구성). 나머지 레인은 이 픽셀과 대조한다.
      "worker-cpu-vs-direct": diffPixels(workerOutput, directOutput),
      "konva-fallback-vs-direct": diffPixels(konvaOutput, directOutput),
    },
  };
}

interface ExistingReport {
  readonly generatedAt?: string;
  readonly gpuLanes?: { readonly measuredAt?: string } | null;
  readonly crossover?: unknown;
}

async function readExistingReport(): Promise<ExistingReport> {
  try {
    return JSON.parse(await readFile(RESULT_FILE, "utf8")) as ExistingReport;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const loadavgBefore = loadavg();
  const konvaRuntime = await loadKonvaRuntime();
  const session = new ResidentFilterWorkerSession();

  const results: CellResult[] = [];
  for (const spec of SIZES) {
    const source = deterministicPixels(spec.size * spec.size);
    for (const chain of CHAINS) {
      const cell = await measureCell(spec, chain, konvaRuntime, session, source);
      results.push(cell);
      const worker = cell.lanes["worker-cpu"]!;
      const direct = cell.lanes["direct-cpu"]!;
      const konva = cell.lanes["konva-fallback"]!;
      console.log(
        `${spec.size}² ${chain.id}: worker p50 ${worker.p50Ms}ms | direct p50 ${direct.p50Ms}ms`
        + ` | konva p50 ${konva.p50Ms}ms | konva Δmax ${cell.quality["konva-fallback-vs-direct"]!.maxColorDiff}`,
      );
    }
  }
  await session.dispose();
  const loadavgAfter = loadavg();

  const existing = await readExistingReport();
  const generatedAt = new Date().toISOString();
  // GPU 레인 실측 자체는 CPU 수치와 무관하므로 그대로 보존한다. 반면 crossover 는 두 레인의
  // p50 을 나란히 놓은 파생값이라 CPU 를 다시 재면 즉시 낡는다 — 조용히 살려두면 새 CPU 수치와
  // 옛 GPU 수치를 짝지은 표가 되므로 명시적으로 무효화하고 재실행을 지시한다.
  const preservedGpuLanes = existing.gpuLanes ?? null;
  const crossover = preservedGpuLanes
    ? {
      stale: true,
      note:
        "이 파일의 CPU 레인이 다시 측정돼 이전 crossover 는 무효화됐다."
        + " FILTER_LANE_PROBE=1 로 브라우저 프로브를 다시 실행하면 이 CPU 실행"
        + `(${generatedAt}) 기준으로 다시 계산된다.`,
      previousGpuRun: preservedGpuLanes.measuredAt ?? null,
    }
    : null;
  const memory = process.memoryUsage();
  const report = {
    harness: "tests/benchmarks/harness/filter-lanes.ts",
    note:
      "프로덕션 필터 레인(gpu-chain → worker → konva-native) 중 CPU/Worker 레인의 크기별·체인별"
      + " 실측. GPU 레인은 packages/studio-engine-registry/src/__tests__/filter-lanes-browser-probe.test.ts"
      + " (FILTER_LANE_PROBE=1)가 같은 파일의 gpuLanes/crossover 를 채운다.",
    generatedAt,
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      cores: cpus().length,
      totalMemGb: round3(totalmem() / 1_073_741_824),
      node: process.version,
    },
    concurrentLoad: {
      note:
        "이 측정은 같은 머신에서 다른 에이전트의 빌드/테스트와 24h 소크가 병행 실행되는 동안"
        + " 수행됐다. 절대 시간은 부풀려질 수 있으므로 (1) 셀마다 세 레인을 교차 실행하고"
        + " (2) 비교는 전부 중앙값(p50) 기준으로 설계했다. 전체 표본을 남기므로 재요약 가능하다.",
      loadavgBefore: loadavgBefore.map(round3),
      loadavgAfter: loadavgAfter.map(round3),
      cpuCount: cpus().length,
    },
    measurementFloors: {
      workerRoundTrip:
        "worker-cpu 는 postMessage 왕복 + 결과 ArrayBuffer transfer + 워커 내 원본 사본 할당을"
        + " 포함한다. direct-cpu 와의 차이가 곧 그 왕복 비용이며, 작은 캔버스에서는 이 왕복이"
        + " 필터 연산 자체를 가린다(= Worker 레인의 측정 플로어).",
      konvaCacheCanvas:
        "konva-fallback 은 Konva 가 필터를 태우는 filter.call 루프(applyImageFilters 와 동일)만"
        + " 잰다. 실제 Konva 노드 경로에는 여기에 cache() 의 canvas getImageData/putImageData"
        + " 왕복이 추가로 붙는다(node 에는 canvas 가 없어 제외) — 즉 이 수치는 하한이다.",
      gpuSubmitFloor:
        "GPU 레인의 submit→onSubmittedWorkDone 왕복(~2.5ms, wgsl-variants-pipeline.json 에서"
        + " 관측)은 작은 작업을 가린다. 브라우저 프로브가 timestamp-query 보조 계측으로 순수"
        + " GPU 실행 시간을 분리해 기록한다.",
    },
    config: {
      sizes: SIZES.map((spec) => ({
        size: `${spec.size}x${spec.size}`,
        pixels: spec.size * spec.size,
        warmup: spec.warmup,
        iterations: spec.iterations,
      })),
      chains: CHAINS.map((chain) => ({
        id: chain.id,
        label: chain.label,
        steps: chain.steps,
      })),
      source: "deterministic LCG RGBA (브라우저 프로브와 동일 시드·점화식)",
      quick: QUICK,
    },
    lanes: {
      "worker-cpu":
        "apps/web/src/domains/creator/studio-image-filter.worker.ts 원본 모듈 + 상주 원본 프로토콜"
        + " (load-source 1회 → run-source tick → 결과 transfer), node worker_threads 실행",
      "direct-cpu":
        "studio-image-filter-worker-client.ts runImageFilterDirect 와 동일 구성"
        + " (빈 레지스트리 + registerStudioKonvaFilters 네이티브 포팅) 메인스레드 동기 실행"
        + " — CPU 참조 픽셀",
      "konva-fallback":
        "StudioKonvaImageNode 비-Worker 경로와 동일하게 실제 konva 패키지 Filters 레지스트리로"
        + " buildImageFilters → applyImageFilters",
    },
    results,
    gpuLanes: preservedGpuLanes,
    crossover,
    peakMemory: {
      rssMb: round3(memory.rss / 1_048_576),
      externalMb: round3(memory.external / 1_048_576),
    },
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(RESULT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`written: ${RESULT_FILE}`);
}

await main();
