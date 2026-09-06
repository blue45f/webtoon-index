#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, runInNewContext } from "node:vm";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const productionSupabaseOrigin = "https://ybsgfhofuvkhywbpytnl.supabase.co";

function directive(csp, name) {
  return csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `)) ?? "";
}

function rootCsp(vercelConfig) {
  const root = vercelConfig.headers?.find((entry) => entry.source === "/(.*)");
  return root?.headers?.find((header) => header.key === "Content-Security-Policy")?.value;
}

function scriptHash(source) {
  return `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
}

function scanTagEnd(source, start) {
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  throw new Error("HTML contains an unterminated tag.");
}

function parseHtmlAttributes(source) { // NOSONAR javascript:S3776
  const attributes = new Map();
  let index = 0;
  while (index < source.length) {
    while (/\s/u.test(source[index] ?? "")) index += 1;
    if (index >= source.length || source[index] === "/") break;

    const nameStart = index;
    while (index < source.length && !/[\s=/>]/u.test(source[index] ?? "")) {
      index += 1;
    }
    if (index === nameStart) throw new Error("HTML contains an invalid attribute.");
    const name = source.slice(nameStart, index).toLowerCase();
    if (attributes.has(name)) throw new Error(`HTML repeats the ${name} attribute.`);
    while (/\s/u.test(source[index] ?? "")) index += 1;

    let value = null;
    if (source[index] === "=") {
      index += 1;
      while (/\s/u.test(source[index] ?? "")) index += 1;
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        if (index >= source.length) throw new Error(`HTML attribute ${name} is unterminated.`);
        value = source.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !/[\s>]/u.test(source[index] ?? "")) index += 1;
        if (index === valueStart) throw new Error(`HTML attribute ${name} has no value.`);
        value = source.slice(valueStart, index);
      }
    }
    attributes.set(name, value);
  }
  return attributes;
}

function inspectHtmlScripts(html) { // NOSONAR javascript:S3776
  const uncommented = html.replace(/<!--[\s\S]*?-->/gu, (comment) => " ".repeat(comment.length));
  const lower = uncommented.toLowerCase();
  const scripts = [];
  const headOpenEnds = [];
  const headCloseStarts = [];
  let index = 0;

  while (index < uncommented.length) {
    const tagStart = uncommented.indexOf("<", index);
    if (tagStart < 0) break;
    const tagEnd = scanTagEnd(uncommented, tagStart + 1);
    const tagBody = uncommented.slice(tagStart + 1, tagEnd);
    const tagMatch = /^\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/u.exec(tagBody);
    if (!tagMatch?.[2]) {
      index = tagEnd + 1;
      continue;
    }

    const closing = tagMatch[1] === "/";
    const name = tagMatch[2].toLowerCase();
    if (name === "head") {
      if (closing) headCloseStarts.push(tagStart);
      else headOpenEnds.push(tagEnd + 1);
    }
    if (name !== "script" || closing) {
      index = tagEnd + 1;
      continue;
    }

    const attributesStart = tagMatch[0].length;
    const attributes = parseHtmlAttributes(tagBody.slice(attributesStart));
    const closingStart = lower.indexOf("</script", tagEnd + 1);
    if (closingStart < 0) throw new Error("HTML contains an unterminated script element.");
    const closingEnd = scanTagEnd(uncommented, closingStart + 2);
    scripts.push({
      start: tagStart,
      end: closingEnd + 1,
      attributes,
      content: uncommented.slice(tagEnd + 1, closingStart),
    });
    index = closingEnd + 1;
  }

  if (headOpenEnds.length !== 1 || headCloseStarts.length !== 1) {
    throw new Error("HTML must contain exactly one head element.");
  }
  return {
    scripts,
    headOpenEnd: headOpenEnds[0],
    headCloseStart: headCloseStarts[0],
  };
}

function maskJavaScriptCommentsAndStrings(source) { // NOSONAR javascript:S3776
  let masked = "";
  let state = "code";
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (character === "\n" || character === "\r") {
        state = "code";
        masked += character;
      } else masked += " ";
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        masked += "  ";
        index += 1; // NOSONAR javascript:S2310
        state = "code";
      } else masked += character === "\n" || character === "\r" ? character : " ";
      continue;
    }
    if (state === "string") {
      if (character === "\\") {
        masked += "  ";
        index += 1; // NOSONAR javascript:S2310
      } else if (character === quote) {
        masked += " ";
        state = "code";
        quote = null;
      } else masked += character === "\n" || character === "\r" ? character : " ";
      continue;
    }
    if (character === "/" && next === "/") {
      masked += "  ";
      index += 1; // NOSONAR javascript:S2310
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      masked += "  ";
      index += 1; // NOSONAR javascript:S2310
      state = "block-comment";
    } else if (character === '"' || character === "'") {
      masked += " ";
      state = "string";
      quote = character;
    } else if (character === "`") {
      throw new Error("bootstrap-compat.js must remain ES5-compatible (template literal found).");
    } else masked += character;
  }
  if (state === "block-comment" || state === "string") {
    throw new Error("bootstrap-compat.js contains unterminated JavaScript syntax.");
  }
  return masked;
}

function verifyLegacyBootstrapSyntax(source) {
  try {
    // Parse once with the current engine, then enforce the intentionally tiny
    // ES5 subset used by this untranspiled compatibility bootstrap.
    new Script(source);
  } catch (error) {
    throw new Error(`bootstrap-compat.js is not valid JavaScript: ${String(error)}`, {
      cause: error,
    });
  }
  const masked = maskJavaScriptCommentsAndStrings(source);
  const forbidden = [
    { pattern: /,\s*\)/u, label: "trailing function-call comma" },
    { pattern: /=>|\.\.\.|\?\.|\?\?|\*\*/u, label: "post-ES5 operator" },
    {
      pattern: /(^|[^\w$])(let|const|class|async|await|import|export)(?=$|[^\w$])/u,
      label: "post-ES5 keyword",
    },
    { pattern: /\bfunction\b[^()]*\([^)]*=/u, label: "default parameter" },
    { pattern: /\b(?:var|for)\s*[\[{]/u, label: "destructuring" },
  ];
  const violation = forbidden.find(({ pattern }) => pattern.test(masked));
  if (violation) {
    throw new Error(`bootstrap-compat.js must remain ES5-compatible (${violation.label}).`);
  }
}

function verifyBootstrapBehavior(source) {
  const originalConfig = Object.assign(Object.create(null), { preserved: "yes" });
  const sandbox = {
    __zod_globalConfig: originalConfig,
    document: {
      createElement(tagName) {
        if (String(tagName).toLowerCase() !== "script") {
          throw new Error("compatibility bootstrap created an unexpected element");
        }
        return { noModule: false };
      },
    },
    Promise,
    Symbol,
    WebAssembly,
    fetch() {},
  };
  sandbox.window = sandbox;
  try {
    runInNewContext(source, sandbox, { timeout: 1_000 });
  } catch (error) {
    throw new Error(`bootstrap-compat.js behavior check failed: ${String(error)}`, {
      cause: error,
    });
  }
  if (
    sandbox.__zod_globalConfig !== originalConfig ||
    originalConfig.preserved !== "yes" ||
    originalConfig.jitless !== true
  ) {
    throw new Error(
      "bootstrap-compat.js must preserve the Zod config object and enable jitless before modules.",
    );
  }
}

export function verifyVercelCspContract({ html, vercelConfig, bootstrapCompatSource }) { // NOSONAR javascript:S3776
  const csp = rootCsp(vercelConfig);
  if (typeof csp !== "string" || csp.length === 0) {
    throw new Error("Vercel root Content-Security-Policy is missing.");
  }

  const scripts = directive(csp, "script-src");
  const scriptTokens = scripts.split(/\s+/u).slice(1);
  if (scriptTokens.includes("'unsafe-inline'")) {
    throw new Error("script-src must not contain unsafe-inline.");
  }
  if (scriptTokens.includes("'unsafe-eval'")) {
    throw new Error("script-src must not contain unsafe-eval.");
  }

  const inspected = inspectHtmlScripts(html);
  const bootstrapScripts = inspected.scripts.filter(
    ({ attributes }) => attributes.get("src") === "/bootstrap-compat.js",
  );
  const moduleScripts = inspected.scripts.filter(
    ({ attributes }) => attributes.get("type")?.trim().toLowerCase() === "module",
  );
  const bootstrap = bootstrapScripts[0];
  const firstModule = moduleScripts[0];
  if (
    bootstrapScripts.length !== 1 ||
    !bootstrap ||
    !firstModule ||
    bootstrap.start < inspected.headOpenEnd ||
    bootstrap.start >= inspected.headCloseStart ||
    bootstrap.start >= firstModule.start ||
    bootstrap.attributes.has("async") ||
    bootstrap.attributes.has("defer") ||
    bootstrap.attributes.has("type") ||
    bootstrap.attributes.has("nomodule") ||
    bootstrap.content.trim().length !== 0
  ) {
    throw new Error(
      "bootstrap-compat.js must be one parser-blocking classic head script before the production module graph.",
    );
  }
  if (typeof bootstrapCompatSource !== "string" || bootstrapCompatSource.length === 0) {
    throw new Error(
      "bootstrap-compat.js source is missing.",
    );
  }
  verifyLegacyBootstrapSyntax(bootstrapCompatSource);
  verifyBootstrapBehavior(bootstrapCompatSource);

  const inlineScripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gu)]
    .filter((match) => !/\bsrc=/u.test(match[1] ?? ""));
  for (const match of inlineScripts) {
    const attributes = match[1] ?? "";
    if (!/\btype=["']application\/ld\+json["']/u.test(attributes)) {
      throw new Error("Executable inline script found in built HTML.");
    }
    const hash = scriptHash(match[2] ?? "");
    if (!scriptTokens.includes(hash)) {
      throw new Error(`Inline JSON-LD hash is absent from script-src: ${hash}`);
    }
  }

  const connections = directive(csp, "connect-src").split(/\s+/u);
  if (connections.includes("https:") || connections.includes("wss:")) {
    throw new Error("connect-src contains an unrestricted network scheme.");
  }
  const blobConnectionCount = connections.filter((source) => source === "blob:").length;
  if (!connections.includes("'self'") || blobConnectionCount !== 1) {
    throw new Error(
      "connect-src must contain 'self' and exactly one blob: source for verified Studio asset object URLs.",
    );
  }
  if (!connections.includes("https://realtime.toonstudio.cloud")
    || !connections.includes("wss://realtime.toonstudio.cloud")) {
    throw new Error("The exact production realtime origins are missing from connect-src.");
  }
  const supabaseOrigins = connections.filter((origin) =>
    origin.includes("supabase.co"));
  if (supabaseOrigins.length !== 1 || supabaseOrigins[0] !== productionSupabaseOrigin) {
    throw new Error("connect-src must contain only the exact production Supabase origin.");
  }

  const workers = directive(csp, "worker-src").split(/\s+/u).filter(Boolean);
  const workerTokens = workers.slice(1);
  if (
    workers[0] !== "worker-src" ||
    workerTokens.length !== 2 ||
    !workerTokens.includes("'self'") ||
    !workerTokens.includes("blob:")
  ) {
    throw new Error("worker-src must be exactly 'self' blob: for product module Workers.");
  }

  return Object.freeze({ inlineScriptCount: inlineScripts.length, csp });
}

function main() {
  const htmlPath = resolve(repositoryRoot, process.argv[2] ?? "index.html");
  const vercelPath = resolve(repositoryRoot, "vercel.json");
  const builtBootstrapPath = resolve(dirname(htmlPath), "bootstrap-compat.js");
  const sourceBootstrapPath = resolve(repositoryRoot, "apps/web/public/bootstrap-compat.js");
  const bootstrapCompatPath = existsSync(builtBootstrapPath)
    ? builtBootstrapPath
    : sourceBootstrapPath;
  const result = verifyVercelCspContract({
    html: readFileSync(htmlPath, "utf8"),
    vercelConfig: JSON.parse(readFileSync(vercelPath, "utf8")),
    bootstrapCompatSource: readFileSync(bootstrapCompatPath, "utf8"),
  });
  console.log(
    `Verified Vercel CSP for ${htmlPath}: ${result.inlineScriptCount} hashed inline data block(s).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
