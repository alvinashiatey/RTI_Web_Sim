import {
  texture,
  uv,
  uniform,
  vec2,
  float,
  vec4,
  vec3,
  clamp,
  sqrt,
  step,
  mix,
} from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import { sampleGray } from "./common";
import type { Effect, EffectInstance } from "./common";
import type { Texture } from "three/webgpu";
import { Vector2 } from "three/webgpu";
import type { FolderApi } from "tweakpane";

export const sobelEdge: Effect = {
  name: "Sobel Edge",
  defaults: () => ({ threshold: 0.1, invert: false }),

  createNode(tex: Texture, pixelSize: Vector2) {
    const mapTex = texture(tex, uv()) as TextureNode;
    const thresholdU = uniform(0.1);
    const invertU = uniform(0.0); // 0 = normal, 1 = inverted
    const px = uniform(pixelSize);
    const dx = px.x;
    const dy = px.y;

    const gx = sampleGray(mapTex, vec2(dx.negate(), dy.negate()))
      .negate()
      .add(sampleGray(mapTex, vec2(dx, dy.negate())))
      .add(sampleGray(mapTex, vec2(dx.negate(), float(0))).mul(-2))
      .add(sampleGray(mapTex, vec2(dx, float(0))).mul(2))
      .add(sampleGray(mapTex, vec2(dx.negate(), dy)).negate())
      .add(sampleGray(mapTex, vec2(dx, dy)));

    const gy = sampleGray(mapTex, vec2(dx.negate(), dy.negate()))
      .negate()
      .add(sampleGray(mapTex, vec2(float(0), dy.negate())).mul(-2))
      .add(sampleGray(mapTex, vec2(dx, dy.negate())).negate())
      .add(sampleGray(mapTex, vec2(dx.negate(), dy)))
      .add(sampleGray(mapTex, vec2(float(0), dy)).mul(2))
      .add(sampleGray(mapTex, vec2(dx, dy)));

    const mag = clamp(sqrt(gx.mul(gx).add(gy.mul(gy))), 0, 1);
    const thresholded = step(thresholdU, mag).mul(mag);
    const result = mix(thresholded, float(1.0).sub(thresholded), invertU);
    const colorNode = vec4(vec3(result), float(1.0));

    return {
      colorNode,
      updateTexture(t: Texture) {
        mapTex.value = t;
      },
      getParams: () => ({
        threshold: thresholdU.value,
        invert: (invertU.value as number) > 0.5,
      }),
      setParams(p: Record<string, unknown>) {
        if (p.threshold != null) thresholdU.value = p.threshold as number;
        if (p.invert != null) invertU.value = (p.invert as boolean) ? 1.0 : 0.0;
      },
    };
  },

  buildUI(folder: FolderApi, instance: EffectInstance) {
    const obj = { threshold: 0.1, invert: false };
    Object.assign(obj, instance.getParams());
    folder
      .addBinding(obj, "threshold", {
        min: 0,
        max: 1,
        step: 0.01,
        label: "Threshold",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "invert", { label: "Invert" })
      .on("change", () => instance.setParams(obj));
  },
};
