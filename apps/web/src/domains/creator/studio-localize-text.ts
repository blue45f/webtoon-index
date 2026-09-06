/**
 * Studio's translate-or-keep-the-authored-copy helper.
 *
 * `useT()` returns the key itself when a locale pack has no entry for it (and Studio packs load
 * lazily, so that is also the state during the first paint). Callers therefore pass the authored
 * Korean string as the fallback: the UI never shows a raw `studio.*` key, and unit tests that
 * render a component without the i18n bundle keep asserting the authored copy.
 */
export function localizeStudioText(
  t: (key: string) => string,
  fallback: string,
  key: string,
): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}
