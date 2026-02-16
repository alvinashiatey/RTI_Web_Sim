import {
  Vector2,
  MeshStandardNodeMaterial,
  type Texture,
  type Mesh,
} from "three/webgpu";
import { Pane } from "tweakpane";
import type { FolderApi } from "tweakpane";
import type { Lights, LightParams } from "../lighting";
import {
  setLightPosition,
  syncHelper,
  DEFAULT_LIGHT_PARAMS,
} from "../lighting";
import {
  applyMaterialParams,
  DEFAULT_MATERIAL_PARAMS,
  type MaterialParams,
} from "../material";
import type { SceneContext } from "../scene";
import {
  EFFECT_MAP,
  EFFECT_NAMES,
  applyEffect,
  createEffectState,
  type EffectState,
} from "../effects";
import { saveSnapshot } from "./snapshot";
import {
  exportSettings,
  importSettings,
  copyShareableLink,
  restoreFromHash,
} from "./settings";
import { buildAnimationFolder } from "./animation";

export interface ControlState {
  pane: Pane;
  lightParams: LightParams;
  materialParams: MaterialParams;
  /** Image effects pipeline state */
  effectState: EffectState;
  /** Re-apply the active effect (call after effect/texture change) */
  reapplyEffect: () => void;
  /** Save a cropped snapshot of just the image plane */
  saveSnapshot: () => void;
  /** The original (unprocessed) texture — set by main.ts on upload */
  originalTexture: Texture | null;
  /** 1/resolution for effect kernel sampling */
  pixelSize: Vector2;
}

/**
 * Create the Tweakpane UI and bind every control to its
 * corresponding Three.js property for real-time updates.
 */
export function initControls(
  plane: Mesh,
  lights: Lights,
  ctx: SceneContext,
): ControlState {
  const pane = new Pane({ title: "RTI Controls" });

  const lightParams: LightParams = { ...DEFAULT_LIGHT_PARAMS };
  const materialParams: MaterialParams = { ...DEFAULT_MATERIAL_PARAMS };
  const effectState = createEffectState();

  const material = plane.material as MeshStandardNodeMaterial;

  // Build the control state object early so reapplyEffect can
  // read originalTexture / pixelSize from the same object
  // that main.ts writes to.
  const state: ControlState = {
    pane,
    lightParams,
    materialParams,
    effectState,
    reapplyEffect,
    saveSnapshot: () => saveSnapshot(ctx, () => reapplyEffect()),
    originalTexture: null,
    pixelSize: new Vector2(1 / 1024, 1 / 1024), // sensible default
  };

  /** Re-apply the current effect (call on effect selection or texture swap). */
  function reapplyEffect(): void {
    applyEffect(effectState, material, state.originalTexture, state.pixelSize);
  }

  // ── Light Direction folder ─────────────────────────────
  const lightDir = pane.addFolder({ title: "Light Direction" });

  lightDir
    .addBinding(lightParams, "azimuth", {
      min: 0,
      max: 360,
      step: 1,
      label: "Azimuth (°)",
    })
    .on("change", () => {
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
    });

  lightDir
    .addBinding(lightParams, "elevation", {
      min: 0,
      max: 90,
      step: 1,
      label: "Elevation (°)",
    })
    .on("change", () => {
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
    });

  // ── Light Properties folder ────────────────────────────
  const lightProps = pane.addFolder({ title: "Light Properties" });

  lightProps.addBinding(lights.pointLight, "intensity", {
    min: 0,
    max: 5,
    step: 0.05,
    label: "Intensity",
  });

  const colorObj = { color: "#ffffff" };
  lightProps
    .addBinding(colorObj, "color", { label: "Color" })
    .on("change", (ev) => {
      lights.pointLight.color.set(ev.value);
    });

  // ── Ambient Light ──────────────────────────────────────
  lightProps.addBinding(lights.ambientLight, "intensity", {
    min: 0,
    max: 2,
    step: 0.05,
    label: "Ambient",
  });

  // ── Material folder ────────────────────────────────────
  const matFolder = pane.addFolder({ title: "Material" });

  matFolder
    .addBinding(materialParams, "roughness", {
      min: 0,
      max: 1,
      step: 0.01,
      label: "Roughness",
    })
    .on("change", () => applyMaterialParams(material, materialParams));

  matFolder
    .addBinding(materialParams, "metalness", {
      min: 0,
      max: 1,
      step: 0.01,
      label: "Metalness",
    })
    .on("change", () => applyMaterialParams(material, materialParams));

  matFolder
    .addBinding(materialParams, "normalScale", {
      min: 0,
      max: 3,
      step: 0.05,
      label: "Normal Intensity",
    })
    .on("change", () => applyMaterialParams(material, materialParams));

  matFolder
    .addBinding(materialParams, "bumpScale", {
      min: 0,
      max: 0.5,
      step: 0.005,
      label: "Bump Scale",
    })
    .on("change", () => applyMaterialParams(material, materialParams));

  // ── Effects folder (Phase 8) ───────────────────────────
  const effectsFolder = pane.addFolder({ title: "Effects" });

  // Dropdown binding object (Tweakpane needs an object property)
  const effectPick = { selected: effectState.selected };
  let effectParamsFolder: FolderApi | null = null;

  function rebuildEffectUI(): void {
    // Remove old params folder if present
    if (effectParamsFolder) {
      effectsFolder.remove(effectParamsFolder);
      effectParamsFolder = null;
    }

    const effectName = effectPick.selected;
    effectState.selected = effectName;

    if (effectName === "None") {
      effectState.params = {};
      reapplyEffect();
      return;
    }

    const effect = EFFECT_MAP.get(effectName);
    if (!effect) return;

    effectState.params = effect.defaults();

    // Build the TSL node graph and assign colorNode
    reapplyEffect();

    // Build Tweakpane UI wired directly to TSL uniforms
    if (effectState.instance) {
      effectParamsFolder = effectsFolder.addFolder({
        title: `${effectName} Params`,
      });
      effect.buildUI(effectParamsFolder, effectState.instance);
    }
  }

  effectsFolder
    .addBinding(effectPick, "selected", {
      label: "Effect",
      options: Object.fromEntries(EFFECT_NAMES.map((n) => [n, n])),
    })
    .on("change", () => {
      rebuildEffectUI();
    });

  // ── Animation folder ───────────────────────────────────
  buildAnimationFolder(pane, lightParams, lights, ctx);

  // ── Save & Share folder (Phase 6) ──────────────────────
  const saveFolder = pane.addFolder({ title: "Save & Share" });

  // Snapshot
  saveFolder.addButton({ title: "Save Snapshot" }).on("click", () => {
    saveSnapshot(ctx, () => reapplyEffect());
  });

  // Export settings
  saveFolder.addButton({ title: "Export Settings" }).on("click", () => {
    exportSettings(lightParams, materialParams, lights, colorObj, effectState);
  });

  // Import settings
  saveFolder.addButton({ title: "Import Settings" }).on("click", () => {
    importSettings(
      lightParams,
      materialParams,
      lights,
      colorObj,
      pane,
      material,
      effectState,
      effectPick,
      rebuildEffectUI,
    );
  });

  // Copy shareable link
  saveFolder.addButton({ title: "Copy Shareable Link" }).on("click", () => {
    copyShareableLink(
      lightParams,
      materialParams,
      lights,
      colorObj,
      effectState,
    );
  });

  // ── Restore from URL hash on first load ────────────────
  restoreFromHash(
    lightParams,
    materialParams,
    lights,
    colorObj,
    pane,
    material,
    effectState,
    effectPick,
    rebuildEffectUI,
  );

  return state;
}
