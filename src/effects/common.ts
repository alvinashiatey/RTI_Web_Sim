import { vec3, vec2, uv, dot } from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import type { FolderApi } from "tweakpane";
import type Node from "three/src/nodes/core/Node.js";
import type { Texture } from "three/webgpu";
import { Vector2 } from "three/webgpu";

// BT.601 luminance weights
export const LUMA_WEIGHTS = vec3(0.299, 0.587, 0.114);

// Helper: sample a texture at UV + offset and return grayscale luminance
export function sampleGray(tex: TextureNode, offset: ReturnType<typeof vec2>) {
  return dot(tex.sample(uv().add(offset)).rgb, LUMA_WEIGHTS);
}

export interface EffectInstance {
  colorNode: Node;
  updateTexture(tex: Texture): void;
  getParams(): Record<string, unknown>;
  setParams(params: Record<string, unknown>): void;
}

export interface Effect {
  name: string;
  defaults(): Record<string, unknown>;
  createNode(tex: Texture, pixelSize: Vector2): EffectInstance;
  buildUI(folder: FolderApi, instance: EffectInstance): void;
}
