import { Vector2, MeshStandardNodeMaterial } from "three/webgpu";
import type { Texture } from "three/webgpu";
import type { Effect, EffectInstance } from "./common";

// Re-export individual effects
export { normalMapVis } from "./normalMap";
export { sobelEdge } from "./sobel";
export { emboss } from "./emboss";
export { grayscale } from "./grayscale";
export { chromaticAberration } from "./chromatic";
export { halftone } from "./halftone";
export { halftoneCMYK } from "./halftoneCMYK";

import { normalMapVis as _n } from "./normalMap";
import { sobelEdge as _s } from "./sobel";
import { emboss as _e } from "./emboss";
import { grayscale as _g } from "./grayscale";
import { chromaticAberration as _c } from "./chromatic";
import { halftone as _h } from "./halftone";
import { halftoneCMYK as _hc } from "./halftoneCMYK";

export const EFFECTS: Effect[] = [_n, _s, _e, _g, _c, _h, _hc];
export const EFFECT_MAP = new Map<string, Effect>(
  EFFECTS.map((e) => [e.name, e]),
);
export const EFFECT_NAMES = ["None", ...EFFECTS.map((e) => e.name)];

export interface EffectState {
  selected: string;
  instance: EffectInstance | null;
  params: Record<string, unknown>;
}

export function createEffectState(): EffectState {
  return { selected: "None", instance: null, params: {} };
}

export function applyEffect(
  state: EffectState,
  material: MeshStandardNodeMaterial,
  currentTexture: Texture | null,
  pixelSize: Vector2,
): void {
  if (state.selected === "None" || !currentTexture) {
    if (material.colorNode != null) {
      material.colorNode = null;
      material.needsUpdate = true;
    }
    state.instance = null;
    return;
  }

  const effect = EFFECT_MAP.get(state.selected);
  if (!effect) return;

  const inst = effect.createNode(currentTexture, pixelSize);

  if (Object.keys(state.params).length > 0) {
    inst.setParams(state.params);
  }

  state.instance = inst;
  material.colorNode = inst.colorNode;
  material.needsUpdate = true;
}
