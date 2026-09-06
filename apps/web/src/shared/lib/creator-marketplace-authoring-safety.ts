export interface CreatorMarketplacePortableValueLimits {
  maxDepth: number;
  maxEntries: number;
  maxStringLength: number;
  maxSerializedBytes: number;
}

export const CREATOR_MARKETPLACE_PORTABLE_VALUE_LIMITS: CreatorMarketplacePortableValueLimits = {
  maxDepth: 48,
  maxEntries: 160_000,
  maxStringLength: 2_000_000,
  maxSerializedBytes: 16 * 1024 * 1024,
};

export class CreatorMarketplacePortableValueError extends Error {
  readonly code:
    | "cycle"
    | "depth"
    | "entries"
    | "string-length"
    | "serialized-size"
    | "unsupported-number";
  readonly path: string;

  constructor(
    code: CreatorMarketplacePortableValueError["code"],
    path: string,
    message: string,
  ) {
    super(message);
    this.name = "CreatorMarketplacePortableValueError";
    this.code = code;
    this.path = path;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

/**
 * Creates a JSON-compatible bounded clone. JSON-compatible values are retained exactly; functions,
 * symbols and undefined object members are omitted just as JSON.stringify would omit them. Cycles,
 * non-finite numbers and over-budget payloads are rejected instead of silently corrupting a brush.
 */
export function sanitizeCreatorMarketplacePortableValue(
  input: unknown,
  limits: CreatorMarketplacePortableValueLimits = CREATOR_MARKETPLACE_PORTABLE_VALUE_LIMITS,
): unknown {
  const ancestors = new WeakSet<object>();
  let entries = 0;

  const visit = (value: unknown, path: string, depth: number): unknown => {
    if (depth > limits.maxDepth) {
      throw new CreatorMarketplacePortableValueError(
        "depth",
        path,
        `제작 원본의 중첩 깊이가 ${limits.maxDepth}단계를 초과했습니다.`,
      );
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.length > limits.maxStringLength) {
        throw new CreatorMarketplacePortableValueError(
          "string-length",
          path,
          "제작 원본의 단일 문자열이 허용 길이를 초과했습니다.",
        );
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new CreatorMarketplacePortableValueError(
          "unsupported-number",
          path,
          "NaN 또는 무한대는 제작 패키지에 저장할 수 없습니다.",
        );
      }
      return value;
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
      return undefined;
    }
    if (typeof value !== "object") return String(value);
    if (ancestors.has(value)) {
      throw new CreatorMarketplacePortableValueError(
        "cycle",
        path,
        "제작 원본에 순환 참조가 포함되어 있습니다.",
      );
    }
    ancestors.add(value);
    try {
      if (ArrayBuffer.isView(value)) {
        const typed = value as ArrayBufferView;
        entries += typed.byteLength;
        if (entries > limits.maxEntries) {
          throw new CreatorMarketplacePortableValueError(
            "entries",
            path,
            "제작 원본의 데이터 항목 수가 허용 범위를 초과했습니다.",
          );
        }
        return Array.from(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
      }
      if (value instanceof Date) return value.toISOString();
      if (Array.isArray(value)) {
        entries += value.length;
        if (entries > limits.maxEntries) {
          throw new CreatorMarketplacePortableValueError(
            "entries",
            path,
            "제작 원본의 데이터 항목 수가 허용 범위를 초과했습니다.",
          );
        }
        return value.map((entry, index) => {
          const result = visit(entry, `${path}[${index}]`, depth + 1);
          return result === undefined ? null : result;
        });
      }
      if (!isPlainRecord(value)) {
        const jsonMethod = (value as { toJSON?: unknown }).toJSON;
        if (typeof jsonMethod === "function") {
          return visit(jsonMethod.call(value), `${path}.toJSON()`, depth + 1);
        }
        throw new CreatorMarketplacePortableValueError(
          "cycle",
          path,
          "DOM·Canvas·렌더러 인스턴스는 제작 원본에 직접 저장할 수 없습니다.",
        );
      }
      const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
      entries += keys.length;
      if (entries > limits.maxEntries) {
        throw new CreatorMarketplacePortableValueError(
          "entries",
          path,
          "제작 원본의 데이터 항목 수가 허용 범위를 초과했습니다.",
        );
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const next = visit(value[key], `${path}.${key}`, depth + 1);
        if (next !== undefined) result[key] = next;
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  };

  const sanitized = visit(input, "$", 0);
  const serialized = JSON.stringify(sanitized);
  if (utf8Bytes(serialized) > limits.maxSerializedBytes) {
    throw new CreatorMarketplacePortableValueError(
      "serialized-size",
      "$",
      `제작 패키지가 ${(limits.maxSerializedBytes / 1024 / 1024).toFixed(0)}MB 제한을 초과했습니다.`,
    );
  }
  return sanitized;
}

export function measureCreatorMarketplacePortableValueBytes(input: unknown): number {
  const sanitized = sanitizeCreatorMarketplacePortableValue(input);
  return utf8Bytes(JSON.stringify(sanitized));
}
