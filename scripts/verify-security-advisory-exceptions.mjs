#!/usr/bin/env node

import { createRequire } from "node:module";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

export const REVIEWED_REACT_ROUTER_VERSION = "7.18.2";
export const RSC_ONLY_ADVISORY = "GHSA-qwww-vcr4-c8h2";
export const EXCEPTION_REVIEW_DEADLINE = "2026-10-31T00:00:00.000Z";

const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const RUNTIME_SOURCE_ROOTS = Object.freeze([
  "src",
  "components",
  "lib",
  join("apps", "api", "src"),
]);
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const FORBIDDEN_PACKAGE_NAMES = Object.freeze([
  "@react-router/dev",
  "@react-router/fs-routes",
  "@react-router/node",
  "@react-router/serve",
  "@react-router/cloudflare",
  "@react-router/express",
]);
const FORBIDDEN_RESOLVED_PACKAGE_NAMES = Object.freeze([
  ...FORBIDDEN_PACKAGE_NAMES,
  "react-server-dom-parcel",
  "react-server-dom-turbopack",
  "react-server-dom-webpack",
]);
const FORBIDDEN_RUNTIME_PATTERNS = Object.freeze([
  {
    label: "React Router Framework/RSC entry point",
    pattern:
      /(?:from\s+|import\s*\(\s*)["'](?:@react-router\/(?:dev|fs-routes|node|serve|cloudflare|express)|react-router\/(?:dom|rsc|react-server))["']/u,
  },
  {
    label: "React Router unstable RSC API",
    pattern:
      /\b(?:unstable_)?(?:RSCRouter|RSCStaticRouter|ServerRouter|routeRSCServerRequest|matchRSCServerRequest|createCallServer)\b/u,
  },
  {
    label: "React Server Components runtime",
    pattern:
      /(?:["']react-server-dom-(?:parcel|turbopack|webpack)["']|virtual:react-router\/unstable_rsc|\b(?:renderToPipeableStream|renderToReadableStream|hydrateRoot)\b)/u,
  },
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listRuntimeSourceFiles(root) { // NOSONAR javascript:S3776
  const files = [];

  function visit(path) {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    if (stat.isFile()) {
      const name = path.split("/").at(-1) ?? path;
      if (
        SOURCE_EXTENSIONS.has(extname(path))
        && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(name)
      ) {
        files.push(path);
      }
      return;
    }

    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (
        entry.name === "node_modules"
        || entry.name === "dist"
        || entry.name === "coverage"
      ) {
        continue;
      }
      visit(join(path, entry.name));
    }
  }

  for (const relativeRoot of RUNTIME_SOURCE_ROOTS) {
    visit(join(root, relativeRoot));
  }
  return files.sort();
}

function listWorkspacePackageJsonPaths(root) {
  const paths = [join(root, "package.json")];
  for (const workspaceRoot of ["apps", "packages"]) {
    const directory = join(root, workspaceRoot);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name, "package.json");
      if (existsSync(path)) paths.push(path);
    }
  }
  return paths.sort();
}

function collectDeclaredPackages(packageJson) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ]);
}

function resolveInstalledRouterPackages(root) {
  const rootRequire = createRequire(join(root, "package.json"));
  const domPackagePath = rootRequire.resolve("react-router-dom/package.json");
  const domPackage = readJson(domPackagePath);
  const domRequire = createRequire(domPackagePath);
  const routerPackagePath = domRequire.resolve("react-router/package.json");
  return {
    domPackage,
    routerPackage: readJson(routerPackagePath),
  };
}

export function verifySecurityAdvisoryExceptions({ // NOSONAR javascript:S3776
  root = REPOSITORY_ROOT,
  now = new Date(),
  installedRouterPackages,
} = {}) {
  const errors = [];
  const packageJson = readJson(join(root, "package.json"));
  const workspace = parseYaml(
    readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
  );
  const lockfilePath = join(root, "pnpm-lock.yaml");
  const lockfile = existsSync(lockfilePath)
    ? parseYaml(readFileSync(lockfilePath, "utf8"))
    : undefined;
  const ignoredGhsas = workspace?.auditConfig?.ignoreGhsas;

  if (
    !Array.isArray(ignoredGhsas)
    || ignoredGhsas.length !== 1
    || ignoredGhsas[0] !== RSC_ONLY_ADVISORY
  ) {
    errors.push(
      `auditConfig.ignoreGhsas must contain only ${RSC_ONLY_ADVISORY}.`,
    );
  }

  if (lockfile) {
    const importer = lockfile.importers?.["."];
    const lockedDom = importer?.dependencies?.["react-router-dom"];
    if (
      lockedDom?.specifier !== REVIEWED_REACT_ROUTER_VERSION
      || !String(lockedDom?.version ?? "").startsWith(
        REVIEWED_REACT_ROUTER_VERSION,
      )
    ) {
      errors.push(
        `pnpm-lock.yaml must resolve the root react-router-dom importer to ${REVIEWED_REACT_ROUTER_VERSION}.`,
      );
    }

    for (const packageKey of Object.keys(lockfile.packages ?? {})) {
      const normalizedKey = packageKey.replace(/^[/"']+/u, "");
      for (const packageName of FORBIDDEN_RESOLVED_PACKAGE_NAMES) {
        if (
          normalizedKey === packageName
          || normalizedKey.startsWith(`${packageName}@`)
        ) {
          errors.push(
            `pnpm-lock.yaml resolves forbidden Framework/RSC package ${packageName}.`,
          );
        }
      }
    }
  }

  if (
    packageJson.dependencies?.["react-router-dom"]
    !== REVIEWED_REACT_ROUTER_VERSION
  ) {
    errors.push(
      `react-router-dom must stay exactly pinned to ${REVIEWED_REACT_ROUTER_VERSION} while the RSC-only exception exists.`,
    );
  }

  if (now.getTime() >= Date.parse(EXCEPTION_REVIEW_DEADLINE)) {
    errors.push(
      `The ${RSC_ONLY_ADVISORY} exception expired at ${EXCEPTION_REVIEW_DEADLINE}; review React Router's patched releases and remove or renew the exception.`,
    );
  }

  for (const packageJsonPath of listWorkspacePackageJsonPaths(root)) {
    const declared = collectDeclaredPackages(readJson(packageJsonPath));
    for (const packageName of FORBIDDEN_PACKAGE_NAMES) {
      if (declared.has(packageName)) {
        errors.push(
          `${packageJsonPath} declares forbidden Framework/RSC package ${packageName}.`,
        );
      }
    }
  }

  for (const configName of [
    "react-router.config.js",
    "react-router.config.mjs",
    "react-router.config.cjs",
    "react-router.config.ts",
    "react-router.config.mts",
    "react-router.config.cts",
  ]) {
    if (existsSync(join(root, configName))) {
      errors.push(
        `${configName} enables React Router Framework Mode and invalidates the RSC-only exception.`,
      );
    }
  }

  const runtimeSourceFiles = listRuntimeSourceFiles(root);
  for (const sourcePath of runtimeSourceFiles) {
    const sourceName = sourcePath.split("/").at(-1) ?? sourcePath;
    if (/^entry\.(?:rsc|server|ssr)\.[cm]?[jt]sx?$/u.test(sourceName)) {
      errors.push(
        `${sourcePath} is a Framework/RSC server entry and invalidates the exception.`,
      );
    }
    const source = readFileSync(sourcePath, "utf8");
    for (const { label, pattern } of FORBIDDEN_RUNTIME_PATTERNS) {
      if (pattern.test(source)) {
        errors.push(`${sourcePath} contains ${label}.`);
      }
    }
  }

  const appSourcePath = join(root, "src", "app", "App.tsx");
  const appSource = existsSync(appSourcePath)
    ? readFileSync(appSourcePath, "utf8")
    : "";
  if (
    !/import\s*\{[^}]*\bBrowserRouter\b[^}]*\}\s*from\s*["']react-router-dom["']/su.test(
      appSource,
    )
    || !/<BrowserRouter(?:\s|>)/u.test(appSource)
  ) {
    errors.push(
      "apps/web/src/app/App.tsx must retain the reviewed BrowserRouter Declarative Mode boundary.",
    );
  }

  const mainSourcePath = join(root, "src", "app", "main.tsx");
  const mainSource = existsSync(mainSourcePath)
    ? readFileSync(mainSourcePath, "utf8")
    : "";
  if (!/\bcreateRoot\s*\(/u.test(mainSource)) {
    errors.push(
      "apps/web/src/app/main.tsx must retain the reviewed client-only createRoot entry.",
    );
  }

  const appRouterSourcePath = join(root, "src", "app", "routes", "AppRouter.tsx");
  const appRouterSource = existsSync(appRouterSourcePath)
    ? readFileSync(appRouterSourcePath, "utf8")
    : "";
  if (
    !/\bRoutes\b/u.test(appRouterSource)
    || !/\bRoute\b/u.test(appRouterSource)
  ) {
    errors.push(
      "apps/web/src/app/routes/AppRouter.tsx must retain the reviewed declarative Routes/Route boundary.",
    );
  }

  const indexSourcePath = join(root, "index.html");
  const indexSource = existsSync(indexSourcePath)
    ? readFileSync(indexSourcePath, "utf8")
    : "";
  if (
    !/<script\s+type=["']module["']\s+src=["']\/src\/app\/main\.tsx["']\s*><\/script>/u.test(
      indexSource,
    )
  ) {
    errors.push(
      "index.html must retain /src/app/main.tsx as its client module entry.",
    );
  }

  const viteSourcePath = join(root, "vite.config.ts");
  const viteSource = existsSync(viteSourcePath)
    ? readFileSync(viteSourcePath, "utf8")
    : "";
  if (
    !/["']@vitejs\/plugin-react["']/u.test(viteSource)
    || /["']@react-router\/dev\/vite["']/u.test(viteSource)
  ) {
    errors.push(
      "vite.config.ts must use @vitejs/plugin-react without the React Router Framework plugin.",
    );
  }

  const resolvedPackages =
    installedRouterPackages ?? resolveInstalledRouterPackages(root);
  if (resolvedPackages.domPackage.version !== REVIEWED_REACT_ROUTER_VERSION) {
    errors.push(
      `Installed react-router-dom is ${resolvedPackages.domPackage.version}; expected ${REVIEWED_REACT_ROUTER_VERSION}.`,
    );
  }
  if (resolvedPackages.routerPackage.version !== REVIEWED_REACT_ROUTER_VERSION) {
    errors.push(
      `Installed react-router is ${resolvedPackages.routerPackage.version}; expected ${REVIEWED_REACT_ROUTER_VERSION}.`,
    );
  }
  if (
    resolvedPackages.domPackage.dependencies?.["react-router"]
    !== REVIEWED_REACT_ROUTER_VERSION
  ) {
    errors.push(
      `react-router-dom must depend exactly on react-router ${REVIEWED_REACT_ROUTER_VERSION}.`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Security advisory exception verification failed:\n- ${errors.join("\n- ")}`,
    );
  }

  return Object.freeze({
    ignoredGhsas: Object.freeze([...ignoredGhsas]),
    mode: "vite-declarative-browser-router",
    reactRouterVersion: REVIEWED_REACT_ROUTER_VERSION,
    reviewDeadline: EXCEPTION_REVIEW_DEADLINE,
  });
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = verifySecurityAdvisoryExceptions();
  process.stdout.write(
    `Verified ${result.ignoredGhsas.join(", ")} as a time-bounded ${result.mode} exception for React Router ${result.reactRouterVersion}.\n`,
  );
}
