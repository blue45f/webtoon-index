import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const target = resolve(root, "apps/web/src/domains/market/components/MarketplaceAuthoringWorkshop.tsx");
const component = resolve(root, "apps/web/src/domains/market/components/MarketplaceBrushRecipeAccelerator.tsx");
if (!existsSync(target) || !existsSync(component)) throw new Error("Brush recipe integration targets are missing.");

function importPath(from, to) {
  let value = relative(dirname(from), to).split(sep).join("/").replace(/\.tsx$/u, "");
  return value.startsWith(".") ? value : `./${value}`;
}

let source = readFileSync(target, "utf8");
const statement = `import { MarketplaceBrushRecipeAccelerator } from "${importPath(target, component)}";`;
if (!source.includes(statement)) source = `${statement}\n${source}`;

if (!source.includes("market-brush-recipe-lab")) {
  const anchor = '<div className="space-y-3" data-testid="market-authoring-engine-list">';
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error("Marketplace brush engine-list anchor changed.");
  source = `${source.slice(0, index)}<MarketplaceBrushRecipeAccelerator\n                  draft={normalized}\n                  onChange={setDraft}\n                />\n\n                ${source.slice(index)}`;
}

writeFileSync(target, source);
writeFileSync(
  resolve(root, "marketplace-brush-recipe-integration-report.json"),
  `${JSON.stringify({ target: relative(root, target), status: "integrated" }, null, 2)}\n`,
);
