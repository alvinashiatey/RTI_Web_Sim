import {
  texture,
  uv,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  normalize,
} from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import { sampleGray } from "./common";
import type { Effect, EffectInstance } from "./common";
import type { Texture } from "three/webgpu";
import { Vector2 } from "three/webgpu";
import type { FolderApi } from "tweakpane";

export const normalMapVis: Effect = {
  name: "Normal Map",
  defaults: () => ({ strength: 2.0 }),

  createNode(tex: Texture, pixelSize: Vector2) {
    const mapTex = texture(tex, uv()) as TextureNode;
    const strengthU = uniform(2.0);
    const px = uniform(pixelSize);
    const dx = px.x;
    const dy = px.y;

    // Sobel X gradient
    const gx = sampleGray(mapTex, vec2(dx.negate(), dy.negate()))
      .negate()
      .add(sampleGray(mapTex, vec2(dx, dy.negate())))
      .add(sampleGray(mapTex, vec2(dx.negate(), float(0))).mul(-2))
      .add(sampleGray(mapTex, vec2(dx, float(0))).mul(2))
      .add(sampleGray(mapTex, vec2(dx.negate(), dy)).negate())
      .add(sampleGray(mapTex, vec2(dx, dy)));

    // Sobel Y gradient
    const gy = sampleGray(mapTex, vec2(dx.negate(), dy.negate()))
      .negate()
      .add(sampleGray(mapTex, vec2(float(0), dy.negate())).mul(-2))
      .add(sampleGray(mapTex, vec2(dx, dy.negate())).negate())
      .add(sampleGray(mapTex, vec2(dx.negate(), dy)))
      .add(sampleGray(mapTex, vec2(float(0), dy)).mul(2))
      .add(sampleGray(mapTex, vec2(dx, dy)));

    // Normal = normalize(-gx*strength, -gy*strength, 1)
    const rawNormal = vec3(
      gx.negate().mul(strengthU),
      gy.negate().mul(strengthU),
      float(1.0),
    );
    const n = normalize(rawNormal);
    // Pack [-1,1] → [0,1] for visualisation
    const colorNode = vec4(n.mul(0.5).add(0.5), float(1.0));

    return {
      colorNode,
      updateTexture(t: Texture) {
        mapTex.value = t;
      },
      getParams: () => ({ strength: strengthU.value }),
      setParams(p: Record<string, unknown>) {
        if (p.strength != null) strengthU.value = p.strength as number;
      },
    };
  },

  buildUI(folder: FolderApi, instance: EffectInstance) {
    const obj = instance.getParams();
    folder
      .addBinding(obj, "strength", {
        min: 0,
        max: 10,
        step: 0.1,
        label: "Strength",
      })
      .on("change", () => instance.setParams(obj));
  },
};
