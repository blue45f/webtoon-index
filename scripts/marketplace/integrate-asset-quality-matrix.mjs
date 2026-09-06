import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const target = resolve(root, "apps/web/src/domains/market/components/MarketplaceAuthoringWorkshop.tsx");
const component = resolve(root, "apps/web/src/domains/market/components/MarketplaceAssetQualityMatrix.tsx");

if (!existsSync(target) || !existsSync(component)) {
  throw new Error("Asset quality matrix integration targets are missing.");
}

function importPath(from, to) {
  let value = relative(dirname(from), to).split(sep).join("/").replace(/\.tsx$/u, "");
  return value.startsWith(".") ? value : `./${value}`;
}

let source = readFileSync(target, "utf8");
const statement = `import { MarketplaceAssetQualityMatrix } from "${importPath(target, component)}";`;
if (!source.includes(statement)) source = `${statement}\n${source}`;

if (!source.includes("<MarketplaceAssetQualityMatrix")) {
  const previewPanel = 'id="market-authoring-panel-preview"';
  const panelIndex = source.indexOf(previewPanel);
  if (panelIndex < 0) throw new Error("Marketplace preview panel anchor changed.");

  const gridAnchor = '<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">';
  const insertIndex = source.indexOf(gridAnchor, panelIndex);
  if (insertIndex < 0) throw new Error("Marketplace preview scenario grid anchor changed.");

  const jsx = [
    "<MarketplaceAssetQualityMatrix",
    "              draft={normalized}",
    "              onChange={setDraft}",
    "            />",
    "            ",
  ].join("\n");
  source = `${source.slice(0, insertIndex)}${jsx}${source.slice(insertIndex)}`;
}

writeFileSync(target, source);
writeFileSync(
  resolve(root, "marketplace-asset-quality-integration-report.json"),
  `${JSON.stringify({ target: relative(root, target), status: "integrated" }, null, 2)}\n`,
);
