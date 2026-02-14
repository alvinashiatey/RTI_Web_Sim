import {
  texture,
  uv,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  floor,
  fract,
  dot,
  mix,
  sqrt,
  smoothstep,
} from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import type { Effect, EffectInstance } from "./common";
import { LUMA_WEIGHTS } from "./common";
import type { Texture } from "three/webgpu";
import { Vector2 } from "three/webgpu";
import type { FolderApi } from "tweakpane";

export const halftone: Effect = {
  name: "Halftone",
  defaults: () => ({ dotSize: 8.0, angle: 45, colorMode: 0 }),

  createNode(tex: Texture, pixelSize: Vector2) {
    const mapTex = texture(tex, uv()) as TextureNode;
    const dotSizeU = uniform(8.0);
    const angleU = uniform(45.0);
    // 0 = mono (black dots on white), 1 = colour dots
    const colorModeU = uniform(0.0);

    // Pre-computed sin/cos of rotation angle (updated via setParams)
    const cosA = uniform(Math.cos((45 * Math.PI) / 180));
    const sinA = uniform(Math.sin((45 * Math.PI) / 180));

    const coord = uv();

    // Scale UV so one "cell" = dotSize pixels
    const pxU = uniform(pixelSize);
    const cellW = dotSizeU.mul(pxU.x);
    const cellH = dotSizeU.mul(pxU.y);

    // Rotate UVs
    const cx = coord.x.sub(0.5);
    const cy = coord.y.sub(0.5);
    const rx = cx.mul(cosA).add(cy.mul(sinA)).add(0.5);
    const ry = cy.mul(cosA).sub(cx.mul(sinA)).add(0.5);

    // Cell index (integer part → cell center)
    const cellX = floor(rx.div(cellW));
    const cellY = floor(ry.div(cellH));

    // Cell center in rotated space → back to original UV
    const centerRX = cellX.add(0.5).mul(cellW);
    const centerRY = cellY.add(0.5).mul(cellH);

    // Un-rotate to get the original UV at cell center
    const crx = centerRX.sub(0.5);
    const cry = centerRY.sub(0.5);
    const origX = crx.mul(cosA).sub(cry.mul(sinA)).add(0.5);
    const origY = crx.mul(sinA).add(cry.mul(cosA)).add(0.5);
    const cellCenterUV = vec2(origX, origY);

    // Sample colour at cell center
    const cellColor = mapTex.sample(cellCenterUV);
    const lum = dot(cellColor.rgb, LUMA_WEIGHTS);

    // Distance from current fragment to cell center (in rotated space)
    const dxR = fract(rx.div(cellW)).sub(0.5);
    const dyR = fract(ry.div(cellH)).sub(0.5);
    const dist = sqrt(dxR.mul(dxR).add(dyR.mul(dyR)));

    // Dot radius proportional to darkness (darker = larger dot)
    const radius = float(1.0).sub(lum).mul(0.5);

    // Inside dot? (smoothstep for anti-aliasing)
    const dot_ = float(1.0).sub(
      smoothstep(radius.sub(0.02), radius.add(0.02), dist),
    );

    // Mono mode: black dot on white background
    const mono = vec3(float(1.0).sub(dot_));
    // Colour mode: tinted dot on white background
    const colored = mix(vec3(1.0, 1.0, 1.0), cellColor.rgb, dot_);

    const result = mix(mono, colored, colorModeU);
    const colorNode = vec4(result, float(1.0));

    return {
      colorNode,
      updateTexture(t: Texture) {
        mapTex.value = t;
      },
      getParams: () => ({
        dotSize: dotSizeU.value,
        angle: angleU.value,
        colorMode: (colorModeU.value as number) > 0.5,
      }),
      setParams(p: Record<string, unknown>) {
        if (p.dotSize != null) dotSizeU.value = p.dotSize as number;
        if (p.angle != null) {
          const a = p.angle as number;
          angleU.value = a;
          cosA.value = Math.cos((a * Math.PI) / 180);
          sinA.value = Math.sin((a * Math.PI) / 180);
        }
        if (p.colorMode != null)
          colorModeU.value = (p.colorMode as boolean) ? 1.0 : 0.0;
      },
    };
  },

  buildUI(folder: FolderApi, instance: EffectInstance) {
    const obj = {
      dotSize: 8.0,
      angle: 45,
      colorMode: false,
    };
    Object.assign(obj, instance.getParams());
    folder
      .addBinding(obj, "dotSize", {
        min: 2,
        max: 40,
        step: 1,
        label: "Dot Size",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "angle", {
        min: 0,
        max: 180,
        step: 1,
        label: "Angle (°)",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "colorMode", { label: "Color" })
      .on("change", () => instance.setParams(obj));
  },
};
