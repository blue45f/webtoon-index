export function normalizeSurfaceColor(color: string | undefined): string {
  const normalized = color?.trim().toLowerCase() ?? "";
  if (/^#[0-9a-f]{3}$/u.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  return normalized;
}

export function surfaceGradientsMatch(
  current: readonly string[] | null,
  candidate: readonly string[] | undefined,
): boolean {
  return current?.length === 2
    && candidate?.length === 2
    && normalizeSurfaceColor(current[0]) === normalizeSurfaceColor(candidate[0])
    && normalizeSurfaceColor(current[1]) === normalizeSurfaceColor(candidate[1]);
}
