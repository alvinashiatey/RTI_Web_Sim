import {
  Vector2,
  Vector3,
  Box3,
  MeshStandardNodeMaterial,
  type Texture,
  type Mesh,
} from "three/webgpu";
import { Pane } from "tweakpane";
import type { FolderApi } from "tweakpane";
import type { Lights, LightParams } from "./lighting";
import { setLightPosition, syncHelper, DEFAULT_LIGHT_PARAMS } from "./lighting";
import {
  applyMaterialParams,
  DEFAULT_MATERIAL_PARAMS,
  type MaterialParams,
} from "./material";
import type { SceneContext } from "./scene";
import {
  EFFECT_MAP,
  EFFECT_NAMES,
  applyEffect,
  createEffectState,
  type EffectState,
} from "./effects";

export interface ControlState {
  pane: Pane;
  lightParams: LightParams;
  materialParams: MaterialParams;
  /** When true, mouse position drives light direction */
  mouseLight: { enabled: boolean };
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
  const mouseLight = { enabled: false };
  const effectState = createEffectState();

  const material = plane.material as MeshStandardNodeMaterial;

  // Build the control state object early so reapplyEffect can
  // read originalTexture / pixelSize from the same object
  // that main.ts writes to.
  const state: ControlState = {
    pane,
    lightParams,
    materialParams,
    mouseLight,
    effectState,
    reapplyEffect,
    saveSnapshot: () => saveSnapshot(ctx),
    originalTexture: null,
    pixelSize: new Vector2(1 / 1024, 1 / 1024), // sensible default
  };

  /** Re-apply the current effect (call on effect selection or texture swap). */
  function reapplyEffect(): void {
    applyEffect(effectState, material, state.originalTexture, state.pixelSize);
  }

  // ── Mouse → Light toggle ───────────────────────────────
  const lightDir = pane.addFolder({ title: "Light Direction" });

  lightDir.addBinding(mouseLight, "enabled", { label: "Mouse → Light" });

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

  // ── Save & Share folder (Phase 6) ──────────────────────
  const saveFolder = pane.addFolder({ title: "Save & Share" });

  // Snapshot
  saveFolder.addButton({ title: "Save Snapshot" }).on("click", () => {
    saveSnapshot(ctx);
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

// ── Phase 6 helpers ──────────────────────────────────────

/**
 * Save a cropped snapshot of just the image plane (no background).
 *
 * Projects the plane's world-space bounding box corners into screen
 * pixels, computes the visible rectangle, then draws that sub-region
 * of the renderer canvas onto a temporary canvas for export.
 */
function saveSnapshot(ctx: SceneContext): void {
  const { renderer, camera, plane, scene, controls } = ctx;

  // WebGPU discards the framebuffer after presentation, so the canvas
  // is blank unless we render a fresh frame right before reading it.
  controls.update();
  renderer.renderAsync(scene, camera).then(() => {
    _captureCanvas(renderer, camera, plane);
  });
}

/** Internal: read the renderer canvas and export a cropped PNG. */
function _captureCanvas(
  renderer: SceneContext["renderer"],
  camera: SceneContext["camera"],
  plane: SceneContext["plane"],
): void {
  const canvas = renderer.domElement as HTMLCanvasElement;
  const w = canvas.width;
  const h = canvas.height;

  // Compute the plane's axis-aligned bounding box in world space
  const box = new Box3().setFromObject(plane);

  // Project all 8 corners (works even if the box is flat) to NDC
  const corners = [
    new Vector3(box.min.x, box.min.y, box.min.z),
    new Vector3(box.min.x, box.min.y, box.max.z),
    new Vector3(box.min.x, box.max.y, box.min.z),
    new Vector3(box.min.x, box.max.y, box.max.z),
    new Vector3(box.max.x, box.min.y, box.min.z),
    new Vector3(box.max.x, box.min.y, box.max.z),
    new Vector3(box.max.x, box.max.y, box.min.z),
    new Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const c of corners) {
    c.project(camera); // NDC: [-1,1]
    const sx = ((c.x + 1) / 2) * w;
    const sy = ((1 - c.y) / 2) * h; // flip Y
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
  }

  // Clamp to canvas bounds and round to whole pixels
  const sx = Math.max(0, Math.floor(minX));
  const sy = Math.max(0, Math.floor(minY));
  const sw = Math.min(w, Math.ceil(maxX)) - sx;
  const sh = Math.min(h, Math.ceil(maxY)) - sy;

  if (sw <= 0 || sh <= 0) {
    // Plane is off-screen — fall back to full canvas
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rti-snapshot-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
    return;
  }

  // Draw the cropped region to a temporary canvas
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  tmp.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

  tmp.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rti-snapshot-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/** Serializable settings object. */
interface SettingsJSON {
  light: LightParams;
  material: MaterialParams;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  /** Active effect and its params (Phase 8) */
  effect?: { name: string; params: Record<string, unknown> };
}

function gatherSettings(
  lightParams: LightParams,
  materialParams: MaterialParams,
  lights: Lights,
  colorObj: { color: string },
  eState: EffectState,
): SettingsJSON {
  return {
    light: { ...lightParams },
    material: { ...materialParams },
    lightIntensity: lights.pointLight.intensity,
    lightColor: colorObj.color,
    ambientIntensity: lights.ambientLight.intensity,
    effect:
      eState.selected !== "None"
        ? { name: eState.selected, params: { ...eState.params } }
        : undefined,
  };
}

/** Download current settings as a JSON file. */
function exportSettings(
  lightParams: LightParams,
  materialParams: MaterialParams,
  lights: Lights,
  colorObj: { color: string },
  eState: EffectState,
): void {
  const json = JSON.stringify(
    gatherSettings(lightParams, materialParams, lights, colorObj, eState),
    null,
    2,
  );
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rti-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Open a JSON file and restore all parameters. */
function importSettings(
  lightParams: LightParams,
  materialParams: MaterialParams,
  lights: Lights,
  colorObj: { color: string },
  pane: Pane,
  material: MeshStandardNodeMaterial,
  eState: EffectState,
  effectPick: { selected: string },
  rebuildFn: () => void,
): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as SettingsJSON;
        applySettingsData(
          data,
          lightParams,
          materialParams,
          lights,
          colorObj,
          material,
          eState,
          effectPick,
          rebuildFn,
        );
        pane.refresh();
      } catch (e) {
        console.error("Invalid settings file:", e);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/** Apply a SettingsJSON object to all live parameters. */
function applySettingsData(
  data: SettingsJSON,
  lightParams: LightParams,
  materialParams: MaterialParams,
  lights: Lights,
  colorObj: { color: string },
  material: MeshStandardNodeMaterial,
  eState?: EffectState,
  effectPick?: { selected: string },
  rebuildFn?: () => void,
): void {
  // Light direction
  if (data.light) {
    Object.assign(lightParams, data.light);
    setLightPosition(lights.pointLight, lightParams);
    syncHelper(lights);
  }
  // Material
  if (data.material) {
    Object.assign(materialParams, data.material);
    applyMaterialParams(material, materialParams);
  }
  // Light properties
  if (data.lightIntensity != null)
    lights.pointLight.intensity = data.lightIntensity;
  if (data.lightColor) {
    colorObj.color = data.lightColor;
    lights.pointLight.color.set(data.lightColor);
  }
  if (data.ambientIntensity != null)
    lights.ambientLight.intensity = data.ambientIntensity;
  // Effect (Phase 8)
  if (eState && effectPick && rebuildFn) {
    const name = data.effect?.name ?? "None";
    effectPick.selected = name;
    eState.selected = name;
    if (data.effect?.params) {
      eState.params = { ...data.effect.params };
    }
    rebuildFn();
  }
}

/** Encode current settings into a URL hash and copy to clipboard. */
function copyShareableLink(
  lightParams: LightParams,
  materialParams: MaterialParams,
  lights: Lights,
  colorObj: { color: string },
  eState: EffectState,
): void {
  const data = gatherSettings(
    lightParams,
    materialParams,
    lights,
    colorObj,
    eState,
  );
  const encoded = btoa(JSON.stringify(data));
  const url = `${window.location.origin}${window.location.pathname}#settings=${encoded}`;
  navigator.clipboard.writeText(url).then(() => {
    console.log("Shareable link copied to clipboard");
  });
}

/** On page load, check the URL hash for encoded settings and restore them. */
function restoreFromHash(
  lightParams: LightParams,
  materialParams: MaterialParams,
  lights: Lights,
  colorObj: { color: string },
  pane: Pane,
  material: MeshStandardNodeMaterial,
  eState: EffectState,
  effectPick: { selected: string },
  rebuildFn: () => void,
): void {
  const hash = window.location.hash;
  const prefix = "#settings=";
  if (!hash.startsWith(prefix)) return;
  try {
    const json = atob(hash.slice(prefix.length));
    const data = JSON.parse(json) as SettingsJSON;
    // Defer so other init finishes first
    requestAnimationFrame(() => {
      applySettingsData(
        data,
        lightParams,
        materialParams,
        lights,
        colorObj,
        material,
        eState,
        effectPick,
        rebuildFn,
      );
      pane.refresh();
    });
  } catch (e) {
    console.warn("Could not restore settings from URL:", e);
  }
}
