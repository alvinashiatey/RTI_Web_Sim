import { MeshStandardNodeMaterial } from "three/webgpu";
import type { Pane } from "tweakpane";
import type { Lights, LightParams } from "../lighting";
import { setLightPosition, syncHelper } from "../lighting";
import { applyMaterialParams, type MaterialParams } from "../material";
import type { EffectState } from "../effects";

/** Serializable settings object. */
export interface SettingsJSON {
  light: LightParams;
  material: MaterialParams;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  /** Active effect and its params (Phase 8) */
  effect?: { name: string; params: Record<string, unknown> };
}

export function gatherSettings(
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
export function exportSettings(
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
export function importSettings(
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
export function applySettingsData(
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
export function copyShareableLink(
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
export function restoreFromHash(
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
