/**
 * Runtime-neutral ONNX model catalogue.
 *
 * This module intentionally contains only plain data and validation. It does not
 * know about ONNX Runtime, browser fetch, GPU devices, sessions, or tensors.
 */

export const STUDIO_ONNX_MODEL_REGISTRY_REVISION = 1 as const;

export const STUDIO_ONNX_HARD_LIMITS = Object.freeze({
  maxModels: 128,
  maxModelBytes: 1_073_741_824,
  maxTensorBytes: 536_870_912,
  maxTensorElements: 134_217_728,
  maxTensorRank: 8,
  maxInputs: 32,
  maxOutputs: 64,
  maxIdentifierCharacters: 128,
  maxVersionCharacters: 64,
} as const);

export type StudioOnnxTensorElementType =
  | "float32"
  | "float64"
  | "float16"
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "bool";

export type StudioOnnxTensorData =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

export interface StudioOnnxTensorSchema {
  readonly name: string;
  readonly elementType: StudioOnnxTensorElementType;
  /** Fixed, positive dimensions. Dynamic model dimensions stay outside this first provider slice. */
  readonly shape: readonly number[];
}

export interface StudioOnnxModelDescriptor {
  readonly id: string;
  readonly version: string;
  /** Lowercase digest with an explicit algorithm prefix. */
  readonly sha256: `sha256:${string}`;
  readonly byteBudget: number;
  readonly inputs: readonly StudioOnnxTensorSchema[];
  readonly outputs: readonly StudioOnnxTensorSchema[];
}

export interface StudioOnnxModelRegistry {
  readonly revision: typeof STUDIO_ONNX_MODEL_REGISTRY_REVISION;
  readonly models: readonly StudioOnnxModelDescriptor[];
}

export const EMPTY_STUDIO_ONNX_MODEL_REGISTRY: StudioOnnxModelRegistry =
  Object.freeze({
    revision: STUDIO_ONNX_MODEL_REGISTRY_REVISION,
    models: Object.freeze([]),
  });

const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;
const VERSION_PATTERN = /^[0-9A-Za-z](?:[0-9A-Za-z._+-]*[0-9A-Za-z])?$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const ELEMENT_BYTES: Readonly<Record<StudioOnnxTensorElementType, number>> =
  Object.freeze({
    float32: 4,
    float64: 8,
    float16: 2,
    int8: 1,
    uint8: 1,
    int16: 2,
    uint16: 2,
    int32: 4,
    uint32: 4,
    bool: 1,
  });

export function studioOnnxElementByteLength(
  elementType: StudioOnnxTensorElementType,
): number {
  return ELEMENT_BYTES[elementType];
}

export function studioOnnxTensorElementCount(
  shape: readonly number[],
): number {
  let elements = 1;
  for (const dimension of shape) {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new RangeError("ONNX tensor dimensions must be positive safe integers.");
    }
    elements *= dimension;
    if (
      !Number.isSafeInteger(elements) ||
      elements > STUDIO_ONNX_HARD_LIMITS.maxTensorElements
    ) {
      throw new RangeError("ONNX tensor shape exceeds the hard element budget.");
    }
  }
  return elements;
}

export function studioOnnxTensorSchemaByteLength(
  schema: StudioOnnxTensorSchema,
): number {
  const bytes =
    studioOnnxTensorElementCount(schema.shape) *
    studioOnnxElementByteLength(schema.elementType);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes > STUDIO_ONNX_HARD_LIMITS.maxTensorBytes
  ) {
    throw new RangeError(`ONNX tensor "${schema.name}" exceeds the hard byte budget.`);
  }
  return bytes;
}

function validateIdentifier(
  value: string,
  path: string,
  maxCharacters: number,
  pattern: RegExp,
): void {
  if (
    value.length === 0 ||
    value.length > maxCharacters ||
    !pattern.test(value)
  ) {
    throw new TypeError(`${path} contains an invalid identifier.`);
  }
}

function validateTensorSchema(
  schema: StudioOnnxTensorSchema,
  path: string,
): void {
  validateIdentifier(
    schema.name,
    `${path}.name`,
    STUDIO_ONNX_HARD_LIMITS.maxIdentifierCharacters,
    IDENTIFIER_PATTERN,
  );
  if (!(schema.elementType in ELEMENT_BYTES)) {
    throw new TypeError(`${path}.elementType is unsupported.`);
  }
  if (
    schema.shape.length === 0 ||
    schema.shape.length > STUDIO_ONNX_HARD_LIMITS.maxTensorRank
  ) {
    throw new RangeError(
      `${path}.shape must contain 1..${STUDIO_ONNX_HARD_LIMITS.maxTensorRank} dimensions.`,
    );
  }
  studioOnnxTensorSchemaByteLength(schema);
}

function validateSchemaList(
  schemas: readonly StudioOnnxTensorSchema[],
  path: "inputs" | "outputs",
  maximum: number,
): void {
  if (schemas.length === 0 || schemas.length > maximum) {
    throw new RangeError(`ONNX model ${path} must contain 1..${maximum} entries.`);
  }
  const names = new Set<string>();
  schemas.forEach((schema, index) => {
    validateTensorSchema(schema, `${path}[${index}]`);
    if (names.has(schema.name)) {
      throw new TypeError(`ONNX model ${path} contains duplicate name "${schema.name}".`);
    }
    names.add(schema.name);
  });
}

export function validateStudioOnnxModelDescriptor(
  descriptor: StudioOnnxModelDescriptor,
): void {
  validateIdentifier(
    descriptor.id,
    "model.id",
    STUDIO_ONNX_HARD_LIMITS.maxIdentifierCharacters,
    IDENTIFIER_PATTERN,
  );
  validateIdentifier(
    descriptor.version,
    "model.version",
    STUDIO_ONNX_HARD_LIMITS.maxVersionCharacters,
    VERSION_PATTERN,
  );
  if (!SHA256_PATTERN.test(descriptor.sha256)) {
    throw new TypeError("model.sha256 must be a lowercase sha256 digest.");
  }
  if (
    !Number.isSafeInteger(descriptor.byteBudget) ||
    descriptor.byteBudget <= 0 ||
    descriptor.byteBudget > STUDIO_ONNX_HARD_LIMITS.maxModelBytes
  ) {
    throw new RangeError("model.byteBudget exceeds the supported model byte range.");
  }
  validateSchemaList(
    descriptor.inputs,
    "inputs",
    STUDIO_ONNX_HARD_LIMITS.maxInputs,
  );
  validateSchemaList(
    descriptor.outputs,
    "outputs",
    STUDIO_ONNX_HARD_LIMITS.maxOutputs,
  );
}

function cloneSchema(schema: StudioOnnxTensorSchema): StudioOnnxTensorSchema {
  return Object.freeze({
    name: schema.name,
    elementType: schema.elementType,
    shape: Object.freeze([...schema.shape]),
  });
}

function cloneDescriptor(
  descriptor: StudioOnnxModelDescriptor,
): StudioOnnxModelDescriptor {
  return Object.freeze({
    id: descriptor.id,
    version: descriptor.version,
    sha256: descriptor.sha256,
    byteBudget: descriptor.byteBudget,
    inputs: Object.freeze(descriptor.inputs.map(cloneSchema)),
    outputs: Object.freeze(descriptor.outputs.map(cloneSchema)),
  });
}

export function studioOnnxModelKey(
  id: string,
  version: string,
): string {
  return `${id}\u0000${version}`;
}

export function createStudioOnnxModelRegistry(
  descriptors: readonly StudioOnnxModelDescriptor[],
): StudioOnnxModelRegistry {
  if (descriptors.length > STUDIO_ONNX_HARD_LIMITS.maxModels) {
    throw new RangeError("ONNX model registry exceeds the model count budget.");
  }

  const keys = new Set<string>();
  const models = descriptors.map((descriptor) => {
    validateStudioOnnxModelDescriptor(descriptor);
    const key = studioOnnxModelKey(descriptor.id, descriptor.version);
    if (keys.has(key)) {
      throw new TypeError(
        `Duplicate ONNX model descriptor "${descriptor.id}@${descriptor.version}".`,
      );
    }
    keys.add(key);
    return cloneDescriptor(descriptor);
  });
  models.sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      left.version.localeCompare(right.version),
  );

  return Object.freeze({
    revision: STUDIO_ONNX_MODEL_REGISTRY_REVISION,
    models: Object.freeze(models),
  });
}

export function findStudioOnnxModelDescriptor(
  registry: StudioOnnxModelRegistry,
  id: string,
  version: string,
): StudioOnnxModelDescriptor | null {
  return (
    registry.models.find(
      (descriptor) =>
        descriptor.id === id && descriptor.version === version,
    ) ?? null
  );
}
