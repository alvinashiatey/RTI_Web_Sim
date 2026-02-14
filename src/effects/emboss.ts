import {
  texture,
  uv,
  uniform,
  vec2,
  float,
  vec3,
  vec4,
  clamp,
} from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import { sampleGray } from "./common";
import type { Effect, EffectInstance } from "./common";
import type { Texture } from "three/webgpu";
import { Vector2 } from "three/webgpu";
import type { FolderApi } from "tweakpane";

export const emboss: Effect = {
  name: "Emboss",
  defaults: () => ({ strength: 1.0, angle: 135 }),

  createNode(tex: Texture, pixelSize: Vector2) {
    const mapTex = texture(tex, uv()) as TextureNode;
    const strengthU = uniform(1.0);
    const angleU = uniform(135.0);
    const px = uniform(pixelSize);

    // Pre-compute direction cosines (updated via setParams)
    const cosA = uniform(Math.cos((135 * Math.PI) / 180));
    const sinA = uniform(Math.sin((135 * Math.PI) / 180));

    const dx = px.x;
    const dy = px.y;

    // Sobel X
    const gx = sampleGray(mapTex, vec2(dx.negate(), dy.negate()))
      .negate()
      .add(sampleGray(mapTex, vec2(dx, dy.negate())))
      .add(sampleGray(mapTex, vec2(dx.negate(), float(0))).mul(-2))
      .add(sampleGray(mapTex, vec2(dx, float(0))).mul(2))
      .add(sampleGray(mapTex, vec2(dx.negate(), dy)).negate())
      .add(sampleGray(mapTex, vec2(dx, dy)));

    // Sobel Y
    const gy = sampleGray(mapTex, vec2(dx.negate(), dy.negate()))
      .negate()
      .add(sampleGray(mapTex, vec2(float(0), dy.negate())).mul(-2))
      .add(sampleGray(mapTex, vec2(dx, dy.negate())).negate())
      .add(sampleGray(mapTex, vec2(dx.negate(), dy)))
      .add(sampleGray(mapTex, vec2(float(0), dy)).mul(2))
      .add(sampleGray(mapTex, vec2(dx, dy)));

    // Directional emboss = dot(gradient, direction) * strength + 0.5
    const embossVal = gx.mul(cosA).add(gy.mul(sinA)).mul(strengthU).add(0.5);
    const clamped = clamp(embossVal, 0, 1);
    const colorNode = vec4(vec3(clamped), float(1.0));

    return {
      colorNode,
      updateTexture(t: Texture) {
        mapTex.value = t;
      },
      getParams: () => ({ strength: strengthU.value, angle: angleU.value }),
      setParams(p: Record<string, unknown>) {
        if (p.strength != null) strengthU.value = p.strength as number;
        if (p.angle != null) {
          const a = p.angle as number;
          angleU.value = a;
          cosA.value = Math.cos((a * Math.PI) / 180);
          sinA.value = Math.sin((a * Math.PI) / 180);
        }
      },
    };
  },

  buildUI(folder: FolderApi, instance: EffectInstance) {
    const obj = instance.getParams();
    folder
      .addBinding(obj, "strength", {
        min: 0,
        max: 5,
        step: 0.1,
        label: "Strength",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "angle", {
        min: 0,
        max: 360,
        step: 1,
        label: "Angle (°)",
      })
      .on("change", () => instance.setParams(obj));
  },
};
