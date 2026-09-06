import { sha256HexPortable } from "../studio-sha256";

export const STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION = 1 as const;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const CAPABILITY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/u;

export const STUDIO_OUT_OF_CORE_EXPORT_DEFAULT_BUDGETS = Object.freeze({
  maxLogicalDimension: (BigInt(1) << BigInt(63)) - BigInt(1),
  maxOutputPixels: BigInt("1000000000000000"),
  maxWorkPixels: BigInt("1200000000000000"),
  maxTiles: 1_000_000,
  maxTileCoreEdge: 1_048_576,
  maxTileRenderEdge: 1_065_000,
  maxTileRenderPixels: 67_108_864,
  maxPaddingPixels: 8_192,
  maxBytesPerPixel: 64,
  maxTilePayloadBytes: 256 * 1024 * 1024,
  maxAdapterWorkingBytes: 256 * 1024 * 1024,
  maxResidentBytes: 512 * 1024 * 1024,
  maxConcurrency: 16,
  maxRetriesPerTile: 8,
  defaultOperationTimeoutMs: 60_000,
  maxOperationTimeoutMs: 10 * 60_000,
} as const);

export type StudioOutOfCoreInteger = bigint | number | string;
export type StudioOutOfCoreTileOrder = "row-major" | "morton";
export type StudioOutOfCoreSha256 = `sha256:${string}`;

export interface StudioOutOfCoreScale {
  readonly numerator: StudioOutOfCoreInteger;
  readonly denominator: StudioOutOfCoreInteger;
}

export interface StudioOutOfCoreAdapterCapability {
  readonly id: string;
  readonly hash: StudioOutOfCoreSha256;
  readonly maxWorkingBytes: number;
}

export interface StudioOutOfCoreRendererCapability
  extends StudioOutOfCoreAdapterCapability {
  readonly maxOutputBytes: number;
}

export interface StudioOutOfCoreTiling {
  readonly coreWidth: number;
  readonly coreHeight: number;
  readonly haloPixels?: number;
  readonly overlapPixels?: number;
  readonly order?: StudioOutOfCoreTileOrder;
}

export interface StudioOutOfCoreExportBudgetInput {
  readonly maxLogicalDimension?: StudioOutOfCoreInteger;
  readonly maxOutputPixels?: StudioOutOfCoreInteger;
  readonly maxWorkPixels?: StudioOutOfCoreInteger;
  readonly maxTiles?: number;
  readonly maxTileCoreEdge?: number;
  readonly maxTileRenderEdge?: number;
  readonly maxTileRenderPixels?: number;
  readonly maxPaddingPixels?: number;
  readonly maxBytesPerPixel?: number;
  readonly maxTilePayloadBytes?: number;
  readonly maxAdapterWorkingBytes?: number;
  readonly maxResidentBytes?: number;
  readonly maxConcurrency?: number;
  readonly maxRetriesPerTile?: number;
  readonly defaultOperationTimeoutMs?: number;
  readonly maxOperationTimeoutMs?: number;
}

export interface StudioOutOfCoreExportBudgets {
  readonly maxLogicalDimension: bigint;
  readonly maxOutputPixels: bigint;
  readonly maxWorkPixels: bigint;
  readonly maxTiles: number;
  readonly maxTileCoreEdge: number;
  readonly maxTileRenderEdge: number;
  readonly maxTileRenderPixels: number;
  readonly maxPaddingPixels: number;
  readonly maxBytesPerPixel: number;
  readonly maxTilePayloadBytes: number;
  readonly maxAdapterWorkingBytes: number;
  readonly maxResidentBytes: number;
  readonly maxConcurrency: number;
  readonly maxRetriesPerTile: number;
  readonly defaultOperationTimeoutMs: number;
  readonly maxOperationTimeoutMs: number;
}

export interface StudioOutOfCoreExportPlanInput {
  readonly logicalWidth: StudioOutOfCoreInteger;
  readonly logicalHeight: StudioOutOfCoreInteger;
  readonly scale: StudioOutOfCoreScale;
  readonly tiling: StudioOutOfCoreTiling;
  readonly bytesPerPixel: number;
  readonly rendererCapability: StudioOutOfCoreRendererCapability;
  readonly sinkCapability: StudioOutOfCoreAdapterCapability;
}

export interface StudioOutOfCoreTileRectangle {
  readonly x: string;
  readonly y: string;
  readonly width: number;
  readonly height: number;
}

export interface StudioOutOfCoreTileCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioOutOfCoreTilePlan {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly ordinal: number;
  readonly core: StudioOutOfCoreTileRectangle;
  readonly render: StudioOutOfCoreTileRectangle;
  readonly crop: StudioOutOfCoreTileCrop;
  readonly haloPixels: number;
  readonly overlapPixels: number;
  readonly estimatedRenderBytes: number;
  readonly reservedResidentBytes: number;
}

export interface StudioOutOfCoreExportPlan {
  readonly kind: "studio-out-of-core-export-plan";
  readonly revision: typeof STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION;
  readonly logicalWidth: string;
  readonly logicalHeight: string;
  readonly logicalPixelCount: string;
  readonly scaleNumerator: string;
  readonly scaleDenominator: string;
  readonly outputWidth: string;
  readonly outputHeight: string;
  readonly outputPixelCount: string;
  readonly tileColumns: number;
  readonly tileRows: number;
  readonly totalTiles: number;
  readonly totalTilesDecimal: string;
  readonly totalWorkPixels: string;
  readonly bytesPerPixel: number;
  readonly tiling: Readonly<Required<StudioOutOfCoreTiling>>;
  readonly rendererCapability: StudioOutOfCoreRendererCapability;
  readonly sinkCapability: StudioOutOfCoreAdapterCapability;
  readonly maxTileReservationBytes: number;
  readonly manifestFingerprint: StudioOutOfCoreSha256;
  tileAt(row: number, column: number, ordinal?: number): StudioOutOfCoreTilePlan;
  tiles(): IterableIterator<StudioOutOfCoreTilePlan>;
}

export interface StudioOutOfCoreRenderedTile {
  readonly bytes: ArrayBuffer | ArrayBufferView;
  readonly contentHash?: StudioOutOfCoreSha256;
}

export interface StudioOutOfCoreWrittenTile {
  readonly verifiedHash: StudioOutOfCoreSha256;
  readonly byteLength: number;
}

export interface StudioOutOfCoreVerifiedTile {
  readonly verifiedHash: StudioOutOfCoreSha256 | null;
  readonly byteLength: number | null;
}

export interface StudioOutOfCoreRenderContext {
  readonly epoch: number;
  readonly sequence: number;
  readonly attempt: number;
  readonly manifestFingerprint: StudioOutOfCoreSha256;
  readonly signal: AbortSignal;
}

export interface StudioOutOfCoreWriteContext
  extends StudioOutOfCoreRenderContext {
  readonly tile: StudioOutOfCoreTilePlan;
  readonly bytes: Uint8Array;
  readonly contentHash: StudioOutOfCoreSha256;
}

export interface StudioOutOfCoreVerifyContext {
  readonly epoch: number;
  readonly sequence: number;
  readonly manifestFingerprint: StudioOutOfCoreSha256;
  readonly tile: StudioOutOfCoreTilePlan;
  readonly expectedHash: StudioOutOfCoreSha256;
  readonly expectedByteLength: number;
  readonly signal: AbortSignal;
}

export interface StudioOutOfCoreRendererAdapter {
  readonly capability: StudioOutOfCoreRendererCapability;
  renderTile(
    tile: StudioOutOfCoreTilePlan,
    context: StudioOutOfCoreRenderContext,
  ): Promise<StudioOutOfCoreRenderedTile> | StudioOutOfCoreRenderedTile;
}

export interface StudioOutOfCoreSinkAdapter {
  readonly capability: StudioOutOfCoreAdapterCapability;
  writeTile(
    context: StudioOutOfCoreWriteContext,
  ): Promise<StudioOutOfCoreWrittenTile> | StudioOutOfCoreWrittenTile;
  verifyTile?(
    context: StudioOutOfCoreVerifyContext,
  ): Promise<StudioOutOfCoreVerifiedTile> | StudioOutOfCoreVerifiedTile;
}

export interface StudioOutOfCoreResumeTile {
  readonly tileId: string;
  readonly contentHash: StudioOutOfCoreSha256;
  readonly byteLength: number;
}

export interface StudioOutOfCoreResumeManifest {
  readonly revision: typeof STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION;
  readonly planFingerprint: StudioOutOfCoreSha256;
  readonly rendererCapability: Readonly<{
    id: string;
    hash: StudioOutOfCoreSha256;
  }>;
  readonly sinkCapability: Readonly<{
    id: string;
    hash: StudioOutOfCoreSha256;
  }>;
  readonly tiles: readonly StudioOutOfCoreResumeTile[];
}

export interface StudioOutOfCoreExportRequest {
  readonly logicalWidth: StudioOutOfCoreInteger;
  readonly logicalHeight: StudioOutOfCoreInteger;
  readonly scale: StudioOutOfCoreScale;
  readonly tiling: StudioOutOfCoreTiling;
  readonly bytesPerPixel: number;
  readonly renderer: StudioOutOfCoreRendererAdapter;
  readonly sink: StudioOutOfCoreSinkAdapter;
  readonly resume?: StudioOutOfCoreResumeManifest;
  readonly concurrency?: number;
  readonly retryBudget?: number;
  readonly operationTimeoutMs?: number;
  readonly epoch: number;
  readonly signal?: AbortSignal;
}

export interface StudioOutOfCoreExportReceipt {
  readonly kind: "studio-out-of-core-export-receipt";
  readonly revision: typeof STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION;
  readonly status: "complete" | "fail-closed";
  readonly epoch: number;
  readonly sequence: number;
  readonly logicalDimensions: Readonly<{
    width: string;
    height: string;
    pixelCount: string;
  }>;
  readonly outputDimensions: Readonly<{
    width: string;
    height: string;
    pixelCount: string;
  }>;
  readonly scale: Readonly<{
    numerator: string;
    denominator: string;
  }>;
  readonly tileCount: string;
  readonly completedTiles: number;
  readonly skippedTiles: number;
  readonly retriedTiles: number;
  readonly retryAttempts: number;
  readonly peakResidentBytes: number;
  readonly effectiveConcurrency: number;
  readonly operationTimeoutMs: number;
  readonly totalWorkPixels: string;
  readonly rendererCapability: Readonly<{
    id: string;
    hash: StudioOutOfCoreSha256;
  }>;
  readonly sinkCapability: Readonly<{
    id: string;
    hash: StudioOutOfCoreSha256;
  }>;
  readonly planFingerprint: StudioOutOfCoreSha256;
  readonly tileManifestHash: StudioOutOfCoreSha256 | null;
  readonly failureCode: StudioOutOfCoreExportErrorCode | null;
  readonly receiptHash: StudioOutOfCoreSha256;
}

export type StudioOutOfCoreExportErrorCode =
  | "invalid-request"
  | "budget-exceeded"
  | "provenance-mismatch"
  | "integrity-mismatch"
  | "epoch-mismatch"
  | "backpressure"
  | "aborted"
  | "operation-timeout"
  | "tile-failed"
  | "disposed";

export class StudioOutOfCoreExportError extends Error {
  constructor(
    readonly code: StudioOutOfCoreExportErrorCode,
    message: string,
    readonly receipt: StudioOutOfCoreExportReceipt | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioOutOfCoreExportError";
  }
}

export interface StudioOutOfCoreExportProvider {
  exportDocument(
    request: StudioOutOfCoreExportRequest,
  ): Promise<StudioOutOfCoreExportReceipt>;
  setEpoch(epoch: number): void;
  snapshot(): Readonly<{
    state: "ready" | "disposed";
    epoch: number;
    sequence: number;
    activeExports: number;
  }>;
  dispose(): void;
}

interface NormalizedPlan {
  readonly plan: StudioOutOfCoreExportPlan;
  readonly pixelWidth: bigint;
  readonly pixelHeight: bigint;
  readonly padding: number;
  readonly budgets: StudioOutOfCoreExportBudgets;
}

interface TileRecord {
  readonly hash: StudioOutOfCoreSha256;
  readonly byteLength: number;
}

interface MutableMetrics {
  completedTiles: number;
  skippedTiles: number;
  retriedTiles: number;
  retryAttempts: number;
  peakResidentBytes: number;
  currentResidentBytes: number;
}

interface NormalizedExternalAbortSignal {
  isAborted(): boolean;
  addAbortListener(listener: () => void): void;
  removeAbortListener(listener: () => void): void;
}

function hashText(value: string): StudioOutOfCoreSha256 {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(value))}`;
}

function parsePositiveInteger(
  value: StudioOutOfCoreInteger,
  label: string,
): bigint {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new StudioOutOfCoreExportError(
        "invalid-request",
        `${label} must be a safe integer when provided as a number.`,
      );
    }
    parsed = BigInt(value);
  } else if (typeof value === "string" && DECIMAL_PATTERN.test(value)) {
    parsed = BigInt(value);
  } else {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      `${label} must be a positive bigint or canonical decimal integer.`,
    );
  }
  if (parsed <= BigInt(0)) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      `${label} must be greater than zero.`,
    );
  }
  return parsed;
}

function parseBoundedSafeInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      `${label} must be a safe integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function budgetError(message: string): never {
  throw new StudioOutOfCoreExportError("budget-exceeded", message);
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

function safeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      `${label} cannot be represented safely by a per-tile adapter.`,
    );
  }
  return Number(value);
}

function checkedProduct(
  left: number,
  right: number,
  label: string,
): number {
  const product = left * right;
  if (!Number.isSafeInteger(product) || product < 0) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      `${label} exceeds safe per-tile arithmetic.`,
    );
  }
  return product;
}

function checkedSum(
  values: readonly number[],
  label: string,
): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new StudioOutOfCoreExportError(
        "invalid-request",
        `${label} contains unsafe byte arithmetic.`,
      );
    }
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new StudioOutOfCoreExportError(
        "invalid-request",
        `${label} exceeds safe byte arithmetic.`,
      );
    }
  }
  return total;
}

function normalizeHash(value: unknown, label: string): StudioOutOfCoreSha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      `${label} must be a lowercase SHA-256 fingerprint.`,
    );
  }
  return value as StudioOutOfCoreSha256;
}

function normalizeCapability(
  capability: StudioOutOfCoreAdapterCapability,
  label: string,
  budgets: StudioOutOfCoreExportBudgets,
): StudioOutOfCoreAdapterCapability {
  if (
    !capability
    || typeof capability !== "object"
    || typeof capability.id !== "string"
    || !CAPABILITY_ID_PATTERN.test(capability.id)
  ) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      `${label}.id is not a canonical capability identifier.`,
    );
  }
  const maxWorkingBytes = parseBoundedSafeInteger(
    capability.maxWorkingBytes,
    `${label}.maxWorkingBytes`,
    0,
    budgets.maxAdapterWorkingBytes,
  );
  return Object.freeze({
    id: capability.id,
    hash: normalizeHash(capability.hash, `${label}.hash`),
    maxWorkingBytes,
  });
}

function normalizeRendererCapability(
  capability: StudioOutOfCoreRendererCapability,
  budgets: StudioOutOfCoreExportBudgets,
): StudioOutOfCoreRendererCapability {
  const base = normalizeCapability(capability, "rendererCapability", budgets);
  const maxOutputBytes = parseBoundedSafeInteger(
    capability.maxOutputBytes,
    "rendererCapability.maxOutputBytes",
    1,
    budgets.maxTilePayloadBytes,
  );
  return Object.freeze({ ...base, maxOutputBytes });
}

function normalizeBudgets(
  input: StudioOutOfCoreExportBudgetInput = {},
): StudioOutOfCoreExportBudgets {
  const defaults = STUDIO_OUT_OF_CORE_EXPORT_DEFAULT_BUDGETS;
  const maxLogicalDimension = input.maxLogicalDimension === undefined
    ? defaults.maxLogicalDimension
    : parsePositiveInteger(input.maxLogicalDimension, "maxLogicalDimension");
  const maxOutputPixels = input.maxOutputPixels === undefined
    ? defaults.maxOutputPixels
    : parsePositiveInteger(input.maxOutputPixels, "maxOutputPixels");
  const maxWorkPixels = input.maxWorkPixels === undefined
    ? defaults.maxWorkPixels
    : parsePositiveInteger(input.maxWorkPixels, "maxWorkPixels");
  const maxOperationTimeoutMs = parseBoundedSafeInteger(
    input.maxOperationTimeoutMs ?? defaults.maxOperationTimeoutMs,
    "maxOperationTimeoutMs",
    1,
    defaults.maxOperationTimeoutMs,
  );
  const defaultOperationTimeoutMs = parseBoundedSafeInteger(
    input.defaultOperationTimeoutMs
      ?? Math.min(defaults.defaultOperationTimeoutMs, maxOperationTimeoutMs),
    "defaultOperationTimeoutMs",
    1,
    maxOperationTimeoutMs,
  );
  return Object.freeze({
    maxLogicalDimension,
    maxOutputPixels,
    maxWorkPixels,
    maxTiles: parseBoundedSafeInteger(
      input.maxTiles ?? defaults.maxTiles,
      "maxTiles",
      1,
      defaults.maxTiles,
    ),
    maxTileCoreEdge: parseBoundedSafeInteger(
      input.maxTileCoreEdge ?? defaults.maxTileCoreEdge,
      "maxTileCoreEdge",
      1,
      defaults.maxTileCoreEdge,
    ),
    maxTileRenderEdge: parseBoundedSafeInteger(
      input.maxTileRenderEdge ?? defaults.maxTileRenderEdge,
      "maxTileRenderEdge",
      1,
      defaults.maxTileRenderEdge,
    ),
    maxTileRenderPixels: parseBoundedSafeInteger(
      input.maxTileRenderPixels ?? defaults.maxTileRenderPixels,
      "maxTileRenderPixels",
      1,
      defaults.maxTileRenderPixels,
    ),
    maxPaddingPixels: parseBoundedSafeInteger(
      input.maxPaddingPixels ?? defaults.maxPaddingPixels,
      "maxPaddingPixels",
      0,
      defaults.maxPaddingPixels,
    ),
    maxBytesPerPixel: parseBoundedSafeInteger(
      input.maxBytesPerPixel ?? defaults.maxBytesPerPixel,
      "maxBytesPerPixel",
      1,
      defaults.maxBytesPerPixel,
    ),
    maxTilePayloadBytes: parseBoundedSafeInteger(
      input.maxTilePayloadBytes ?? defaults.maxTilePayloadBytes,
      "maxTilePayloadBytes",
      1,
      defaults.maxTilePayloadBytes,
    ),
    maxAdapterWorkingBytes: parseBoundedSafeInteger(
      input.maxAdapterWorkingBytes ?? defaults.maxAdapterWorkingBytes,
      "maxAdapterWorkingBytes",
      0,
      defaults.maxAdapterWorkingBytes,
    ),
    maxResidentBytes: parseBoundedSafeInteger(
      input.maxResidentBytes ?? defaults.maxResidentBytes,
      "maxResidentBytes",
      1,
      defaults.maxResidentBytes,
    ),
    maxConcurrency: parseBoundedSafeInteger(
      input.maxConcurrency ?? defaults.maxConcurrency,
      "maxConcurrency",
      1,
      defaults.maxConcurrency,
    ),
    maxRetriesPerTile: parseBoundedSafeInteger(
      input.maxRetriesPerTile ?? defaults.maxRetriesPerTile,
      "maxRetriesPerTile",
      0,
      defaults.maxRetriesPerTile,
    ),
    defaultOperationTimeoutMs,
    maxOperationTimeoutMs,
  });
}

function axisRenderSpan(
  index: number,
  coreSize: number,
  total: bigint,
  padding: number,
): Readonly<{
  coreStart: bigint;
  coreLength: number;
  renderStart: bigint;
  renderLength: number;
  cropOffset: number;
}> {
  const coreStart = BigInt(index) * BigInt(coreSize);
  const coreEnd = coreStart + BigInt(coreSize) < total
    ? coreStart + BigInt(coreSize)
    : total;
  const renderStart = coreStart > BigInt(padding)
    ? coreStart - BigInt(padding)
    : BigInt(0);
  const renderEnd = coreEnd + BigInt(padding) < total
    ? coreEnd + BigInt(padding)
    : total;
  return Object.freeze({
    coreStart,
    coreLength: safeNumber(coreEnd - coreStart, "tile core length"),
    renderStart,
    renderLength: safeNumber(renderEnd - renderStart, "tile render length"),
    cropOffset: safeNumber(coreStart - renderStart, "tile crop offset"),
  });
}

function stableTileId(row: number, column: number): string {
  return `r${row}-c${column}`;
}

function* rowMajorCoordinates(
  rows: number,
  columns: number,
): IterableIterator<readonly [number, number]> {
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      yield [row, column] as const;
    }
  }
}

function* mortonSquare(
  x: number,
  y: number,
  size: number,
  columns: number,
  rows: number,
): IterableIterator<readonly [number, number]> {
  if (x >= columns || y >= rows) return;
  if (size === 1) {
    yield [y, x] as const;
    return;
  }
  const half = size / 2;
  yield* mortonSquare(x, y, half, columns, rows);
  yield* mortonSquare(x + half, y, half, columns, rows);
  yield* mortonSquare(x, y + half, half, columns, rows);
  yield* mortonSquare(x + half, y + half, half, columns, rows);
}

function* mortonCoordinates(
  rows: number,
  columns: number,
): IterableIterator<readonly [number, number]> {
  let squareSize = 1;
  while (squareSize < rows || squareSize < columns) squareSize *= 2;
  yield* mortonSquare(0, 0, squareSize, columns, rows);
}

function freezeTile(
  tile: StudioOutOfCoreTilePlan,
): StudioOutOfCoreTilePlan {
  return Object.freeze({
    ...tile,
    core: Object.freeze({ ...tile.core }),
    render: Object.freeze({ ...tile.render }),
    crop: Object.freeze({ ...tile.crop }),
  });
}

function canonicalPlanRecord(
  plan: Omit<
    StudioOutOfCoreExportPlan,
    "manifestFingerprint" | "tileAt" | "tiles"
  >,
): string {
  return JSON.stringify({
    kind: plan.kind,
    revision: plan.revision,
    logicalWidth: plan.logicalWidth,
    logicalHeight: plan.logicalHeight,
    logicalPixelCount: plan.logicalPixelCount,
    scaleNumerator: plan.scaleNumerator,
    scaleDenominator: plan.scaleDenominator,
    outputWidth: plan.outputWidth,
    outputHeight: plan.outputHeight,
    outputPixelCount: plan.outputPixelCount,
    tileColumns: plan.tileColumns,
    tileRows: plan.tileRows,
    totalTiles: plan.totalTilesDecimal,
    totalWorkPixels: plan.totalWorkPixels,
    bytesPerPixel: plan.bytesPerPixel,
    tiling: plan.tiling,
    rendererCapability: plan.rendererCapability,
    sinkCapability: plan.sinkCapability,
    maxTileReservationBytes: plan.maxTileReservationBytes,
  });
}

function createNormalizedPlan(
  input: StudioOutOfCoreExportPlanInput,
  budgetInput: StudioOutOfCoreExportBudgetInput = {},
): NormalizedPlan {
  if (!input || typeof input !== "object") {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      "An out-of-core export plan request is required.",
    );
  }
  const budgets = normalizeBudgets(budgetInput);
  const logicalWidth = parsePositiveInteger(input.logicalWidth, "logicalWidth");
  const logicalHeight = parsePositiveInteger(input.logicalHeight, "logicalHeight");
  const numerator = parsePositiveInteger(input.scale?.numerator, "scale.numerator");
  const denominator = parsePositiveInteger(
    input.scale?.denominator,
    "scale.denominator",
  );
  if (
    logicalWidth > budgets.maxLogicalDimension
    || logicalHeight > budgets.maxLogicalDimension
  ) budgetError("Logical dimensions exceed the configured BigInt document budget.");

  const logicalPixelCount = logicalWidth * logicalHeight;
  const pixelWidth = ceilDivide(logicalWidth * numerator, denominator);
  const pixelHeight = ceilDivide(logicalHeight * numerator, denominator);
  const outputPixelCount = pixelWidth * pixelHeight;
  if (outputPixelCount > budgets.maxOutputPixels) {
    budgetError("Scaled output pixel count exceeds the export budget.");
  }

  const bytesPerPixel = parseBoundedSafeInteger(
    input.bytesPerPixel,
    "bytesPerPixel",
    1,
    budgets.maxBytesPerPixel,
  );
  if (!input.tiling || typeof input.tiling !== "object") {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      "A tiling configuration is required.",
    );
  }
  const coreWidth = parseBoundedSafeInteger(
    input.tiling.coreWidth,
    "tiling.coreWidth",
    1,
    budgets.maxTileCoreEdge,
  );
  const coreHeight = parseBoundedSafeInteger(
    input.tiling.coreHeight,
    "tiling.coreHeight",
    1,
    budgets.maxTileCoreEdge,
  );
  const haloPixels = parseBoundedSafeInteger(
    input.tiling.haloPixels ?? 0,
    "tiling.haloPixels",
    0,
    budgets.maxPaddingPixels,
  );
  const overlapPixels = parseBoundedSafeInteger(
    input.tiling.overlapPixels ?? 0,
    "tiling.overlapPixels",
    0,
    budgets.maxPaddingPixels,
  );
  const padding = haloPixels + overlapPixels;
  if (!Number.isSafeInteger(padding) || padding > budgets.maxPaddingPixels) {
    budgetError("Combined halo and overlap exceed the padding budget.");
  }
  const order = input.tiling.order ?? "row-major";
  if (order !== "row-major" && order !== "morton") {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      "tiling.order must be row-major or morton.",
    );
  }
  const columnsBig = ceilDivide(pixelWidth, BigInt(coreWidth));
  const rowsBig = ceilDivide(pixelHeight, BigInt(coreHeight));
  const totalTilesBig = columnsBig * rowsBig;
  if (totalTilesBig > BigInt(budgets.maxTiles)) {
    budgetError("Tile count exceeds the export planning budget.");
  }
  const tileColumns = safeNumber(columnsBig, "tile column count");
  const tileRows = safeNumber(rowsBig, "tile row count");
  const totalTiles = safeNumber(totalTilesBig, "tile count");

  let horizontalWork = BigInt(0);
  let verticalWork = BigInt(0);
  let maxRenderWidth = 0;
  let maxRenderHeight = 0;
  for (let column = 0; column < tileColumns; column += 1) {
    const span = axisRenderSpan(
      column,
      coreWidth,
      pixelWidth,
      padding,
    );
    horizontalWork += BigInt(span.renderLength);
    maxRenderWidth = Math.max(maxRenderWidth, span.renderLength);
  }
  for (let row = 0; row < tileRows; row += 1) {
    const span = axisRenderSpan(row, coreHeight, pixelHeight, padding);
    verticalWork += BigInt(span.renderLength);
    maxRenderHeight = Math.max(maxRenderHeight, span.renderLength);
  }
  if (
    maxRenderWidth > budgets.maxTileRenderEdge
    || maxRenderHeight > budgets.maxTileRenderEdge
  ) budgetError("A padded tile edge exceeds the render adapter budget.");
  const maxRenderPixels = checkedProduct(
    maxRenderWidth,
    maxRenderHeight,
    "maximum tile render pixels",
  );
  if (maxRenderPixels > budgets.maxTileRenderPixels) {
    budgetError("A padded tile exceeds the per-tile pixel budget.");
  }
  const totalWorkPixels = horizontalWork * verticalWork;
  if (totalWorkPixels > budgets.maxWorkPixels) {
    budgetError("Padded tile work exceeds the export work budget.");
  }
  const rendererCapability = normalizeRendererCapability(
    input.rendererCapability,
    budgets,
  );
  const sinkCapability = normalizeCapability(
    input.sinkCapability,
    "sinkCapability",
    budgets,
  );
  const maxRawBytes = checkedProduct(
    maxRenderPixels,
    bytesPerPixel,
    "maximum tile render bytes",
  );
  // The renderer may retain its raw tile and original encoded payload while
  // the provider owns a defensive payload clone, and the sink may begin
  // consuming that clone before renderer scratch is released. Reserve all
  // simultaneously live classes rather than only the larger of raw and
  // encoded bytes.
  const maxTileReservationBytes = checkedSum(
    [
      maxRawBytes,
      rendererCapability.maxOutputBytes,
      rendererCapability.maxOutputBytes,
      rendererCapability.maxWorkingBytes,
      sinkCapability.maxWorkingBytes,
    ],
    "maximum tile resident bytes",
  );
  if (
    !Number.isSafeInteger(maxTileReservationBytes)
    || maxTileReservationBytes > budgets.maxResidentBytes
  ) budgetError("One tile cannot fit inside the resident-memory budget.");

  const tiling = Object.freeze({
    coreWidth,
    coreHeight,
    haloPixels,
    overlapPixels,
    order,
  });
  const planRecord = Object.freeze({
    kind: "studio-out-of-core-export-plan" as const,
    revision: STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION,
    logicalWidth: logicalWidth.toString(),
    logicalHeight: logicalHeight.toString(),
    logicalPixelCount: logicalPixelCount.toString(),
    scaleNumerator: numerator.toString(),
    scaleDenominator: denominator.toString(),
    outputWidth: pixelWidth.toString(),
    outputHeight: pixelHeight.toString(),
    outputPixelCount: outputPixelCount.toString(),
    tileColumns,
    tileRows,
    totalTiles,
    totalTilesDecimal: totalTilesBig.toString(),
    totalWorkPixels: totalWorkPixels.toString(),
    bytesPerPixel,
    tiling,
    rendererCapability,
    sinkCapability,
    maxTileReservationBytes,
  });
  const manifestFingerprint = hashText(canonicalPlanRecord(planRecord));

  const tileAt = (
    row: number,
    column: number,
    ordinal = row * tileColumns + column,
  ): StudioOutOfCoreTilePlan => {
    if (
      !Number.isSafeInteger(row)
      || !Number.isSafeInteger(column)
      || !Number.isSafeInteger(ordinal)
      || row < 0
      || row >= tileRows
      || column < 0
      || column >= tileColumns
      || ordinal < 0
      || ordinal >= totalTiles
    ) {
      throw new StudioOutOfCoreExportError(
        "invalid-request",
        "Tile coordinates are outside this export plan.",
      );
    }
    const horizontal = axisRenderSpan(
      column,
      coreWidth,
      pixelWidth,
      padding,
    );
    const vertical = axisRenderSpan(
      row,
      coreHeight,
      pixelHeight,
      padding,
    );
    const renderPixels = checkedProduct(
      horizontal.renderLength,
      vertical.renderLength,
      "tile render pixels",
    );
    const estimatedRenderBytes = checkedProduct(
      renderPixels,
      bytesPerPixel,
      "tile render bytes",
    );
    const reservedResidentBytes = checkedSum(
      [
        estimatedRenderBytes,
        rendererCapability.maxOutputBytes,
        rendererCapability.maxOutputBytes,
        rendererCapability.maxWorkingBytes,
        sinkCapability.maxWorkingBytes,
      ],
      "tile resident bytes",
    );
    return freezeTile({
      id: stableTileId(row, column),
      row,
      column,
      ordinal,
      core: {
        x: horizontal.coreStart.toString(),
        y: vertical.coreStart.toString(),
        width: horizontal.coreLength,
        height: vertical.coreLength,
      },
      render: {
        x: horizontal.renderStart.toString(),
        y: vertical.renderStart.toString(),
        width: horizontal.renderLength,
        height: vertical.renderLength,
      },
      crop: {
        x: horizontal.cropOffset,
        y: vertical.cropOffset,
        width: horizontal.coreLength,
        height: vertical.coreLength,
      },
      haloPixels,
      overlapPixels,
      estimatedRenderBytes,
      reservedResidentBytes,
    });
  };

  const tiles = function* (): IterableIterator<StudioOutOfCoreTilePlan> {
    const coordinates = order === "morton"
      ? mortonCoordinates(tileRows, tileColumns)
      : rowMajorCoordinates(tileRows, tileColumns);
    let ordinal = 0;
    for (const [row, column] of coordinates) {
      yield tileAt(row, column, ordinal);
      ordinal += 1;
    }
  };

  const plan = Object.freeze({
    ...planRecord,
    manifestFingerprint,
    tileAt,
    tiles,
  });
  return Object.freeze({ plan, pixelWidth, pixelHeight, padding, budgets });
}

export function createStudioOutOfCoreExportPlan(
  input: StudioOutOfCoreExportPlanInput,
  budgets: StudioOutOfCoreExportBudgetInput = {},
): StudioOutOfCoreExportPlan {
  return createNormalizedPlan(input, budgets).plan;
}

function capabilityIdentity(
  capability: StudioOutOfCoreAdapterCapability,
): Readonly<{ id: string; hash: StudioOutOfCoreSha256 }> {
  return Object.freeze({ id: capability.id, hash: capability.hash });
}

function parseTileId(
  tileId: string,
): Readonly<{ row: number; column: number }> | null {
  const match = /^r([0-9]+)-c([0-9]+)$/u.exec(tileId);
  if (!match) return null;
  const row = Number(match[1]);
  const column = Number(match[2]);
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) return null;
  return Object.freeze({ row, column });
}

function prepareResume(
  resume: StudioOutOfCoreResumeManifest | undefined,
  plan: StudioOutOfCoreExportPlan,
  hasVerifier: boolean,
): ReadonlyMap<string, StudioOutOfCoreResumeTile> {
  if (resume === undefined) return new Map();
  if (!resume || typeof resume !== "object" || !Array.isArray(resume.tiles)) {
    throw new StudioOutOfCoreExportError(
      "provenance-mismatch",
      "Resume manifest is malformed.",
    );
  }
  if (
    resume.revision !== STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION
    || resume.planFingerprint !== plan.manifestFingerprint
    || resume.rendererCapability?.id !== plan.rendererCapability.id
    || resume.rendererCapability?.hash !== plan.rendererCapability.hash
    || resume.sinkCapability?.id !== plan.sinkCapability.id
    || resume.sinkCapability?.hash !== plan.sinkCapability.hash
  ) {
    throw new StudioOutOfCoreExportError(
      "provenance-mismatch",
      "Resume manifest provenance does not match the current export plan.",
    );
  }
  if (resume.tiles.length > plan.totalTiles) {
    throw new StudioOutOfCoreExportError(
      "provenance-mismatch",
      "Resume manifest contains more entries than this export plan.",
    );
  }
  if (resume.tiles.length > 0 && !hasVerifier) {
    throw new StudioOutOfCoreExportError(
      "provenance-mismatch",
      "A sink verifier is required before resume entries can be skipped.",
    );
  }
  const entries = new Map<string, StudioOutOfCoreResumeTile>();
  for (const entry of resume.tiles) {
    if (!entry || typeof entry !== "object") {
      throw new StudioOutOfCoreExportError(
        "provenance-mismatch",
        "Resume manifest contains a malformed tile entry.",
      );
    }
    const coordinates = parseTileId(entry.tileId);
    if (!coordinates) {
      throw new StudioOutOfCoreExportError(
        "provenance-mismatch",
        "Resume manifest contains an invalid tile identifier.",
      );
    }
    let planned: StudioOutOfCoreTilePlan;
    try {
      planned = plan.tileAt(coordinates.row, coordinates.column);
    } catch {
      throw new StudioOutOfCoreExportError(
        "provenance-mismatch",
        "Resume manifest contains a tile outside the current plan.",
      );
    }
    if (planned.id !== entry.tileId || entries.has(entry.tileId)) {
      throw new StudioOutOfCoreExportError(
        "provenance-mismatch",
        "Resume manifest tile identifiers are not unique and canonical.",
      );
    }
    let contentHash: StudioOutOfCoreSha256;
    let byteLength: number;
    try {
      contentHash = normalizeHash(
        entry.contentHash,
        "resume tile contentHash",
      );
      byteLength = parseBoundedSafeInteger(
        entry.byteLength,
        "resume tile byteLength",
        1,
        plan.rendererCapability.maxOutputBytes,
      );
    } catch {
      throw new StudioOutOfCoreExportError(
        "provenance-mismatch",
        "Resume manifest contains an invalid tile hash or byte length.",
      );
    }
    entries.set(
      entry.tileId,
      Object.freeze({ tileId: entry.tileId, contentHash, byteLength }),
    );
  }
  return entries;
}

function cloneBytes(
  value: ArrayBuffer | ArrayBufferView,
): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (!ArrayBuffer.isView(value)) {
    throw new StudioOutOfCoreExportError(
      "integrity-mismatch",
      "Renderer output must be an ArrayBuffer or typed-array view.",
    );
  }
  return new Uint8Array(
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
  );
}

function isPromiseLike<Value>(
  value: Value | Promise<Value>,
): value is Promise<Value> {
  return (
    typeof value === "object"
    && value !== null
    && "then" in value
    && typeof value.then === "function"
  );
}

function normalizeExternalAbortSignal(
  value: unknown,
): NormalizedExternalAbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      "signal must implement the AbortSignal event contract.",
    );
  }
  let aborted: unknown;
  let addEventListener: unknown;
  let removeEventListener: unknown;
  try {
    aborted = Reflect.get(value, "aborted");
    addEventListener = Reflect.get(value, "addEventListener");
    removeEventListener = Reflect.get(value, "removeEventListener");
  } catch (cause) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      "signal could not be inspected safely.",
      null,
      { cause },
    );
  }
  if (
    typeof aborted !== "boolean"
    || typeof addEventListener !== "function"
    || typeof removeEventListener !== "function"
  ) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      "signal must implement the AbortSignal event contract.",
    );
  }
  return Object.freeze({
    isAborted: (): boolean => {
      const current = Reflect.get(value, "aborted");
      if (typeof current !== "boolean") {
        throw new StudioOutOfCoreExportError(
          "invalid-request",
          "signal.aborted changed to a non-boolean value.",
        );
      }
      return current;
    },
    addAbortListener: (listener: () => void): void => {
      Reflect.apply(addEventListener, value, [
        "abort",
        listener,
        { once: true },
      ]);
    },
    removeAbortListener: (listener: () => void): void => {
      Reflect.apply(removeEventListener, value, ["abort", listener]);
    },
  });
}

function safeRemoveExternalAbortListener(
  externalSignal: NormalizedExternalAbortSignal | undefined,
  listener: () => void,
): void {
  if (!externalSignal) return;
  try {
    externalSignal.removeAbortListener(listener);
  } catch {
    // Internal lifecycle state is authoritative. A hostile listener target must
    // never keep the provider active or mask the export result during cleanup.
  }
}

function hashBytes(bytes: Uint8Array): StudioOutOfCoreSha256 {
  return `sha256:${sha256HexPortable(bytes)}`;
}

function rollingTileManifestHash(
  plan: StudioOutOfCoreExportPlan,
  records: ReadonlyMap<string, TileRecord>,
): StudioOutOfCoreSha256 {
  let rolling = hashText(
    `studio-out-of-core-tile-manifest:${plan.manifestFingerprint}`,
  );
  for (const tile of plan.tiles()) {
    const record = records.get(tile.id);
    if (!record) {
      throw new StudioOutOfCoreExportError(
        "integrity-mismatch",
        "Completed export is missing a canonical tile record.",
      );
    }
    rolling = hashText(
      `${rolling}\n${tile.id}\n${record.hash}\n${record.byteLength}`,
    );
  }
  return rolling;
}

function receiptHash(
  receipt: Omit<StudioOutOfCoreExportReceipt, "receiptHash">,
): StudioOutOfCoreSha256 {
  return hashText(JSON.stringify(receipt));
}

function buildReceipt(
  plan: StudioOutOfCoreExportPlan,
  epoch: number,
  sequence: number,
  metrics: MutableMetrics,
  effectiveConcurrency: number,
  operationTimeoutMs: number,
  status: "complete" | "fail-closed",
  tileManifestHash: StudioOutOfCoreSha256 | null,
  failureCode: StudioOutOfCoreExportErrorCode | null,
): StudioOutOfCoreExportReceipt {
  const record = Object.freeze({
    kind: "studio-out-of-core-export-receipt" as const,
    revision: STUDIO_OUT_OF_CORE_EXPORT_PROVIDER_REVISION,
    status,
    epoch,
    sequence,
    logicalDimensions: Object.freeze({
      width: plan.logicalWidth,
      height: plan.logicalHeight,
      pixelCount: plan.logicalPixelCount,
    }),
    outputDimensions: Object.freeze({
      width: plan.outputWidth,
      height: plan.outputHeight,
      pixelCount: plan.outputPixelCount,
    }),
    scale: Object.freeze({
      numerator: plan.scaleNumerator,
      denominator: plan.scaleDenominator,
    }),
    tileCount: plan.totalTilesDecimal,
    completedTiles: metrics.completedTiles,
    skippedTiles: metrics.skippedTiles,
    retriedTiles: metrics.retriedTiles,
    retryAttempts: metrics.retryAttempts,
    peakResidentBytes: metrics.peakResidentBytes,
    effectiveConcurrency,
    operationTimeoutMs,
    totalWorkPixels: plan.totalWorkPixels,
    rendererCapability: capabilityIdentity(plan.rendererCapability),
    sinkCapability: capabilityIdentity(plan.sinkCapability),
    planFingerprint: plan.manifestFingerprint,
    tileManifestHash,
    failureCode,
  });
  return Object.freeze({ ...record, receiptHash: receiptHash(record) });
}

function isTerminalError(error: unknown): error is StudioOutOfCoreExportError {
  return error instanceof StudioOutOfCoreExportError
    && error.code !== "tile-failed";
}

export function createStudioOutOfCoreExportProvider(
  options: Readonly<{
    epoch?: number;
    budgets?: StudioOutOfCoreExportBudgetInput;
  }> = {},
): StudioOutOfCoreExportProvider {
  let epoch = options.epoch ?? 0;
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new StudioOutOfCoreExportError(
      "invalid-request",
      "Provider epoch must be a non-negative safe integer.",
    );
  }
  const budgets = normalizeBudgets(options.budgets);
  let sequence = 0;
  let disposed = false;
  let activeExports = 0;
  const activeControllers = new Set<AbortController>();

  const assertAdmissible = (requestEpoch: number): void => {
    if (disposed) {
      throw new StudioOutOfCoreExportError(
        "disposed",
        "Out-of-core export provider has been disposed.",
      );
    }
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== epoch) {
      throw new StudioOutOfCoreExportError(
        "epoch-mismatch",
        "Export request epoch does not match the current document epoch.",
      );
    }
  };

  const setEpoch = (nextEpoch: number): void => {
    if (
      disposed
      || !Number.isSafeInteger(nextEpoch)
      || nextEpoch < epoch
    ) {
      throw new StudioOutOfCoreExportError(
        disposed ? "disposed" : "invalid-request",
        disposed
          ? "Out-of-core export provider has been disposed."
          : "Export epochs are monotonic non-negative safe integers.",
      );
    }
    if (nextEpoch !== epoch) {
      epoch = nextEpoch;
      for (const controller of activeControllers) controller.abort();
    }
  };

  const exportDocument = async (
    request: StudioOutOfCoreExportRequest,
  ): Promise<StudioOutOfCoreExportReceipt> => {
    if (!request || typeof request !== "object") {
      throw new StudioOutOfCoreExportError(
        "invalid-request",
        "An export request is required.",
      );
    }
    if (activeExports !== 0) {
      throw new StudioOutOfCoreExportError(
        "backpressure",
        "Only one out-of-core export may own this provider at a time.",
      );
    }
    // Claim synchronously before inspecting any caller-controlled properties or
    // invoking AbortSignal methods. Those accessors may reenter this provider;
    // the provisional claim makes such calls observe backpressure. Sequence is
    // assigned only after every preflight and lifecycle recheck succeeds.
    activeExports += 1;
    let claimHeld = true;
    const releaseClaim = (): void => {
      if (!claimHeld) return;
      claimHeld = false;
      activeExports -= 1;
    };
    let controller: AbortController;
    try {
      controller = new AbortController();
    } catch (cause) {
      releaseClaim();
      throw new StudioOutOfCoreExportError(
        "invalid-request",
        "An internal abort controller could not be created.",
        null,
        { cause },
      );
    }
    const onExternalAbort = (): void => controller.abort();
    let externalSignal: NormalizedExternalAbortSignal | undefined;
    let requestEpoch!: number;
    let renderTile!: StudioOutOfCoreRendererAdapter["renderTile"];
    let writeTile!: StudioOutOfCoreSinkAdapter["writeTile"];
    let verifyTile: StudioOutOfCoreSinkAdapter["verifyTile"];
    let plan!: StudioOutOfCoreExportPlan;
    let resumeEntries!: ReadonlyMap<string, StudioOutOfCoreResumeTile>;
    let retryBudget!: number;
    let operationTimeoutMs!: number;
    let effectiveConcurrency!: number;

    try {
      requestEpoch = request.epoch;
      const externalSignalValue = request.signal;
      assertAdmissible(requestEpoch);
      if (
        !request.renderer
        || typeof request.renderer.renderTile !== "function"
        || !request.sink
        || typeof request.sink.writeTile !== "function"
      ) {
        throw new StudioOutOfCoreExportError(
          "invalid-request",
          "Renderer and sink adapters are required.",
        );
      }
      renderTile = request.renderer.renderTile.bind(request.renderer);
      writeTile = request.sink.writeTile.bind(request.sink);
      verifyTile = request.sink.verifyTile?.bind(request.sink);
      externalSignal = normalizeExternalAbortSignal(externalSignalValue);
      const normalized = createNormalizedPlan(
        {
          logicalWidth: request.logicalWidth,
          logicalHeight: request.logicalHeight,
          scale: request.scale,
          tiling: request.tiling,
          bytesPerPixel: request.bytesPerPixel,
          rendererCapability: request.renderer.capability,
          sinkCapability: request.sink.capability,
        },
        budgets,
      );
      plan = normalized.plan;
      resumeEntries = prepareResume(
        request.resume,
        plan,
        typeof verifyTile === "function",
      );
      const requestedConcurrency = parseBoundedSafeInteger(
        request.concurrency ?? 1,
        "concurrency",
        1,
        budgets.maxConcurrency,
      );
      retryBudget = parseBoundedSafeInteger(
        request.retryBudget ?? 0,
        "retryBudget",
        0,
        budgets.maxRetriesPerTile,
      );
      operationTimeoutMs = parseBoundedSafeInteger(
        request.operationTimeoutMs ?? budgets.defaultOperationTimeoutMs,
        "operationTimeoutMs",
        1,
        budgets.maxOperationTimeoutMs,
      );
      const residentConcurrency = Math.floor(
        budgets.maxResidentBytes / plan.maxTileReservationBytes,
      );
      effectiveConcurrency = Math.min(
        requestedConcurrency,
        residentConcurrency,
        plan.totalTiles,
      );
      if (effectiveConcurrency < 1) {
        budgetError("No tile can be admitted within the resident-memory budget.");
      }
      try {
        externalSignal?.addAbortListener(onExternalAbort);
        if (externalSignal?.isAborted()) controller.abort();
      } catch (cause) {
        throw cause instanceof StudioOutOfCoreExportError
          ? cause
          : new StudioOutOfCoreExportError(
            "invalid-request",
            "signal listener setup failed.",
            null,
            { cause },
          );
      }
      // Signal accessors and listener methods are caller code. Revalidate after
      // they return so a reentrant epoch change or dispose cannot be admitted.
      assertAdmissible(requestEpoch);
      if (!Number.isSafeInteger(sequence + 1)) {
        budgetError("Export sequence capacity has been exhausted.");
      }
    } catch (error) {
      safeRemoveExternalAbortListener(externalSignal, onExternalAbort);
      releaseClaim();
      throw error;
    }
    sequence += 1;
    const admittedSequence = sequence;
    activeControllers.add(controller);

    const metrics: MutableMetrics = {
      completedTiles: 0,
      skippedTiles: 0,
      retriedTiles: 0,
      retryAttempts: 0,
      peakResidentBytes: 0,
      currentResidentBytes: 0,
    };
    const records = new Map<string, TileRecord>();
    const iterator = plan.tiles();
    let firstFailure: StudioOutOfCoreExportError | null = null;

    const assertCurrent = (): void => {
      if (disposed) {
        throw new StudioOutOfCoreExportError(
          "disposed",
          "Out-of-core export provider was disposed during export.",
        );
      }
      if (requestEpoch !== epoch) {
        throw new StudioOutOfCoreExportError(
          "epoch-mismatch",
          "Export became stale after the document epoch changed.",
        );
      }
      if (controller.signal.aborted) {
        throw new StudioOutOfCoreExportError(
          "aborted",
          "Out-of-core export was cancelled.",
        );
      }
    };

    const raceAdapterOperation = async <Value>(
      pending: Value | Promise<Value>,
      label: string,
    ): Promise<Value> => {
      assertCurrent();
      if (!isPromiseLike(pending)) return pending;
      return new Promise<Value>((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const cleanup = (): void => {
          if (timeout !== null) {
            clearTimeout(timeout);
            timeout = null;
          }
          controller.signal.removeEventListener("abort", onInternalAbort);
        };
        const settle = (
          action: (value: Value | PromiseLike<Value>) => void,
          value: Value | PromiseLike<Value>,
        ): void => {
          if (settled) return;
          settled = true;
          cleanup();
          action(value);
        };
        const settleError = (error: unknown): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const onInternalAbort = (): void => {
          try {
            assertCurrent();
            settleError(new StudioOutOfCoreExportError(
              "aborted",
              `${label} was cancelled.`,
            ));
          } catch (error) {
            settleError(error);
          }
        };

        controller.signal.addEventListener(
          "abort",
          onInternalAbort,
          { once: true },
        );
        timeout = setTimeout(() => {
          settleError(new StudioOutOfCoreExportError(
            "operation-timeout",
            `${label} exceeded the ${operationTimeoutMs} ms operation timeout.`,
          ));
        }, operationTimeoutMs);
        Promise.resolve(pending).then(
          (value) => {
            if (settled) return;
            try {
              assertCurrent();
              settle(resolve, value);
            } catch (error) {
              settleError(error);
            }
          },
          (error) => settleError(error),
        );
        if (controller.signal.aborted) onInternalAbort();
      });
    };

    const verifyResumeEntry = async (
      tile: StudioOutOfCoreTilePlan,
      entry: StudioOutOfCoreResumeTile,
    ): Promise<boolean> => {
      if (!verifyTile) return false;
      try {
        const pending = verifyTile({
          epoch: requestEpoch,
          sequence: admittedSequence,
          manifestFingerprint: plan.manifestFingerprint,
          tile,
          expectedHash: entry.contentHash,
          expectedByteLength: entry.byteLength,
          signal: controller.signal,
        });
        const result = await raceAdapterOperation(
          pending,
          `Resume verification for ${tile.id}`,
        );
        assertCurrent();
        const verified = Boolean(
          result
          && result.verifiedHash === entry.contentHash
          && result.byteLength === entry.byteLength,
        );
        // Verification result properties may be caller-controlled accessors.
        // Recheck before their result can become a skipped-tile record.
        assertCurrent();
        return verified;
      } catch (error) {
        assertCurrent();
        if (isTerminalError(error)) throw error;
        return false;
      }
    };

    const renderAndWrite = async (
      tile: StudioOutOfCoreTilePlan,
    ): Promise<void> => {
      const resumeEntry = resumeEntries.get(tile.id);
      if (resumeEntry && await verifyResumeEntry(tile, resumeEntry)) {
        records.set(tile.id, {
          hash: resumeEntry.contentHash,
          byteLength: resumeEntry.byteLength,
        });
        metrics.skippedTiles += 1;
        return;
      }

      let countedRetry = false;
      for (let attempt = 0; attempt <= retryBudget; attempt += 1) {
        assertCurrent();
        try {
          const pendingRendered = renderTile(tile, {
            epoch: requestEpoch,
            sequence: admittedSequence,
            attempt,
            manifestFingerprint: plan.manifestFingerprint,
            signal: controller.signal,
          });
          const rendered = await raceAdapterOperation(
            pendingRendered,
            `Renderer operation for ${tile.id}`,
          );
          assertCurrent();
          if (!rendered || typeof rendered !== "object") {
            throw new StudioOutOfCoreExportError(
              "integrity-mismatch",
              `Renderer returned no artifact for ${tile.id}.`,
            );
          }
          const bytes = cloneBytes(rendered.bytes);
          if (
            bytes.byteLength < 1
            || bytes.byteLength > plan.rendererCapability.maxOutputBytes
            || bytes.byteLength > budgets.maxTilePayloadBytes
          ) {
            throw new StudioOutOfCoreExportError(
              "budget-exceeded",
              `Renderer artifact for ${tile.id} violates the payload budget.`,
            );
          }
          const contentHash = hashBytes(bytes);
          if (
            rendered.contentHash !== undefined
            && normalizeHash(
              rendered.contentHash,
              "renderer contentHash",
            ) !== contentHash
          ) {
            throw new StudioOutOfCoreExportError(
              "integrity-mismatch",
              `Renderer hash does not match the owned bytes for ${tile.id}.`,
            );
          }
          // Renderer artifact properties are caller-controlled accessors. Do
          // not invoke a stale sink if one invalidated the lifecycle.
          assertCurrent();
          const pendingWritten = writeTile({
            epoch: requestEpoch,
            sequence: admittedSequence,
            attempt,
            manifestFingerprint: plan.manifestFingerprint,
            tile,
            bytes,
            contentHash,
            signal: controller.signal,
          });
          const written = await raceAdapterOperation(
            pendingWritten,
            `Sink write for ${tile.id}`,
          );
          assertCurrent();
          const verifiedHash = written
            ? normalizeHash(
              written.verifiedHash,
              "sink verifiedHash",
            )
            : null;
          const writtenByteLength = written?.byteLength;
          if (
            !written
            || verifiedHash !== contentHash
            || writtenByteLength !== bytes.byteLength
            || hashBytes(bytes) !== contentHash
          ) {
            throw new StudioOutOfCoreExportError(
              "integrity-mismatch",
              `Sink did not verify the exact artifact for ${tile.id}.`,
            );
          }
          // Written-tile accessors are caller code too. Keep lifecycle-driven
          // failures from being counted as completed work.
          assertCurrent();
          records.set(tile.id, {
            hash: contentHash,
            byteLength: bytes.byteLength,
          });
          metrics.completedTiles += 1;
          return;
        } catch (error) {
          assertCurrent();
          if (isTerminalError(error)) throw error;
          if (attempt >= retryBudget) {
            throw new StudioOutOfCoreExportError(
              "tile-failed",
              `Tile ${tile.id} exhausted its retry budget.`,
              null,
              { cause: error },
            );
          }
          if (!countedRetry) {
            countedRetry = true;
            metrics.retriedTiles += 1;
          }
          metrics.retryAttempts += 1;
        }
      }
    };

    const worker = async (): Promise<void> => {
      while (!firstFailure) {
        try {
          assertCurrent();
          const next = iterator.next();
          if (next.done) return;
          const tile = next.value;
          metrics.currentResidentBytes += tile.reservedResidentBytes;
          metrics.peakResidentBytes = Math.max(
            metrics.peakResidentBytes,
            metrics.currentResidentBytes,
          );
          try {
            await renderAndWrite(tile);
          } finally {
            metrics.currentResidentBytes -= tile.reservedResidentBytes;
          }
        } catch (error) {
          if (!firstFailure) {
            firstFailure = error instanceof StudioOutOfCoreExportError
              ? error
              : new StudioOutOfCoreExportError(
                "tile-failed",
                "An export adapter failed without a structured error.",
                null,
                { cause: error },
              );
            controller.abort();
          }
          return;
        }
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: effectiveConcurrency },
          () => worker(),
        ),
      );
      if (firstFailure) {
        const failure = firstFailure as StudioOutOfCoreExportError;
        const failedReceipt = buildReceipt(
          plan,
          requestEpoch,
          admittedSequence,
          metrics,
          effectiveConcurrency,
          operationTimeoutMs,
          "fail-closed",
          null,
          failure.code,
        );
        throw new StudioOutOfCoreExportError(
          failure.code,
          failure.message,
          failedReceipt,
          { cause: failure.cause },
        );
      }
      if (
        metrics.completedTiles + metrics.skippedTiles !== plan.totalTiles
        || records.size !== plan.totalTiles
      ) {
        const failedReceipt = buildReceipt(
          plan,
          requestEpoch,
          admittedSequence,
          metrics,
          effectiveConcurrency,
          operationTimeoutMs,
          "fail-closed",
          null,
          "integrity-mismatch",
        );
        throw new StudioOutOfCoreExportError(
          "integrity-mismatch",
          "Export finished without a verified record for every tile.",
          failedReceipt,
        );
      }
      const tileManifestHash = rollingTileManifestHash(plan, records);
      return buildReceipt(
        plan,
        requestEpoch,
        admittedSequence,
        metrics,
        effectiveConcurrency,
        operationTimeoutMs,
        "complete",
        tileManifestHash,
        null,
      );
    } finally {
      activeControllers.delete(controller);
      safeRemoveExternalAbortListener(externalSignal, onExternalAbort);
      releaseClaim();
    }
  };

  return Object.freeze({
    exportDocument,
    setEpoch,
    snapshot: () => Object.freeze({
      state: disposed ? "disposed" as const : "ready" as const,
      epoch,
      sequence,
      activeExports,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    },
  });
}
