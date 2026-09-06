import { afterEach, describe, expect, it } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";
import { createStudioOpfsMemoryFileSystem } from "../studio-opfs-filesystem";

import { createStudioVrmAssetSqliteOpfsRepository } from "./studio-vrm-asset-sqlite-opfs-repository";
import { createStudioVrmLicenseAuthorityStore } from "./studio-vrm-license-authority-store";
import { STUDIO_VRM_1_PUBLIC_LICENSE_URL } from "./studio-vrm-license-metadata";
import {
  createStudioVrmProjectArchiveUseContextReceipt,
  evaluateStudioVrmLicenseAuthority,
} from "./studio-vrm-license-product-gate";
import {
  hydrateVrmLibraryThumbnailWindow,
  queryUploadedVrmLibraryEntriesPage,
  saveVerifiedVrmBlob,
} from "./vrm-library";

import type { StudioLocalDatabase } from "../studio-local-database";

const opened: StudioLocalDatabase[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.close()));
});

function glb(meta: Record<string, unknown> | null): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" },
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        ...(meta === null ? {} : { meta }),
      },
    },
  }));
  const paddedLength = Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(json, 20);
  return bytes;
}

async function fixture() {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  opened.push(database);
  return {
    repository: createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem: createStudioOpfsMemoryFileSystem(),
    }),
    licenseAuthorityStore: createStudioVrmLicenseAuthorityStore(async () => database),
  };
}

describe("VRM license library product wiring", () => {
  it("persists authority on upload and hydrates it only with the visible catalog window", async () => {
    const options = await fixture();
    const bytes = glb({
      name: "Catalog authority",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    });
    const saved = await saveVerifiedVrmBlob({
      name: "Catalog.vrm",
      blob: new Blob([bytes.buffer], { type: "model/gltf-binary" }),
    }, options);
    expect(saved.licenseAuthority?.status).toBe("verified");

    const page = await queryUploadedVrmLibraryEntriesPage(options);
    expect(page?.items[0]?.licenseAuthority).toBeUndefined();
    const hydrated = await hydrateVrmLibraryThumbnailWindow(page?.items ?? [], options);
    expect(hydrated[0]?.licenseAuthority?.status).toBe("verified");
    expect(evaluateStudioVrmLicenseAuthority(
      hydrated[0]?.licenseAuthority,
      "project-archive-redistribution",
      {
        avatarActorBasis: createStudioVrmProjectArchiveUseContextReceipt({
          confirmedByUser: true,
          avatarPermissionBasis: "other",
          confirmedAttributionTexts: [
            "Catalog authority · Creator · VRM-Public-License-1.0 · https://vrm.dev/licenses/1.0/",
          ],
          excessivelyViolent: "absent",
          excessivelySexual: "absent",
          politicalOrReligious: "absent",
          antisocialOrHate: "absent",
        }).actorIdentity.avatarPermissionBasis,
        containsModifiedModel: false,
        creditProvided: true,
        containsViolentContent: false,
        containsSexualContent: false,
        containsPoliticalOrReligiousContent: false,
        containsAntisocialOrHateContent: false,
      },
    ).decision).toBe("allow");
  });

  it("persists missing metadata as unknown while retaining local-preview access", async () => {
    const options = await fixture();
    const bytes = glb(null);
    const saved = await saveVerifiedVrmBlob({
      name: "Unknown.vrm",
      blob: new Blob([bytes.buffer], { type: "model/gltf-binary" }),
    }, options);
    expect(saved.licenseAuthority?.status).toBe("unknown");

    const page = await queryUploadedVrmLibraryEntriesPage(options);
    const hydrated = await hydrateVrmLibraryThumbnailWindow(page?.items ?? [], options);
    expect(evaluateStudioVrmLicenseAuthority(
      hydrated[0]?.licenseAuthority,
      "local-preview",
    ).decision).toBe("warn");
    expect(evaluateStudioVrmLicenseAuthority(
      hydrated[0]?.licenseAuthority,
      "marketplace-share",
    ).decision).toBe("block");
  });
});
