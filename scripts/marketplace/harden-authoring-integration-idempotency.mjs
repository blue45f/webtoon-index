import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function keepSingle(relativePath, pattern, label, normalize) {
  const path = resolve(root, relativePath);
  const before = readFileSync(path, "utf8");
  const matches = [...before.matchAll(pattern)];
  if (matches.length === 0) throw new Error(`${label}: integration is missing`);
  let seen = false;
  let removed = 0;
  const deduplicated = before.replace(pattern, (match) => {
    if (!seen) {
      seen = true;
      return match;
    }
    removed += 1;
    return "";
  });
  const after = normalize(deduplicated);
  if (after !== before) writeFileSync(path, after);
  return { path: relativePath, duplicateInsertionsRemoved: removed };
}

const report = [
  keepSingle(
    "apps/web/src/domains/market/pages/MarketPublishPage.tsx",
    /\s*\{\/\* marketplace-authoring-workshop \*\/\}\s*<MarketplaceAuthoringWorkshop\s*\/>/gu,
    "MarketplaceAuthoringWorkshop",
    (source) => source.replace(
      /\s*\{\/\* marketplace-authoring-workshop \*\/\}\s*<MarketplaceAuthoringWorkshop\s*\/>/u,
      "\n      {/* marketplace-authoring-workshop */}\n      <MarketplaceAuthoringWorkshop />",
    ),
  ),
  keepSingle(
    "apps/web/src/domains/creator/brush/StudioBrushStudio.tsx",
    /\s*\{\/\* brush-studio-marketplace-shortcut \*\/\}\s*<MarketplaceBrushStudioBridge\s+snapshot=\{currentSnapshot\}\s+visible=\{open\}\s*\/>/gu,
    "MarketplaceBrushStudioBridge",
    (source) => source.replace(
      /\s*\{\/\* brush-studio-marketplace-shortcut \*\/\}\s*<MarketplaceBrushStudioBridge\s+snapshot=\{currentSnapshot\}\s+visible=\{open\}\s*\/>/u,
      "\n      {/* brush-studio-marketplace-shortcut */}\n      <MarketplaceBrushStudioBridge snapshot={currentSnapshot} visible={open} />",
    ),
  ),
  keepSingle(
    "apps/web/src/domains/market/components/MarketResourceDetailArticle.tsx",
    /\s*<MarketplaceAuthoringInstallAction\s+record=\{record\}\s*\/>/gu,
    "MarketplaceAuthoringInstallAction",
    (source) => source.replace(
      /\s*<MarketplaceAuthoringInstallAction\s+record=\{record\}\s*\/>/u,
      "\n      <MarketplaceAuthoringInstallAction record={record} />",
    ),
  ),
  keepSingle(
    "apps/web/src/domains/market/components/MarketplaceAuthoringWorkshop.tsx",
    /\s*<MarketplaceBrushRecipeAccelerator\s+draft=\{normalized\}\s+onChange=\{setDraft\}\s*\/>/gu,
    "MarketplaceBrushRecipeAccelerator",
    (source) => source.replace(
      /\s*<MarketplaceBrushRecipeAccelerator\s+draft=\{normalized\}\s+onChange=\{setDraft\}\s*\/>/u,
      "\n                <MarketplaceBrushRecipeAccelerator\n                  draft={normalized}\n                  onChange={setDraft}\n                />",
    ),
  ),
  keepSingle(
    "apps/web/src/domains/market/components/MarketplaceAuthoringWorkshop.tsx",
    /\s*<MarketplaceAssetQualityMatrix\s+draft=\{normalized\}\s+onChange=\{setDraft\}\s*\/>/gu,
    "MarketplaceAssetQualityMatrix",
    (source) => source.replace(
      /\s*<MarketplaceAssetQualityMatrix\s+draft=\{normalized\}\s+onChange=\{setDraft\}\s*\/>/u,
      "\n            <MarketplaceAssetQualityMatrix\n              draft={normalized}\n              onChange={setDraft}\n            />",
    ),
  ),
];

writeFileSync(
  resolve(root, "marketplace-authoring-idempotency-report.json"),
  `${JSON.stringify({ status: "hardened", files: report }, null, 2)}\n`,
);
