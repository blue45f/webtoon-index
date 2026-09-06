import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseStudioVrmBlenderCharacterPackage,
  selectStudioVrmBlenderRuntimeAsset,
} from "../apps/web/src/domains/creator/vrm/studio-vrm-blender-character-package";

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function sha256(file: string): Promise<string> {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((entry, index) => !(index === 0 && entry === "--"));
  if (args.includes("--help")) {
    console.log("pnpm exec tsx scripts/import-blender-character-package.mts --package <character-package.json> [--destination batch_source/blender] [--prefer vrm|glb] [--dry-run]");
    return;
  }
  const manifestPath = path.resolve(option(args, "--package") ?? "");
  if (!manifestPath || manifestPath === path.resolve("")) throw new Error("--package is required");
  const packageDir = path.dirname(manifestPath);
  const parsed = parseStudioVrmBlenderCharacterPackage(JSON.parse(await readFile(manifestPath, "utf8")));
  const preferValue = option(args, "--prefer");
  if (preferValue && preferValue !== "vrm" && preferValue !== "glb") {
    throw new Error("--prefer must be vrm or glb");
  }
  const prefer = preferValue as "vrm" | "glb" | undefined;
  const selected = selectStudioVrmBlenderRuntimeAsset(parsed, { prefer });
  const source = path.resolve(packageDir, selected.file.path);
  if (!source.startsWith(`${packageDir}${path.sep}`)) throw new Error("selected runtime asset escaped the package directory");
  const actual = await sha256(source);
  if (actual !== selected.file.sha256) throw new Error(`SHA-256 mismatch for ${selected.file.path}`);
  const destination = path.resolve(option(args, "--destination") ?? "batch_source/blender");
  const targetDir = path.join(destination, parsed.characterId);
  const targetAsset = path.join(targetDir, path.basename(selected.file.path));
  const receipt = {
    schemaVersion: 1,
    type: selected.role,
    characterId: parsed.characterId,
    displayName: parsed.displayName,
    sourceManifest: manifestPath,
    quality: parsed.quality,
    capabilities: parsed.capabilities,
    asset: path.basename(targetAsset),
    sha256: actual,
    provenance: parsed.provenance,
  };
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ destination: targetAsset, receipt }, null, 2));
    return;
  }
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, targetAsset);
  await copyFile(manifestPath, path.join(targetDir, "character-package.json"));
  const thumbnail = parsed.files.thumbnail;
  if (thumbnail) {
    const thumbnailSource = path.resolve(packageDir, thumbnail.path);
    if (await sha256(thumbnailSource) !== thumbnail.sha256) throw new Error("thumbnail SHA-256 mismatch");
    await copyFile(thumbnailSource, path.join(targetDir, path.basename(thumbnail.path)));
  }
  await writeFile(path.join(targetDir, "toonstudio-character.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`Imported ${parsed.displayName} into ${targetDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
