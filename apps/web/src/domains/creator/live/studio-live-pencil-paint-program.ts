/** Transient retained-surface commands, released with the pending stroke (not document storage). */
export type StudioLivePencilPaintCommand = Readonly<{
  alpha: number;
  color: string;
}> & (
  | Readonly<{ kind: "fill"; coordinates: readonly number[] }>
  | Readonly<{ kind: "circle"; x: number; y: number; radius: number }>
  | Readonly<{ kind: "stroke"; coordinates: readonly number[]; width: number }>
);

/** Preserve per-frame alpha unions exactly, without rebuilding an entire stroke at pointer-up. */
export function paintStudioLivePencilProgram(
  context: CanvasRenderingContext2D,
  commands: readonly StudioLivePencilPaintCommand[],
): void {
  for (const command of commands) {
    context.globalAlpha = command.alpha;
    context.fillStyle = command.color;
    context.strokeStyle = command.color;
    context.globalCompositeOperation = "source-over";
    context.beginPath();
    if (command.kind === "circle") {
      context.arc(command.x, command.y, command.radius, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    if (command.kind === "stroke") {
      context.lineWidth = command.width;
      for (let index = 0; index + 1 < command.coordinates.length; index += 2) {
        const x = command.coordinates[index]!;
        const y = command.coordinates[index + 1]!;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      continue;
    }
    let start = 0;
    const coordinates = command.coordinates;
    for (let index = 0; index <= coordinates.length; index += 1) {
      if (index === coordinates.length || Number.isNaN(coordinates[index])) {
        for (let offset = start; offset + 1 < index; offset += 2) {
          const x = coordinates[offset]!;
          const y = coordinates[offset + 1]!;
          if (offset === start) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        if (index > start) context.closePath();
        start = index + 1;
      }
    }
    context.fill();
  }
}
