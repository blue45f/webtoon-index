const ZOD_GLOBAL_CONFIG_KEY = "__zod_globalConfig";
const RUNTIME_MODULE_URL = "__TOONSPECTRUM_REVISION_COMPARE_RUNTIME_MODULE_URL__";

const existingZodConfig = Reflect.get(globalThis, ZOD_GLOBAL_CONFIG_KEY);
const zodConfig =
  typeof existingZodConfig === "object" && existingZodConfig !== null
    ? existingZodConfig
    : Object.create(null);

if (zodConfig !== existingZodConfig) {
  if (!Reflect.set(globalThis, ZOD_GLOBAL_CONFIG_KEY, zodConfig)) {
    throw new TypeError("Unable to install the Zod strict-CSP configuration.");
  }
}
if (!Reflect.set(zodConfig, "jitless", true)) {
  throw new TypeError("Unable to enable the Zod strict-CSP configuration.");
}

await import(RUNTIME_MODULE_URL);

globalThis.postMessage({
  type: "studio-revision-compare/bootstrap-ready",
  version: 1,
});

export {};
