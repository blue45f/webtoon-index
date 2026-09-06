declare module "p5.brush/standalone" {
  export const RADIANS: "radians";

  export function load(target: HTMLCanvasElement | OffscreenCanvas): void;
  export function render(): void;
  export function clear(...color: unknown[]): void;
  export function seed(value: number | string): void;
  export function noiseSeed(value: number | string): void;
  export function angleMode(mode: "degrees" | "radians"): void;
  export function push(): void;
  export function pop(): void;
  export function translate(x: number, y: number): void;

  export function box(): string[];
  export function set(
    brushName: string,
    color: string,
    weight?: number,
  ): void;
  export function noStroke(): void;
  export function noFill(): void;
  export function noHatch(): void;
  export function noMass(): void;
  export function noField(): void;
  export function noWash(): void;
  export function noClip(): void;
  export function fill(color: string, opacity?: number): void;
  export function fillBleed(
    strength: number,
    direction?: "out" | "in",
    angle?: number | null,
  ): void;
  export function fillTexture(
    texture: number,
    border: number,
    scatter?: boolean,
  ): void;
  export function wash(color: string, opacity?: number): void;

  export function listFields(): string[];
  export function field(name: string): void;
  export function refreshField(time?: number): void;
  export function spline(
    points: readonly (readonly [number, number, number])[],
    curvature?: number,
  ): unknown;

  export function hatch(
    distance?: number,
    angle?: number,
    options?: Readonly<{
      rand?: number | false;
      continuous?: boolean;
      gradient?: number | false;
    }>,
  ): void;
  export function hatchStyle(
    brushName: string,
    color?: string,
    weight?: number,
  ): void;
  export function mass(
    brushName: string,
    color: string,
    options?: Readonly<{
      precision?: number;
      strength?: number;
      gradient?: number;
      outline?: boolean;
    }>,
  ): void;
  export function polygon(
    points: readonly (readonly [number, number, number?])[],
  ): unknown;
}
