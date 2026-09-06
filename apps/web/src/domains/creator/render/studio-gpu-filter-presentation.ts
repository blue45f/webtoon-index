/**
 * Retained WebGPU presentation for the interactive image-filter lane.
 *
 * The filter compute chain owns a packed RGBA8 storage buffer. This surface reads that buffer in a
 * fullscreen fragment pass and writes directly into the browser-owned GPUCanvasContext texture.
 * There is deliberately no staging buffer, MAP_READ, readPixels, getImageData, ImageBitmap, or
 * intermediate CPU canvas in this module. Canonical pixels are obtained separately by the explicit
 * settle/export readback on the frame handle returned from studio-gpu-filter-apply.
 *
 * Alpha convention: the packed buffer is straight alpha, the swapchain is premultiplied, and the
 * fullscreen fragment pass is the only place the two are reconciled. That conversion is presentation
 * only — it never touches the packed buffer the canonical readback maps.
 */

const GPU_BUFFER_COPY_DST = 0x0008;
const GPU_BUFFER_UNIFORM = 0x0040;

/** The shipped presentation shader. Exported so the alpha contract is assertable without a GPU. */
export const STUDIO_GPU_FILTER_PRESENTATION_WGSL = /* wgsl */ `
struct PresentationParams {
  width : u32,
  height : u32,
  pixel_count : u32,
  _padding : u32,
};

@group(0) @binding(0) var<storage, read> packed_pixels : array<u32>;
@group(0) @binding(1) var<uniform> params : PresentationParams;

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn vertex_main(@builtin(vertex_index) vertex_index : u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var output : VertexOutput;
  output.position = vec4<f32>(positions[vertex_index], 0.0, 1.0);
  return output;
}

fn channel(value : u32, shift : u32) -> f32 {
  return f32((value >> shift) & 255u) / 255.0;
}

// The packed storage buffer carries straight (non-premultiplied) alpha end to end: the captured 2D
// source is straight, and the spatial kernels explicitly un-premultiply on resolve. GPUCanvasAlphaMode
// admits only "opaque" | "premultiplied", so the swapchain convention is not negotiable and the buffer
// side converts here. Emitting the channels verbatim presented semi-transparent frames too bright.
@fragment
fn fragment_main(@builtin(position) position : vec4<f32>) -> @location(0) vec4<f32> {
  let x = min(u32(position.x), params.width - 1u);
  let y = min(u32(position.y), params.height - 1u);
  let index = min(y * params.width + x, params.pixel_count - 1u);
  let packed = packed_pixels[index];
  let alpha = channel(packed, 24u);
  return vec4<f32>(
    channel(packed, 0u) * alpha,
    channel(packed, 8u) * alpha,
    channel(packed, 16u) * alpha,
    alpha,
  );
}
`;

/**
 * The alpha convention the packed filter buffer carries into {@link fragment_main}.
 * Straight alpha in, premultiplied out — matched to the `alphaMode: "premultiplied"` swapchain
 * configured below. Exported so the presentation contract is assertable without a GPU.
 */
export const STUDIO_GPU_FILTER_PRESENTATION_ALPHA = {
  buffer: "straight",
  swapchain: "premultiplied",
} as const;

export type StudioGpuFilterPresentationCanvas = HTMLCanvasElement & {
  getContext(contextId: "webgpu"): GPUCanvasContext | null;
};

export interface StudioGpuFilterPresentationEnvironment {
  readonly createCanvas?: () => StudioGpuFilterPresentationCanvas;
  readonly preferredCanvasFormat?: () => GPUTextureFormat;
}

export interface StudioGpuFilterPresentationInput {
  readonly device: GPUDevice;
  readonly pixels: GPUBuffer;
  readonly width: number;
  readonly height: number;
}

export type StudioGpuFilterPresentationResult =
  | { readonly status: "presented"; readonly revision: number }
  | { readonly status: "unavailable"; readonly reason: string };

export interface StudioGpuFilterPresentationSurface {
  readonly canvas: StudioGpuFilterPresentationCanvas;
  readonly revision: number;
  present(input: StudioGpuFilterPresentationInput): Promise<StudioGpuFilterPresentationResult>;
  dispose(): void;
}

function defaultCanvas(): StudioGpuFilterPresentationCanvas {
  if (typeof document === "undefined") {
    throw new Error("A DOM canvas is unavailable for WebGPU filter presentation.");
  }
  return document.createElement("canvas") as StudioGpuFilterPresentationCanvas;
}

function defaultCanvasFormat(): GPUTextureFormat {
  if (typeof navigator !== "undefined") {
    const gpu = (navigator as { gpu?: GPU }).gpu;
    if (gpu && typeof gpu.getPreferredCanvasFormat === "function") {
      return gpu.getPreferredCanvasFormat();
    }
  }
  return "bgra8unorm";
}

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeDestroy(buffer: GPUBuffer | null): void {
  try {
    buffer?.destroy();
  } catch {
    // A lost device may already have destroyed the transient uniform buffer.
  }
}

function safeUnconfigure(context: GPUCanvasContext | null): void {
  try {
    context?.unconfigure();
  } catch {
    // Detached/lost contexts are already unusable; disposal remains idempotent.
  }
}

class StudioGpuFilterPresentationSurfaceImpl implements StudioGpuFilterPresentationSurface {
  readonly canvas: StudioGpuFilterPresentationCanvas;
  revision = 0;

  private readonly preferredCanvasFormat: () => GPUTextureFormat;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private disposed = false;

  constructor(environment?: StudioGpuFilterPresentationEnvironment) {
    this.canvas = (environment?.createCanvas ?? defaultCanvas)();
    this.preferredCanvasFormat = environment?.preferredCanvasFormat ?? defaultCanvasFormat;
  }

  async present(
    input: StudioGpuFilterPresentationInput,
  ): Promise<StudioGpuFilterPresentationResult> {
    if (this.disposed) {
      return { status: "unavailable", reason: "The retained GPU filter surface is disposed." };
    }
    if (!validDimension(input.width) || !validDimension(input.height)) {
      return { status: "unavailable", reason: "The filter presentation dimensions are invalid." };
    }
    const limits = input.device.limits;
    if (
      input.width > limits.maxTextureDimension2D
      || input.height > limits.maxTextureDimension2D
    ) {
      return {
        status: "unavailable",
        reason: "The filter presentation exceeds maxTextureDimension2D.",
      };
    }

    let pushedScopes = 0;
    let uniform: GPUBuffer | null = null;
    try {
      const format = this.preferredCanvasFormat();
      const context = this.context ?? this.canvas.getContext("webgpu");
      if (!context) {
        return { status: "unavailable", reason: "GPUCanvasContext is unavailable." };
      }
      this.context = context;

      input.device.pushErrorScope("out-of-memory");
      pushedScopes += 1;
      input.device.pushErrorScope("validation");
      pushedScopes += 1;

      if (
        this.device !== input.device
        || this.format !== format
        || this.canvas.width !== input.width
        || this.canvas.height !== input.height
      ) {
        safeUnconfigure(context);
        this.canvas.width = input.width;
        this.canvas.height = input.height;
        context.configure({
          device: input.device,
          format,
          alphaMode: STUDIO_GPU_FILTER_PRESENTATION_ALPHA.swapchain,
        });
        this.device = input.device;
        this.format = format;
        this.pipeline = null;
      }

      if (!this.pipeline) {
        const module = input.device.createShaderModule({
          label: "studio-gpu-filter/presentation",
          code: STUDIO_GPU_FILTER_PRESENTATION_WGSL,
        });
        this.pipeline = input.device.createRenderPipeline({
          label: "studio-gpu-filter/presentation",
          layout: "auto",
          vertex: { module, entryPoint: "vertex_main" },
          fragment: {
            module,
            entryPoint: "fragment_main",
            targets: [{ format }],
          },
          primitive: { topology: "triangle-list" },
        });
      }

      const params = new Uint32Array([
        input.width >>> 0,
        input.height >>> 0,
        (input.width * input.height) >>> 0,
        0,
      ]);
      uniform = input.device.createBuffer({
        label: "studio-gpu-filter/presentation-params",
        size: params.byteLength,
        usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
      });
      input.device.queue.writeBuffer(uniform, 0, params);
      const bindGroup = input.device.createBindGroup({
        label: "studio-gpu-filter/presentation-bind-group",
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: input.pixels } },
          { binding: 1, resource: { buffer: uniform } },
        ],
      });
      const encoder = input.device.createCommandEncoder({
        label: "studio-gpu-filter/presentation",
      });
      const pass = encoder.beginRenderPass({
        label: "studio-gpu-filter/presentation",
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      input.device.queue.submit([encoder.finish()]);

      const validationError = await input.device.popErrorScope();
      pushedScopes -= 1;
      const oomError = await input.device.popErrorScope();
      pushedScopes -= 1;
      if (validationError || oomError) {
        return {
          status: "unavailable",
          reason: validationError?.message ?? oomError?.message ?? "WebGPU presentation failed.",
        };
      }
      this.revision += 1;
      return { status: "presented", revision: this.revision };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "WebGPU presentation failed.",
      };
    } finally {
      while (pushedScopes > 0) {
        pushedScopes -= 1;
        try {
          void input.device.popErrorScope().catch(() => undefined);
        } catch {
          // Device loss also clears its error-scope stack.
        }
      }
      safeDestroy(uniform);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    safeUnconfigure(this.context);
    this.context = null;
    this.device = null;
    this.pipeline = null;
  }
}

export function createStudioGpuFilterPresentationSurface(
  environment?: StudioGpuFilterPresentationEnvironment,
): StudioGpuFilterPresentationSurface {
  return new StudioGpuFilterPresentationSurfaceImpl(environment);
}
