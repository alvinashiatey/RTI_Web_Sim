import { Vector2, MeshStandardNodeMaterial, type Texture } from "three/webgpu";
import {
  texture,
  uv,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  dot,
  mix,
  step,
  clamp,
  max,
  sqrt,
  normalize,
  floor,
  fract,
  length,
  smoothstep,
} from "three/tsl";
import type Node from "three/src/nodes/core/Node.js";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import type { FolderApi } from "tweakpane";

// ── Types ────────────────────────────────────────────────

/** A live TSL effect instance attached to a material. */
export interface EffectInstance {
  /** The TSL node to assign to `material.colorNode`. */
  colorNode: Node;
  /** Update the source texture reference (call on image swap). */
  updateTexture(tex: Texture): void;
  /** Read current uniform values for serialisation. */
  getParams(): Record<string, unknown>;
  /** Write uniform values (for settings restore). */
  setParams(params: Record<string, unknown>): void;
}

export interface Effect {
  /** Display name shown in the dropdown. */
  name: string;
  /** Default parameter values. */
  defaults(): Record<string, unknown>;
  /**
   * Build the TSL node graph for this effect.
   * `tex` is the current diffuse texture; `pixelSize` is 1/resolution.
   */
  createNode(tex: Texture, pixelSize: Vector2): EffectInstance;
  /** Build Tweakpane controls that drive the TSL uniforms. */
  buildUI(folder: FolderApi, instance: EffectInstance): void;
}

// ── BT.601 luminance weights (reused across effects) ─────
const LUMA_WEIGHTS = vec3(0.299, 0.587, 0.114);

// Helper: sample a texture at UV + offset and return grayscale luminance
function sampleGray(tex: TextureNode, offset: ReturnType<typeof vec2>) {
  return dot(tex.sample(uv().add(offset)).rgb, LUMA_WEIGHTS);
}

// ── Built-in effects ─────────────────────────────────────

// 1. Normal Map Visualisation ─────────────────────────────

const normalMapVis: Effect = {
  name: "Normal Map",
  defaults: () => ({ strength: 2.0 }),

  createNode(tex, pixelSize) {
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
      updateTexture(t) {
        mapTex.value = t;
      },
      getParams: () => ({ strength: strengthU.value }),
      setParams(p) {
        if (p.strength != null) strengthU.value = p.strength as number;
      },
    };
  },

  buildUI(folder, instance) {
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

// 2. Sobel Edge Detection ─────────────────────────────────

const sobelEdge: Effect = {
  name: "Sobel Edge",
  defaults: () => ({ threshold: 0.1, invert: false }),

  createNode(tex, pixelSize) {
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
      updateTexture(t) {
        mapTex.value = t;
      },
      getParams: () => ({
        threshold: thresholdU.value,
        invert: (invertU.value as number) > 0.5,
      }),
      setParams(p) {
        if (p.threshold != null) thresholdU.value = p.threshold as number;
        if (p.invert != null) invertU.value = (p.invert as boolean) ? 1.0 : 0.0;
      },
    };
  },

  buildUI(folder, instance) {
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

// 3. Emboss ───────────────────────────────────────────────

const emboss: Effect = {
  name: "Emboss",
  defaults: () => ({ strength: 1.0, angle: 135 }),

  createNode(tex, pixelSize) {
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
      updateTexture(t) {
        mapTex.value = t;
      },
      getParams: () => ({ strength: strengthU.value, angle: angleU.value }),
      setParams(p) {
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

  buildUI(folder, instance) {
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

// 4. Grayscale ────────────────────────────────────────────

const grayscale: Effect = {
  name: "Grayscale",
  defaults: () => ({ rWeight: 0.299, gWeight: 0.587, bWeight: 0.114 }),

  createNode(tex) {
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
      updateTexture(t) {
        mapTex.value = t;
      },
      getParams: () => ({
        rWeight: rW.value,
        gWeight: gW.value,
        bWeight: bW.value,
      }),
      setParams(p) {
        if (p.rWeight != null) rW.value = p.rWeight as number;
        if (p.gWeight != null) gW.value = p.gWeight as number;
        if (p.bWeight != null) bW.value = p.bWeight as number;
      },
    };
  },

  buildUI(folder, instance) {
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

// 5. Chromatic Aberration ─────────────────────────────────

const chromaticAberration: Effect = {
  name: "Chromatic Aberration",
  defaults: () => ({ intensity: 0.01, centerX: 0.5, centerY: 0.5 }),

  createNode(tex) {
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
      updateTexture(t) {
        mapTex.value = t;
      },
      getParams: () => ({
        intensity: intensityU.value,
        centerX: (centerU.value as Vector2).x,
        centerY: (centerU.value as Vector2).y,
      }),
      setParams(p) {
        if (p.intensity != null) intensityU.value = p.intensity as number;
        const cv = centerU.value as Vector2;
        if (p.centerX != null) cv.x = p.centerX as number;
        if (p.centerY != null) cv.y = p.centerY as number;
      },
    };
  },

  buildUI(folder, instance) {
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

// 6. Halftone ─────────────────────────────────────────────

const halftone: Effect = {
  name: "Halftone",
  defaults: () => ({ dotSize: 8.0, angle: 45, colorMode: 0 }),

  createNode(tex, pixelSize) {
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
      updateTexture(t) {
        mapTex.value = t;
      },
      getParams: () => ({
        dotSize: dotSizeU.value,
        angle: angleU.value,
        colorMode: (colorModeU.value as number) > 0.5,
      }),
      setParams(p) {
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

  buildUI(folder, instance) {
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

// ── Effect registry ──────────────────────────────────────

/** All available effects in order. */
export const EFFECTS: Effect[] = [
  normalMapVis,
  sobelEdge,
  emboss,
  grayscale,
  chromaticAberration,
  halftone,
];

/** Lookup map for quick access by name. */
export const EFFECT_MAP = new Map<string, Effect>(
  EFFECTS.map((e) => [e.name, e]),
);

/** Name list including the "None" passthrough. */
export const EFFECT_NAMES = ["None", ...EFFECTS.map((e) => e.name)];

// ── Effect state ─────────────────────────────────────────

export interface EffectState {
  /** Currently selected effect name ("None" if disabled). */
  selected: string;
  /** Live effect instance (null when "None"). */
  instance: EffectInstance | null;
  /** Serialisable params (kept in sync with instance). */
  params: Record<string, unknown>;
}

export function createEffectState(): EffectState {
  return { selected: "None", instance: null, params: {} };
}

/**
 * Apply or remove the active effect on the given node material.
 *
 * With TSL the effect runs entirely on the GPU — parameter
 * changes only update uniform values and never trigger a
 * pixel-by-pixel CPU reprocess.
 */
export function applyEffect(
  state: EffectState,
  material: MeshStandardNodeMaterial,
  currentTexture: Texture | null,
  pixelSize: Vector2,
): void {
  if (state.selected === "None" || !currentTexture) {
    // Restore default texture-based colour
    if (material.colorNode != null) {
      material.colorNode = null;
      material.needsUpdate = true;
    }
    state.instance = null;
    return;
  }

  const effect = EFFECT_MAP.get(state.selected);
  if (!effect) return;

  // Build a fresh node graph
  const inst = effect.createNode(currentTexture, pixelSize);

  // Restore any previously serialised params
  if (Object.keys(state.params).length > 0) {
    inst.setParams(state.params);
  }

  state.instance = inst;
  material.colorNode = inst.colorNode;
  material.needsUpdate = true;
}
