import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXCEPTION_REVIEW_DEADLINE,
  REVIEWED_REACT_ROUTER_VERSION,
  RSC_ONLY_ADVISORY,
  verifySecurityAdvisoryExceptions,
} from "./verify-security-advisory-exceptions.mjs";

const roots = [];

function write(path, contents) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function createFixture({
  dependency = REVIEWED_REACT_ROUTER_VERSION,
  ignoredGhsas = [RSC_ONLY_ADVISORY],
  runtimeSource = "",
  config = false,
  extraDependency,
  withLockfile = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "toonspectrum-advisory-"));
  roots.push(root);
  const dependencies = {
    "react-router-dom": dependency,
    ...(extraDependency ? { [extraDependency]: "1.0.0" } : {}),
  };
  write(
    join(root, "package.json"),
    JSON.stringify({ dependencies }),
  );
  write(
    join(root, "pnpm-workspace.yaml"),
    `packages:\n  - "."\nauditConfig:\n  ignoreGhsas:\n${ignoredGhsas.map((ghsa) => "    - " + ghsa).join("\n")}\n`,
  );
  if (withLockfile) {
    write(
      join(root, "pnpm-lock.yaml"),
      `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      react-router-dom:\n        specifier: ${dependency}\n        version: ${dependency}(react@19.2.7)\npackages:\n  react-router-dom@${dependency}: {}\n  react-router@${dependency}: {}\n`,
    );
  }
  write(
    join(root, "src", "app", "App.tsx"),
    `import { BrowserRouter } from "react-router-dom";\n${runtimeSource}\nexport function App() { return <BrowserRouter><main /></BrowserRouter>; }\n`,
  );
  write(
    join(root, "src", "app", "main.tsx"),
    'import { createRoot } from "react-dom/client";\ncreateRoot(document.body).render(null);\n',
  );
  write(
    join(root, "src", "app", "routes", "AppRouter.tsx"),
    'import { Route, Routes } from "react-router-dom";\nexport function AppRouter() { return <Routes><Route path="/" element={null} /></Routes>; }\n',
  );
  write(
    join(root, "vite.config.ts"),
    'import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };\n',
  );
  write(
    join(root, "index.html"),
    '<div id="root"></div><script type="module" src="/src/app/main.tsx"></script>\n',
  );
  if (config) {
    write(join(root, "react-router.config.ts"), "export default {};\n");
  }
  return root;
}

function installedPackages(version = REVIEWED_REACT_ROUTER_VERSION) {
  return {
    domPackage: {
      version,
      dependencies: { "react-router": version },
    },
    routerPackage: { version },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("verifySecurityAdvisoryExceptions", () => {
  it("accepts only the reviewed Vite Declarative Mode boundary", () => {
    const result = verifySecurityAdvisoryExceptions({
      root: createFixture(),
      now: new Date("2026-07-31T00:00:00.000Z"),
      installedRouterPackages: installedPackages(),
    });

    expect(result).toMatchObject({
      ignoredGhsas: [RSC_ONLY_ADVISORY],
      mode: "vite-declarative-browser-router",
      reactRouterVersion: REVIEWED_REACT_ROUTER_VERSION,
    });
  });

  it.each([
    ["an extra ignored advisory", { ignoredGhsas: [RSC_ONLY_ADVISORY, "GHSA-xxxx-xxxx-xxxx"] }],
    ["a loose router dependency", { dependency: `^${REVIEWED_REACT_ROUTER_VERSION}` }],
    ["a Framework Mode config", { config: true }],
    ["a Framework package", { extraDependency: "@react-router/dev" }],
    ["a Framework server package", { extraDependency: "@react-router/express" }],
    ["an RSC API", { runtimeSource: "const route = unstable_RSCRouter;" }],
  ])("rejects %s", (_label, options) => {
    expect(() =>
      verifySecurityAdvisoryExceptions({
        root: createFixture(options),
        now: new Date("2026-07-31T00:00:00.000Z"),
        installedRouterPackages: installedPackages(),
      }),
    ).toThrow("Security advisory exception verification failed");
  });

  it("fails closed after the scheduled review deadline", () => {
    expect(() =>
      verifySecurityAdvisoryExceptions({
        root: createFixture(),
        now: new Date(EXCEPTION_REVIEW_DEADLINE),
        installedRouterPackages: installedPackages(),
      }),
    ).toThrow("exception expired");
  });

  it("rejects an installed router pair outside the reviewed version", () => {
    expect(() =>
      verifySecurityAdvisoryExceptions({
        root: createFixture(),
        now: new Date("2026-07-31T00:00:00.000Z"),
        installedRouterPackages: installedPackages("7.18.1"),
      }),
    ).toThrow("Installed react-router-dom is 7.18.1");
  });
});
