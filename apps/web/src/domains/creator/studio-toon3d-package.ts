/**
 * `.toon3d` authoring package shell (doc §7.2) — JSON/ZIP-ready structure.
 * Does not replace glTF runtime IR; preserves edit/history/rights pointers.
 */

import { sha256HexPortable } from "./studio-sha256";

import type { StudioHybridDccPersistedSnapshot, StudioRightsBomRecord  } from "./hybrid-dcc/studio-hybrid-dcc-document";
import type { StudioLiveBridgeDocument } from "./live/studio-live-2d3d-bridge";

export const STUDIO_TOON3D_PACKAGE_REVISION = 1 as const;
export const STUDIO_TOON3D_PACKAGE_FORMAT = "toonspectrum.toon3d" as const;

export interface StudioToon3dManifest {
  readonly format: typeof STUDIO_TOON3D_PACKAGE_FORMAT;
  readonly revision: typeof STUDIO_TOON3D_PACKAGE_REVISION;
  readonly documentId: string;
  readonly units: "meters";
  readonly axis: "y-up";
  readonly createdAt: string;
  readonly packageHash: `sha256:${string}`;
  readonly paths: {
    readonly document: string;
    readonly shots: string;
    readonly rights: string;
    readonly reports: string;
  };
}

export interface StudioToon3dPackage {
  readonly manifest: StudioToon3dManifest;
  readonly files: Readonly<Record<string, string>>;
}

export function packStudioToon3dPackage(input: {
  readonly documentId: string;
  readonly snapshot: StudioHybridDccPersistedSnapshot;
  readonly bridge: StudioLiveBridgeDocument;
  readonly rightsBom: readonly StudioRightsBomRecord[];
  readonly createdAt?: string;
}): StudioToon3dPackage {
  const documentJson = JSON.stringify(input.snapshot, null, 2);
  const shotsJson = JSON.stringify(
    {
      setId: input.bridge.set.id,
      setHash: input.bridge.set.setHash,
      shots: input.bridge.shots,
      artistCorrections: input.bridge.artistCorrections,
    },
    null,
    2,
  );
  const rightsJson = JSON.stringify(
    { rightsBom: input.rightsBom },
    null,
    2,
  );
  const reportsJson = JSON.stringify(
    {
      note: "Import/export loss reports attach under reports/import-*.json",
      objectCount: input.bridge.set.objects.length,
      shotCount: input.bridge.shots.length,
    },
    null,
    2,
  );
  const files: Record<string, string> = {
    "manifest.json": "", // filled below
    "document/document.json": documentJson,
    "shots/shots.json": shotsJson,
    "rights/rights-bom.json": rightsJson,
    "reports/package-summary.json": reportsJson,
  };
  const bodyHash = sha256HexPortable(
    new TextEncoder().encode(
      Object.keys(files)
        .filter((k) => k !== "manifest.json")
        .sort()
        .map((k) => `${k}:${files[k]}`)
        .join("\n"),
    ),
  );
  const manifest: StudioToon3dManifest = {
    format: STUDIO_TOON3D_PACKAGE_FORMAT,
    revision: STUDIO_TOON3D_PACKAGE_REVISION,
    documentId: input.documentId,
    units: "meters",
    axis: "y-up",
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    packageHash: `sha256:${bodyHash}`,
    paths: {
      document: "document/document.json",
      shots: "shots/shots.json",
      rights: "rights/rights-bom.json",
      reports: "reports/package-summary.json",
    },
  };
  files["manifest.json"] = JSON.stringify(manifest, null, 2);
  return { manifest, files };
}

export function unpackStudioToon3dPackage(pkg: StudioToon3dPackage): {
  readonly manifest: StudioToon3dManifest;
  readonly document: StudioHybridDccPersistedSnapshot;
  readonly rightsCount: number;
  readonly shotCount: number;
} {
  const document = JSON.parse(
    pkg.files["document/document.json"] ?? "{}",
  ) as StudioHybridDccPersistedSnapshot;
  const shots = JSON.parse(pkg.files["shots/shots.json"] ?? "{}") as {
    shots?: unknown[];
  };
  const rights = JSON.parse(pkg.files["rights/rights-bom.json"] ?? "{}") as {
    rightsBom?: unknown[];
  };
  return {
    manifest: pkg.manifest,
    document,
    rightsCount: rights.rightsBom?.length ?? 0,
    shotCount: shots.shots?.length ?? 0,
  };
}
