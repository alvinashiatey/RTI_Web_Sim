import { texture, uv, uniform, vec3, vec4, float, max, dot } from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import type { Effect, EffectInstance } from "./common";
import type { Texture } from "three/webgpu";
import { Vector2 } from "three/webgpu";
import type { FolderApi } from "tweakpane";

export const grayscale: Effect = {
  name: "Grayscale",
  defaults: () => ({ rWeight: 0.299, gWeight: 0.587, bWeight: 0.114 }),

  createNode(tex: Texture, _pixelSize: Vector2) {
    const mapTex = texture(tex, uv()) as TextureNode;
    const rW = uniform(0.299);
    const gW = uniform(0.587);
    const bW = uniform(0.114);

    const sum = rW.add(gW).add(bW);
    const normR = rW.div(max(sum, 0.001));
    const normG = gW.div(max(sum, 0.001));
    const normB = bW.div(max(sum, 0.001));
    const weights = vec3(normR, normG, normB);
    const lum = dot(mapTex.rgb, weights);
    const colorNode = vec4(vec3(lum), float(1.0));

    return {
      colorNode,
      updateTexture(t: Texture) {
        mapTex.value = t;
      },
      getParams: () => ({
        rWeight: rW.value,
        gWeight: gW.value,
        bWeight: bW.value,
      }),
      setParams(p: Record<string, unknown>) {
        if (p.rWeight != null) rW.value = p.rWeight as number;
        if (p.gWeight != null) gW.value = p.gWeight as number;
        if (p.bWeight != null) bW.value = p.bWeight as number;
      },
    };
  },

  buildUI(folder: FolderApi, instance: EffectInstance) {
    const obj = instance.getParams();
    folder
      .addBinding(obj, "rWeight", {
        min: 0,
        max: 1,
        step: 0.01,
        label: "R Weight",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "gWeight", {
        min: 0,
        max: 1,
        step: 0.01,
        label: "G Weight",
      })
      .on("change", () => instance.setParams(obj));
    folder
      .addBinding(obj, "bWeight", {
        min: 0,
        max: 1,
        step: 0.01,
        label: "B Weight",
      })
      .on("change", () => instance.setParams(obj));
  },
};
