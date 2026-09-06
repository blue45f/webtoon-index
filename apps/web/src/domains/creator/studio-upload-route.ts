export function resolveStudioUploadWorkId(
  routeWorkId: string | null | undefined,
  legacyQueryWorkId: string | null,
): string | null {
  return routeWorkId === undefined ? legacyQueryWorkId : routeWorkId;
}
