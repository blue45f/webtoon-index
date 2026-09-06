import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const target = resolve(root, "apps/web/src/domains/market/components/MarketResourceDetailArticle.tsx");
const component = resolve(root, "apps/web/src/domains/market/components/MarketplaceAuthoringInstallAction.tsx");

if (!existsSync(target) || !existsSync(component)) {
  throw new Error("Marketplace detail integration targets are missing.");
}

function importPath(from, to) {
  let value = relative(dirname(from), to).split(sep).join("/").replace(/\.tsx$/u, "");
  return value.startsWith(".") ? value : `./${value}`;
}

function openingEnd(source, start) {
  let quote = null;
  let braceDepth = 0;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (character === ">" && braceDepth === 0) return index + 1;
  }
  return -1;
}

let source = readFileSync(target, "utf8");
const importStatement = `import { MarketplaceAuthoringInstallAction } from "${importPath(target, component)}";`;
if (!source.includes(importStatement)) source = `${importStatement}\n${source}`;

if (!source.includes("marketplace-authoring-install-action")) {
  const returns = [...source.matchAll(/\breturn\s*\(/gu)];
  let inserted = false;
  for (let matchIndex = returns.length - 1; matchIndex >= 0; matchIndex -= 1) {
    const match = returns[matchIndex];
    let cursor = (match.index ?? 0) + match[0].length;
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (source.startsWith("<>", cursor)) {
      source = `${source.slice(0, cursor + 2)}\n      <MarketplaceAuthoringInstallAction record={record} />\n${source.slice(cursor + 2)}`;
      inserted = true;
      break;
    }
    if (source[cursor] !== "<" || source.startsWith("</", cursor)) continue;
    const end = openingEnd(source, cursor);
    if (end < 0) continue;
    const lineStart = source.lastIndexOf("\n", cursor) + 1;
    const indentation = source.slice(lineStart, cursor).match(/^\s*/u)?.[0] ?? "";
    source = `${source.slice(0, end)}\n${indentation}  <MarketplaceAuthoringInstallAction record={record} />\n${source.slice(end)}`;
    inserted = true;
    break;
  }
  if (!inserted) throw new Error("Could not insert MarketplaceAuthoringInstallAction.");
}

writeFileSync(target, source);
writeFileSync(
  resolve(root, "marketplace-authoring-detail-integration-report.json"),
  `${JSON.stringify({ target: relative(root, target), status: "integrated" }, null, 2)}\n`,
);
