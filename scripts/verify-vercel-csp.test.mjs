import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { verifyVercelCspContract } from "./verify-vercel-csp.mjs";

const ROOT = new URL("../", import.meta.url);

function fixture() {
  return {
    html: readFileSync(fileURLToPath(new URL("index.html", ROOT)), "utf8"),
    vercelConfig: JSON.parse(
      readFileSync(fileURLToPath(new URL("vercel.json", ROOT)), "utf8"),
    ),
    bootstrapCompatSource: readFileSync(
      fileURLToPath(new URL("apps/web/public/bootstrap-compat.js", ROOT)),
      "utf8",
    ),
  };
}

function createCompatDom({ rootPresent = false, moduleSupported = true } = {}) { // NOSONAR javascript:S3776
  let root = rootPresent ? createRoot() : null;
  const listeners = [];
  let createdElementCount = 0;

  function createNode(tagName) {
    const node = {
      tagName: tagName.toUpperCase(),
      style: { cssText: "" },
      textContent: "",
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
    };
    if (moduleSupported && node.tagName === "SCRIPT") node.noModule = false;
    return node;
  }

  function createRoot() {
    const node = createNode("div");
    Object.defineProperty(node, "firstChild", {
      get() {
        return this.children[0] ?? null;
      },
    });
    node.removeChild = function removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      return child;
    };
    return node;
  }

  const document = {
    createElement(tagName) {
      createdElementCount += 1;
      return createNode(tagName);
    },
    getElementById(id) {
      return id === "root" ? root : null;
    },
    addEventListener(type, listener) {
      listeners.push({ type, listener });
    },
    removeEventListener(type, listener) {
      const index = listeners.findIndex(
        (entry) => entry.type === type && entry.listener === listener,
      );
      if (index >= 0) listeners.splice(index, 1);
    },
  };

  return {
    document,
    dispatch(type) {
      for (const entry of listeners.slice()) {
        if (entry.type === type) entry.listener();
      }
    },
    getCreatedElementCount() {
      return createdElementCount;
    },
    getListenerCount(type) {
      return listeners.filter((entry) => entry.type === type).length;
    },
    getRoot() {
      return root;
    },
    installRoot() {
      root = createRoot();
      return root;
    },
  };
}

function compatSandbox(dom, { supported = false, zodConfig } = {}) {
  const sandbox = {
    document: dom.document,
    Promise: supported ? Promise : undefined,
    Symbol: supported ? Symbol : undefined,
    WebAssembly: supported ? WebAssembly : undefined,
    fetch: supported ? function fetch() {} : undefined,
  };
  if (zodConfig !== undefined) sandbox.__zod_globalConfig = zodConfig;
  sandbox.window = sandbox;
  return sandbox;
}

function renderedText(root) {
  return root.children
    .flatMap((node) => [node.textContent, ...node.children.map((child) => child.textContent)])
    .join(" ");
}

describe("Vercel CSP build contract", () => {
  it("accepts the repository HTML and exact production network allowlist", () => {
    expect(verifyVercelCspContract(fixture())).toMatchObject({
      inlineScriptCount: 1,
    });
  });

  it("preconfigures Zod jitless before the module graph without discarding config", () => {
    const current = fixture();
    const dom = createCompatDom();
    const originalConfig = { customError: "keep-me" };
    const sandbox = compatSandbox(dom, {
      supported: true,
      zodConfig: originalConfig,
    });

    runInNewContext(current.bootstrapCompatSource, sandbox);

    expect(sandbox.__zod_globalConfig).toBe(originalConfig);
    expect(sandbox.__zod_globalConfig).toEqual({
      customError: "keep-me",
      jitless: true,
    });
    expect(current.html.indexOf('src="/bootstrap-compat.js"'))
      .toBeLessThan(current.html.indexOf('type="module"'));
  });

  it("renders the unsupported-browser message after head-time DOMContentLoaded", () => {
    const current = fixture();
    const dom = createCompatDom();
    const sandbox = compatSandbox(dom);

    runInNewContext(current.bootstrapCompatSource, sandbox);

    expect(dom.getRoot()).toBeNull();
    expect(dom.getListenerCount("DOMContentLoaded")).toBe(1);

    const root = dom.installRoot();
    dom.dispatch("DOMContentLoaded");

    expect(dom.getListenerCount("DOMContentLoaded")).toBe(0);
    expect(root.children).toHaveLength(1);
    expect(renderedText(root)).toContain("브라우저 업데이트가 필요합니다");
    expect(renderedText(root)).toContain("최신 웹 표준을 지원하지 않아");
  });

  it("renders immediately when the unsupported-browser root already exists", () => {
    const current = fixture();
    const dom = createCompatDom({ rootPresent: true });

    runInNewContext(current.bootstrapCompatSource, compatSandbox(dom));

    expect(dom.getListenerCount("DOMContentLoaded")).toBe(0);
    expect(dom.getRoot().children).toHaveLength(1);
    expect(renderedText(dom.getRoot())).toContain("브라우저 업데이트가 필요합니다");
  });

  it("does not render or install a listener in supported browsers", () => {
    const current = fixture();
    const dom = createCompatDom({ rootPresent: true });

    runInNewContext(
      current.bootstrapCompatSource,
      compatSandbox(dom, { supported: true }),
    );

    expect(dom.getRoot().children).toHaveLength(0);
    expect(dom.getListenerCount("DOMContentLoaded")).toBe(0);
    expect(dom.getCreatedElementCount()).toBe(1);
  });

  it("renders the fallback when APIs exist but module scripts are unsupported", () => {
    const current = fixture();
    const dom = createCompatDom({ rootPresent: true, moduleSupported: false });

    runInNewContext(
      current.bootstrapCompatSource,
      compatSandbox(dom, { supported: true }),
    );

    expect(renderedText(dom.getRoot())).toContain("브라우저 업데이트가 필요합니다");
    expect(dom.getListenerCount("DOMContentLoaded")).toBe(0);
  });

  it("renders the fallback when module scripts exist but WebAssembly is unavailable", () => {
    const current = fixture();
    const dom = createCompatDom({ rootPresent: true });
    const sandbox = compatSandbox(dom, { supported: true });
    sandbox.WebAssembly = undefined;

    runInNewContext(current.bootstrapCompatSource, sandbox);

    expect(renderedText(dom.getRoot())).toContain("브라우저 업데이트가 필요합니다");
    expect(dom.getListenerCount("DOMContentLoaded")).toBe(0);
  });

  it("installs and renders the unsupported-browser fallback only once", () => {
    const current = fixture();
    const dom = createCompatDom();
    const sandbox = compatSandbox(dom);

    runInNewContext(current.bootstrapCompatSource, sandbox);
    runInNewContext(current.bootstrapCompatSource, sandbox);

    expect(dom.getListenerCount("DOMContentLoaded")).toBe(1);
    const root = dom.installRoot();
    dom.dispatch("DOMContentLoaded");
    const renderedPanel = root.children[0];
    const createdElementCount = dom.getCreatedElementCount();

    dom.dispatch("DOMContentLoaded");
    runInNewContext(current.bootstrapCompatSource, sandbox);

    expect(dom.getListenerCount("DOMContentLoaded")).toBe(0);
    expect(root.children).toEqual([renderedPanel]);
    // Re-execution performs one fresh module-support probe but must not rebuild
    // the visible fallback panel.
    expect(dom.getCreatedElementCount()).toBe(createdElementCount + 1);
  });

  it("rejects executable inline script and unrestricted connection schemes", () => {
    const current = fixture();
    expect(() => verifyVercelCspContract({
      ...current,
      html: current.html.replace(
        "</body>",
        "<script>globalThis.compromised = true</script></body>",
      ),
    })).toThrow("Executable inline script");

    const broadened = JSON.parse(JSON.stringify(current.vercelConfig));
    const cspHeader = broadened.headers[0].headers.find(
      (header) => header.key === "Content-Security-Policy",
    );
    cspHeader.value = cspHeader.value.replace(
      "connect-src 'self'",
      "connect-src 'self' https:",
    );
    expect(() => verifyVercelCspContract({
      html: current.html,
      vercelConfig: broadened,
      bootstrapCompatSource: current.bootstrapCompatSource,
    })).toThrow("unrestricted network scheme");
  });

  it("requires the Blob fetch boundary used by verified Studio 3D asset textures", () => {
    const current = fixture();
    for (const replacement of [
      "connect-src 'self'",
      "connect-src 'self' blob: blob:",
    ]) {
      const changed = JSON.parse(JSON.stringify(current.vercelConfig));
      const cspHeader = changed.headers[0].headers.find(
        (header) => header.key === "Content-Security-Policy",
      );
      cspHeader.value = cspHeader.value.replace(
        "connect-src 'self' blob:",
        replacement,
      );
      expect(() => verifyVercelCspContract({
        html: current.html,
        vercelConfig: changed,
        bootstrapCompatSource: current.bootstrapCompatSource,
      }), replacement).toThrow("exactly one blob: source");
    }
  });

  it("rejects JavaScript eval permission without confusing wasm-unsafe-eval", () => {
    const current = fixture();
    expect(() => verifyVercelCspContract(current)).not.toThrow();

    const broadened = JSON.parse(JSON.stringify(current.vercelConfig));
    const cspHeader = broadened.headers[0].headers.find(
      (header) => header.key === "Content-Security-Policy",
    );
    cspHeader.value = cspHeader.value.replace(
      "'wasm-unsafe-eval'",
      "'wasm-unsafe-eval' 'unsafe-eval'",
    );
    expect(() => verifyVercelCspContract({
      html: current.html,
      vercelConfig: broadened,
      bootstrapCompatSource: current.bootstrapCompatSource,
    })).toThrow("script-src must not contain unsafe-eval");
  });

  it("rejects a missing, late, asynchronous, commented, or disabled Zod CSP bootstrap", () => {
    const current = fixture();
    expect(() => verifyVercelCspContract({
      ...current,
      bootstrapCompatSource: current.bootstrapCompatSource.replace(
        "zodConfig.jitless = true;",
        "zodConfig.jitless = false;",
      ),
    })).toThrow("preserve the Zod config object and enable jitless");

    expect(() => verifyVercelCspContract({
      ...current,
      html: current.html.replace(
        '<script src="/bootstrap-compat.js"></script>',
        "",
      ),
    })).toThrow("one parser-blocking classic head script");

    expect(() => verifyVercelCspContract({
      ...current,
      html: current.html
        .replace('<script src="/bootstrap-compat.js"></script>', "")
        .replace(
          "</body>",
          '<script src="/bootstrap-compat.js"></script></body>',
        ),
    })).toThrow("one parser-blocking classic head script");

    for (const replacement of [
      '<script async src="/bootstrap-compat.js"></script>',
      '<script defer src="/bootstrap-compat.js"></script>',
      '<script type="module" src="/bootstrap-compat.js"></script>',
      '<!-- <script src="/bootstrap-compat.js"></script> -->',
    ]) {
      expect(() => verifyVercelCspContract({
        ...current,
        html: current.html.replace(
          '<script src="/bootstrap-compat.js"></script>',
          replacement,
        ),
      }), replacement).toThrow("one parser-blocking classic head script");
    }

    expect(() => verifyVercelCspContract({
      ...current,
      bootstrapCompatSource:
        "/* window.__zod_globalConfig; fake.jitless = true; */",
    })).toThrow("preserve the Zod config object and enable jitless");
  });

  it("keeps the untranspiled compatibility bootstrap inside the ES5 subset", () => {
    const current = fixture();
    const withTrailingCallComma = current.bootstrapCompatSource.replace(
      'state.readyListener,\n        false\n      );',
      'state.readyListener,\n        false,\n      );',
    );
    expect(withTrailingCallComma).not.toBe(current.bootstrapCompatSource);
    expect(() => verifyVercelCspContract({
      ...current,
      bootstrapCompatSource: withTrailingCallComma,
    })).toThrow("ES5-compatible (trailing function-call comma)");
  });

  it("requires the exact Blob Worker CSP boundary", () => {
    const current = fixture();
    for (const mutate of [
      (value) => value.replace("worker-src 'self' blob:;", "worker-src 'self';"),
      (value) => value.replace("worker-src 'self' blob:;", ""),
      (value) => value.replace("worker-src 'self' blob:;", "worker-src 'self' blob: *;"),
      (value) => value.replace("worker-src 'self' blob:;", "worker-src 'self' blob: data:;"),
    ]) {
      const changed = JSON.parse(JSON.stringify(current.vercelConfig));
      const cspHeader = changed.headers[0].headers.find(
        (header) => header.key === "Content-Security-Policy",
      );
      cspHeader.value = mutate(cspHeader.value);
      expect(() => verifyVercelCspContract({
        html: current.html,
        vercelConfig: changed,
        bootstrapCompatSource: current.bootstrapCompatSource,
      })).toThrow("worker-src must be exactly 'self' blob:");
    }
  });

  it("rejects a wildcard or a second Supabase tenant origin", () => {
    const current = fixture();
    const broadened = JSON.parse(JSON.stringify(current.vercelConfig));
    const cspHeader = broadened.headers[0].headers.find(
      (header) => header.key === "Content-Security-Policy",
    );
    cspHeader.value = cspHeader.value.replace(
      "https://ybsgfhofuvkhywbpytnl.supabase.co",
      "https://*.supabase.co",
    );
    expect(() => verifyVercelCspContract({
      html: current.html,
      vercelConfig: broadened,
      bootstrapCompatSource: current.bootstrapCompatSource,
    })).toThrow("exact production Supabase origin");

    const secondTenant = JSON.parse(JSON.stringify(current.vercelConfig));
    const secondCsp = secondTenant.headers[0].headers.find(
      (header) => header.key === "Content-Security-Policy",
    );
    secondCsp.value = secondCsp.value.replace(
      "https://ybsgfhofuvkhywbpytnl.supabase.co",
      "https://ybsgfhofuvkhywbpytnl.supabase.co https://attacker.supabase.co",
    );
    expect(() => verifyVercelCspContract({
      html: current.html,
      vercelConfig: secondTenant,
      bootstrapCompatSource: current.bootstrapCompatSource,
    })).toThrow("exact production Supabase origin");
  });
});
