/**
 * Type declarations for Three.js WebGPU and TSL bundles.
 *
 * The runtime bundles (`three/webgpu`, `three/tsl`) are shipped by three.js
 * but `@types/three` doesn't provide module-level declarations for them.
 * We bridge that gap here by re-exporting the source-level types.
 */

declare module "three/webgpu" {
  // Re-export everything from the main three.js namespace
  export * from "three";

  // WebGPU-specific exports
  export { default as WebGPURenderer } from "three/src/renderers/webgpu/WebGPURenderer.js";

  // Node materials
  export { default as MeshStandardNodeMaterial } from "three/src/materials/nodes/MeshStandardNodeMaterial.js";
  export { default as MeshBasicNodeMaterial } from "three/src/materials/nodes/MeshBasicNodeMaterial.js";
  export { default as NodeMaterial } from "three/src/materials/nodes/NodeMaterial.js";
}

declare module "three/tsl" {
  export * from "three/src/nodes/TSL.js";
}
