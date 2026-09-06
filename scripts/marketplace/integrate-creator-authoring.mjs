import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function relativeImport(fromFile, toFile) {
  let value = relative(dirname(fromFile), toFile).split(sep).join("/");
  value = value.replace(/\.(?:tsx?|jsx?)$/u, "");
  return value.startsWith(".") ? value : `./${value}`;
}

function addImport(source, statement) {
  if (source.includes(statement)) return source;
  const directive = source.match(/^(?:\s*["'][^"']+["'];\s*)+/u)?.[0] ?? "";
  return `${directive}${statement}\n${source.slice(directive.length)}`;
}

function insertAfterUnique(source, anchor, insertion, presentNeedle, label) {
  if (source.includes(presentNeedle)) return source;
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(anchor, `${anchor}\n${insertion}`);
}

function replaceUnique(source, anchor, replacement, label) {
  if (source.includes(replacement)) return source;
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(anchor, replacement);
}

function integratePublishPage() {
  const page = resolve(root, "apps/web/src/domains/market/pages/MarketPublishPage.tsx");
  const workshop = resolve(root, "apps/web/src/domains/market/components/MarketplaceAuthoringWorkshop.tsx");
  invariant(existsSync(page), "MarketPublishPage.tsx is missing");
  invariant(existsSync(workshop), "MarketplaceAuthoringWorkshop.tsx is missing");

  const before = readFileSync(page, "utf8");
  let after = addImport(
    before,
    `import { MarketplaceAuthoringWorkshop } from "${relativeImport(page, workshop)}";`,
  );
  after = replaceUnique(
    after,
    '  const [fallbackUserId] = useState(() => "user-guest");',
    '  const fallbackUserId = "user-guest";',
    "stable guest publisher id",
  );
  after = insertAfterUnique(
    after,
    "      <MarketNavHeader />",
    "      {/* marketplace-authoring-workshop */}\n      <MarketplaceAuthoringWorkshop />",
    "<MarketplaceAuthoringWorkshop />",
    "Marketplace publish workshop",
  );
  if (after !== before) writeFileSync(page, after);
  return { path: relative(root, page), changed: after !== before };
}

function integrateBrushStudio() {
  const studio = resolve(root, "apps/web/src/domains/creator/brush/StudioBrushStudio.tsx");
  const bridge = resolve(root, "apps/web/src/domains/creator/MarketplaceBrushStudioBridge.tsx");
  invariant(existsSync(studio), "StudioBrushStudio.tsx is missing");
  invariant(existsSync(bridge), "MarketplaceBrushStudioBridge.tsx is missing");

  const before = readFileSync(studio, "utf8");
  let after = addImport(
    before,
    `import { MarketplaceBrushStudioBridge } from "${relativeImport(studio, bridge)}";`,
  );
  after = insertAfterUnique(
    after,
    "      {typeof document === \"undefined\" || !modal ? modal : createPortal(modal, document.body)}",
    "      {/* brush-studio-marketplace-shortcut */}\n      <MarketplaceBrushStudioBridge snapshot={currentSnapshot} visible={open} />",
    "<MarketplaceBrushStudioBridge snapshot={currentSnapshot} visible={open} />",
    "Brush Studio marketplace bridge",
  );
  if (after !== before) writeFileSync(studio, after);
  return { path: relative(root, studio), changed: after !== before };
}

const publish = integratePublishPage();
const brush = integrateBrushStudio();
const report = { publish, brush };
writeFileSync(
  resolve(root, "marketplace-authoring-integration-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
