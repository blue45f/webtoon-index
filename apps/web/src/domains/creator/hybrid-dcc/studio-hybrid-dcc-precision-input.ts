/** Bounded dimensional arithmetic for authoring fields. No eval, scripts or identifiers. */
export type StudioHybridDccQuantity = "length" | "angle" | "scalar";
interface QuantityValue {
  readonly value: number;
  readonly dimension: StudioHybridDccQuantity;
}
const UNITS: Readonly<Record<string, QuantityValue>> = Object.freeze({
  m: { value: 1, dimension: "length" },
  cm: { value: 0.01, dimension: "length" },
  mm: { value: 0.001, dimension: "length" },
  deg: { value: Math.PI / 180, dimension: "angle" },
  "°": { value: Math.PI / 180, dimension: "angle" },
  rad: { value: 1, dimension: "angle" },
  "%": { value: 0.01, dimension: "scalar" },
});

/** Bare length/angle values mean metres/degrees; the returned angle is always radians. */
export function parseStudioHybridDccPrecisionInput(
  source: string,
  expected: StudioHybridDccQuantity,
): number {
  const text = source.trim();
  if (!text || text.length > 96) throw new Error("수식을 1~96자로 입력하세요.");
  let index = 0;
  let steps = 0;
  const skip = () => { while (/\s/u.test(text[index] ?? "")) index += 1; };
  const checked = (value: QuantityValue): QuantityValue => {
    if (!Number.isFinite(value.value) || Math.abs(value.value) > 1e12) {
      throw new Error("계산 결과가 유한한 안전 범위를 벗어났습니다.");
    }
    return value;
  };
  const atom = (depth: number): QuantityValue => {
    if (depth > 16 || ++steps > 64) throw new Error("수식이 너무 복잡합니다.");
    skip();
    const char = text[index];
    if (char === "+" || char === "-") {
      index += 1;
      const result = atom(depth + 1);
      return checked({ ...result, value: char === "-" ? -result.value : result.value });
    }
    if (char === "(") {
      index += 1;
      const result = expression(depth + 1);
      skip();
      if (text[index] !== ")") throw new Error("닫는 괄호가 필요합니다.");
      index += 1;
      return result;
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu.exec(text.slice(index));
    if (!match) throw new Error("숫자, 단위, 사칙연산과 괄호만 사용할 수 있습니다.");
    index += match[0].length;
    skip();
    const unitMatch = /^(?:deg|rad|mm|cm|m|°|%)/iu.exec(text.slice(index));
    const unit = unitMatch ? UNITS[unitMatch[0].toLowerCase()]! : null;
    if (unitMatch) index += unitMatch[0].length;
    return checked({
      value: Number(match[0]) * (unit?.value ?? 1),
      dimension: unit?.dimension ?? "scalar",
    });
  };
  const product = (depth: number): QuantityValue => {
    let left = atom(depth);
    while (true) {
      skip();
      const operator = text[index];
      if (operator !== "*" && operator !== "/") return left;
      index += 1;
      const right = atom(depth);
      if (operator === "*") {
        if (left.dimension !== "scalar" && right.dimension !== "scalar") {
          throw new Error("길이·각도끼리의 곱셈은 지원하지 않습니다. 배율을 사용하세요.");
        }
        left = checked({
          value: left.value * right.value,
          dimension: left.dimension === "scalar" ? right.dimension : left.dimension,
        });
      } else {
        if (right.value === 0) throw new Error("0으로 나눌 수 없습니다.");
        if (right.dimension !== "scalar" && right.dimension !== left.dimension) {
          throw new Error("서로 다른 단위를 나눌 수 없습니다.");
        }
        left = checked({
          value: left.value / right.value,
          dimension: right.dimension === "scalar" ? left.dimension : "scalar",
        });
      }
    }
  };
  const expression = (depth: number): QuantityValue => {
    let left = product(depth);
    while (true) {
      skip();
      const operator = text[index];
      if (operator !== "+" && operator !== "-") return left;
      index += 1;
      const right = product(depth);
      if (left.dimension !== right.dimension) {
        throw new Error("더하거나 뺄 때는 양쪽에 같은 종류의 단위를 사용하세요.");
      }
      left = checked({
        value: operator === "+" ? left.value + right.value : left.value - right.value,
        dimension: left.dimension,
      });
    }
  };
  const result = expression(0);
  skip();
  if (index !== text.length) throw new Error("해석할 수 없는 단위 또는 문자가 있습니다.");
  if (result.dimension !== "scalar" && result.dimension !== expected) {
    throw new Error("이 변환에는 해당 단위를 사용할 수 없습니다.");
  }
  const value = result.value * (expected === "angle" && result.dimension === "scalar"
    ? Math.PI / 180 : 1);
  return Object.is(value, -0) ? 0 : value;
}
