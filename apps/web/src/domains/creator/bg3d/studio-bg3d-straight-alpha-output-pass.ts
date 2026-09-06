import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const OUTPUT_SHADER_SAMPLE_STATEMENT = "gl_FragColor = texture2D( tDiffuse, vUv );";

/**
 * Three's normal alpha blending stores a premultiplied linear RGB composite in a transparent render
 * target. Studio's raster contract is straight alpha, so restore straight linear RGB before the
 * inherited OutputPass applies tone mapping and the sRGB transfer function.
 */
export const STUDIO_BG3D_LINEAR_UNPREMULTIPLY_SHADER_CHUNK = /* glsl */ `
			if ( gl_FragColor.a > 0.0 ) {

				gl_FragColor.rgb /= gl_FragColor.a;

			} else {

				gl_FragColor.rgb = vec3( 0.0 );

			}
`;

/** Creates an OutputPass whose readback satisfies Studio's non-premultiplied RGBA contract. */
export function createStudioBg3dStraightAlphaOutputPass(): OutputPass {
  const pass = new OutputPass();
  const source = pass.material.fragmentShader;
  const firstSample = source.indexOf(OUTPUT_SHADER_SAMPLE_STATEMENT);
  if (
    firstSample < 0 ||
    source.indexOf(OUTPUT_SHADER_SAMPLE_STATEMENT, firstSample + OUTPUT_SHADER_SAMPLE_STATEMENT.length) >= 0
  ) {
    pass.material.dispose();
    throw new Error("Three OutputPass shader contract changed; straight-alpha capture is unavailable.");
  }
  pass.material.name = "Studio straight-alpha output";
  pass.material.fragmentShader = source.replace(
    OUTPUT_SHADER_SAMPLE_STATEMENT,
    `${OUTPUT_SHADER_SAMPLE_STATEMENT}${STUDIO_BG3D_LINEAR_UNPREMULTIPLY_SHADER_CHUNK}`
  );
  pass.material.needsUpdate = true;
  return pass;
}
