import { Vector2 } from "three/webgpu";
import {
  texture,
  uv,
  uniform,
  vec4,
  float,
  length,
  smoothstep,
} from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import type { Texture } from "three/webgpu";
import type { FolderApi } from "tweakpane";
import type { Effect, EffectInstance } from "./common";

export const chromaticAberration: Effect = {
  name: "Chromatic Aberration",
  defaults: () => ({ intensity: 0.01, centerX: 0.5, centerY: 0.5 }),

  createNode(tex: Texture, _pixelSize: Vector2) {
    const mapTex = texture(tex, uv()) as TextureNode;
    const intensityU = uniform(0.01);
    const centerU = uniform(new Vector2(0.5, 0.5));

    // Direction from center to current fragment
    const coord = uv();
    const dir = coord.sub(centerU);
    const dist = length(dir);

    // Offset each channel outward by a different amount
    // Red: pushed outward, Green: stays, Blue: pushed inward
    const rUV = coord.add(dir.mul(intensityU));
    const gUV = coord;
    const bUV = coord.sub(dir.mul(intensityU));

    const r = mapTex.sample(rUV).r;
    const g = mapTex.sample(gUV).g;
    const b = mapTex.sample(bUV).b;

    // Subtle vignette darkening at edges for a more lens-like feel
    const vignette = smoothstep(float(0.9), float(0.3), dist);

    const colorNode = vec4(
      r.mul(vignette),
      g.mul(vignette),
      b.mul(vignette),
      float(1.0),
    );

    return {
      colorNode,
      updateTexture(t: Texture) {
        mapTex.value = t;
      },
      getParams: () => ({
        intensity: intensityU.value,
        centerX: (centerU.value as Vector2).x,
        centerY: (centerU.value as Vector2).y,
      }),
      setParams(p: Record<string, unknown>) {
        if (p.intensity != null) intensityU.value = p.intensity as number;
        const cv = centerU.value as Vector2;
        if (p.centerX != null) cv.x = p.centerX as number;
        if (p.centerY != null) cv.y = p.centerY as number;
      },
    };
  },

  buildUI(folder: FolderApi, instance: EffectInstance) {
    const obj = instance.getParams() as {
      intensity: number;
      centerX: number;
      centerY: number;
    };
    folder
      .addBinding(obj, "intensity", {
        min: 0,
        max: 0.1,
        step: 0.001,
        label: "Intensity",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "centerX", {
        min: 0,
        max: 1,
        step: 0.01,
        label: "Center X",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "centerY", {
        min: 0,
        max: 1,
        step: 0.01,
        label: "Center Y",
      })
      .on("change", () => instance.setParams(obj));
  },
};
