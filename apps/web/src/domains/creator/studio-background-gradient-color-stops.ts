/**
 * Hot-path-only background gradient projection.
 *
 * Keep this tiny helper independent from the optional background catalog: the canvas needs to
 * render a saved gradient immediately, while the 30+ preset definitions and SVG builders should
 * load only when the artist opens the background workflow.
 */
export function studioBackgroundGradientColorStops(
  stops: readonly string[] | null | undefined
): Array<number | string> | null {
  if (!stops || stops.length === 0) return null;
  if (stops.length === 1) return [0, stops[0]!, 1, stops[0]!];
  const out: Array<number | string> = [];
  const last = stops.length - 1;
  for (let index = 0; index < stops.length; index += 1) {
    out.push(index / last, stops[index]!);
  }
  return out;
}
