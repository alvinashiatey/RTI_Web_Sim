import "./style.css";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { createScene, startRenderLoop } from "./scene";
import {
  createLights,
  setLightPosition,
  syncHelper,
  DEFAULT_LIGHT_PARAMS,
} from "./lighting";
import { loadDefaultTexture } from "./material";
import { initControls } from "./controls";
import { initImageUpload } from "./utils";
import { EFFECT_NAMES } from "./effects";

// ── Bootstrap ────────────────────────────────────────────
const canvas = document.getElementById("rti-canvas") as HTMLCanvasElement;

if (!canvas) {
  throw new Error("Canvas element #rti-canvas not found");
}

// Show loading spinner
const spinner = document.getElementById("loading-spinner");
if (spinner) spinner.hidden = false;

(async () => {
  const ctx = await createScene(canvas);
  const lights = createLights(ctx.scene);

  // Initialize Tweakpane controls (Phase 4 + Phase 6)
  const controlState = initControls(ctx.plane, lights, ctx);

  // Initialize image upload (Phase 5) — pass callback so effects re-apply on swap
  initImageUpload(ctx.plane, controlState.materialParams, () => {
    // Update the original texture reference from the material
    const mat = ctx.plane.material as MeshStandardNodeMaterial;
    controlState.originalTexture = mat.map;

    // Update pixel size for kernel-based effects
    if (mat.map) {
      const img = mat.map.image as { width?: number; height?: number };
      if (img && img.width && img.height) {
        controlState.pixelSize.set(1 / img.width, 1 / img.height);
      }
    }

    // Update texture uniform on existing instance or rebuild
    if (controlState.effectState.instance && controlState.originalTexture) {
      controlState.effectState.instance.updateTexture(
        controlState.originalTexture,
      );
    } else {
      controlState.reapplyEffect();
    }
  });

  // ── Mouse → Light direction ──────────────────────────────
  canvas.addEventListener("mousemove", (e) => {
    if (!controlState.mouseLight.enabled) return;

    const rect = canvas.getBoundingClientRect();
    // Normalise mouse position to [-1, 1]
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;

    // Map to azimuth (0-360) and elevation (0-90)
    // nx: -1 (left, 180°) → +1 (right, 0°)
    // ny: -1 (top, 90° elev) → +1 (bottom, 0° elev)
    const azimuth = ((Math.atan2(-ny, nx) * 180) / Math.PI + 360) % 360;
    const elevation = (1 - Math.min(1, Math.sqrt(nx * nx + ny * ny))) * 90;

    controlState.lightParams.azimuth = azimuth;
    controlState.lightParams.elevation = elevation;
    setLightPosition(lights.pointLight, controlState.lightParams);
    syncHelper(lights);
    controlState.pane.refresh();
  });

  // ── Keyboard shortcuts (Phase 7) ─────────────────────────
  window.addEventListener("keydown", (e) => {
    // Ignore if user is typing in an input
    if ((e.target as HTMLElement).tagName === "INPUT") return;

    switch (e.key.toLowerCase()) {
      case "r":
        // Reset light to defaults
        Object.assign(controlState.lightParams, DEFAULT_LIGHT_PARAMS);
        setLightPosition(lights.pointLight, controlState.lightParams);
        syncHelper(lights);
        controlState.pane.refresh();
        showToast("Light reset");
        break;
      case "s":
        // Save snapshot (cropped to plane area)
        controlState.saveSnapshot();
        showToast("Snapshot saved");
        break;
      case "m":
        // Toggle mouse-light mode
        controlState.mouseLight.enabled = !controlState.mouseLight.enabled;
        controlState.pane.refresh();
        showToast(
          controlState.mouseLight.enabled
            ? "Mouse → Light ON"
            : "Mouse → Light OFF",
        );
        break;
      case "e": {
        // Cycle through effects
        const curIdx = EFFECT_NAMES.indexOf(controlState.effectState.selected);
        const nextIdx = (curIdx + 1) % EFFECT_NAMES.length;
        const nextName = EFFECT_NAMES[nextIdx];
        controlState.effectState.selected = nextName;
        controlState.reapplyEffect();
        controlState.pane.refresh();
        showToast(`Effect: ${nextName}`);
        break;
      }
      case "h":
      case "?":
        // Toggle help overlay
        toggleHelp();
        break;
    }
  });

  // ── Help overlay toggle ──────────────────────────────────
  function toggleHelp(): void {
    const overlay = document.getElementById("help-overlay");
    if (overlay) overlay.hidden = !overlay.hidden;
  }

  // Hook up close button
  const helpClose = document.getElementById("help-close");
  if (helpClose) helpClose.addEventListener("click", toggleHelp);

  const helpBtn = document.getElementById("help-btn");
  if (helpBtn) helpBtn.addEventListener("click", toggleHelp);

  // ── Toast notification helper ────────────────────────────
  function showToast(message: string): void {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    setTimeout(() => toast!.classList.remove("visible"), 1800);
  }

  // Load the default sample texture, then kick off the render loop
  loadDefaultTexture(ctx.plane)
    .then((texture) => {
      console.log("Default texture loaded — starting render loop");
      if (spinner) spinner.hidden = true;

      // Capture texture reference + pixel size for TSL effects
      controlState.originalTexture = texture;
      const img = texture.image as { width?: number; height?: number };
      if (img && img.width && img.height) {
        controlState.pixelSize.set(1 / img.width, 1 / img.height);
      }

      startRenderLoop(ctx);
    })
    .catch(() => {
      console.warn("Starting render loop without default texture");
      if (spinner) spinner.hidden = true;
      startRenderLoop(ctx);
    });
})(); // end async IIFE
