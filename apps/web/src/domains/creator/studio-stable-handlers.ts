import { useLayoutEffect, useRef, useState } from "react";

// Identity-stable event-handler bundle for memoized children of compiler-bailed (or
// frequently-invalidated) parents. Wrappers are created once and read the latest closures from
// a ref refreshed in a layout effect, so a memo child never re-renders because a handler was
// re-declared. Only safe for event-time invocation (never call these during render — the ref
// lags one commit there).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- variadic handler bag
type StudioStableHandlerBag = Record<string, (...args: any[]) => unknown>;

export function useStudioStableHandlers<
  T extends { [K in keyof T]: (...args: never[]) => unknown },
>(handlers: T): T {
  const latestRef = useRef(handlers);
  useLayoutEffect(() => {
    latestRef.current = handlers;
  });
  const [stable] = useState(() => {
    const out: StudioStableHandlerBag = {};
    for (const key of Object.keys(handlers)) {
      out[key] = (...args: unknown[]) =>
        (latestRef.current as unknown as StudioStableHandlerBag)[key](...args);
    }
    return out as unknown as T;
  });
  return stable;
}
