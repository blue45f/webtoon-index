/**
 * Webtoon-Index (ToonSpectrum) Browser Polyfills & Compatibility Enhancements
 * 다양한 브라우저 환경에서 웹 앱이 안정적으로 동작하도록 표준 API 및 최신 메서드를 보완합니다.
 */

// 1. globalThis polyfill
if (typeof globalThis === "undefined") {
  (function () {
    if (typeof self !== "undefined") {
      (self as unknown as { globalThis: typeof self }).globalThis = self;
    } else if (typeof window !== "undefined") {
      (window as unknown as { globalThis: typeof window }).globalThis = window;
    }
  })();
}

// 2. structuredClone polyfill
if (typeof globalThis.structuredClone !== "function") {
  globalThis.structuredClone = function <T>(val: T): T {
    if (val === undefined) return undefined as unknown as T;
    try {
      return JSON.parse(JSON.stringify(val));
    } catch {
      // JSON 직렬화 불가 객체(예: Circular, Functions)일 경우 얕은 복사 폴백
      if (typeof val === "object" && val !== null) {
        return (Array.isArray(val) ? [...val] : { ...val }) as unknown as T;
      }
      return val;
    }
  };
}

// 3. Object.hasOwn polyfill
if (!Object.hasOwn) {
  Object.hasOwn = function (object: object, property: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(object, property);
  };
}

// 4. Array.prototype.flat polyfill
if (!Array.prototype.flat) {
  (Array.prototype as unknown as { flat: (depth?: number) => unknown[] }).flat = function (
    depth = 1
  ): unknown[] {
    const flatten = (arr: unknown[], d: number): unknown[] => {
      return d > 0
        ? arr.reduce((acc: unknown[], val: unknown) => {
            return acc.concat(Array.isArray(val) ? flatten(val, d - 1) : val);
          }, [])
        : arr.slice();
    };
    return flatten(this as unknown[], depth);
  };
}

// 5. Array.prototype.flatMap polyfill
if (!Array.prototype.flatMap) {
  (
    Array.prototype as unknown as {
      flatMap: (callback: (val: unknown, index: number, array: unknown[]) => unknown) => unknown[];
    }
  ).flatMap = function (
    callback: (val: unknown, index: number, array: unknown[]) => unknown
  ): unknown[] {
    return (this as unknown[]).map(callback).flat(1);
  };
}

// 6. String.prototype.replaceAll polyfill
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (
    search: string | RegExp,
    replacement: string | ((substring: string, ...args: unknown[]) => string)
  ): string {
    if (search instanceof RegExp) {
      if (!search.global) {
        throw new TypeError("String.prototype.replaceAll called with a non-global RegExp");
      }
      return this.replace(search, replacement as string);
    }
    const searchStr = String(search);
    return this.split(searchStr).join(String(replacement));
  };
}

// 7. requestIdleCallback & cancelIdleCallback polyfill
if (!window.requestIdleCallback) {
  window.requestIdleCallback = function (
    cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void
  ): number {
    const start = Date.now();
    return window.setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      });
    }, 1) as unknown as number;
  };
}

if (!window.cancelIdleCallback) {
  window.cancelIdleCallback = function (id: number): void {
    clearTimeout(id);
  };
}

// 8. ResizeObserver 안전 가드 (미지원 시 크시 렌더 에러 방지 stub)
if (typeof window !== "undefined" && !window.ResizeObserver) {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver = StubResizeObserver;
}

// 9. IntersectionObserver 안전 가드
if (typeof window !== "undefined" && !window.IntersectionObserver) {
  class StubIntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "0px";
    readonly thresholds: ReadonlyArray<number> = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  (window as unknown as { IntersectionObserver: typeof StubIntersectionObserver }).IntersectionObserver = StubIntersectionObserver;
}

export {};
