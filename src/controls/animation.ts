import type { Pane } from "tweakpane";
import type { Lights, LightParams } from "../lighting";
import { setLightPosition, syncHelper } from "../lighting";
import type { SceneContext } from "../scene";
import { exportAnimationFrames } from "./export-frames";

export interface AnimParams {
  startAzimuth: number;
  endAzimuth: number;
  steps: number;
  duration: number;
}

/**
 * Build the Animation folder in the Tweakpane panel and wire up
 * play / stop / export-frames buttons.
 */
export function buildAnimationFolder(
  pane: Pane,
  lightParams: LightParams,
  lights: Lights,
  ctx: SceneContext,
): void {
  const animFolder = pane.addFolder({ title: "Animation" });

  const animParams: AnimParams = {
    startAzimuth: 0,
    endAzimuth: 360,
    steps: 36,
    duration: 3.0,
  };

  animFolder.addBinding(animParams, "startAzimuth", {
    min: 0,
    max: 360,
    step: 1,
    label: "Start (°)",
  });
  animFolder.addBinding(animParams, "endAzimuth", {
    min: 0,
    max: 360,
    step: 1,
    label: "End (°)",
  });
  animFolder.addBinding(animParams, "steps", {
    min: 2,
    max: 360,
    step: 1,
    label: "Steps",
  });
  animFolder.addBinding(animParams, "duration", {
    min: 0.5,
    max: 30,
    step: 0.5,
    label: "Duration (s)",
  });

  let animId: number | null = null;

  function stopAnimation(): void {
    if (animId != null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  function playAnimation(): void {
    stopAnimation();
    const { startAzimuth, endAzimuth, steps, duration } = animParams;
    const totalMs = duration * 1000;
    const startTime = performance.now();

    function tick(): void {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / totalMs, 1);

      // Current step index (0-based)
      const stepIdx = Math.min(Math.floor(t * steps), steps - 1);
      const fraction = stepIdx / Math.max(steps - 1, 1);

      // Interpolate azimuth along the shortest or specified arc
      lightParams.azimuth =
        startAzimuth + (endAzimuth - startAzimuth) * fraction;
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
      pane.refresh();

      if (t < 1) {
        animId = requestAnimationFrame(tick);
      } else {
        animId = null;
      }
    }

    animId = requestAnimationFrame(tick);
  }

  const playBtn = animFolder
    .addButton({ title: "▶  Play" })
    .on("click", playAnimation);
  const stopBtn = animFolder
    .addButton({ title: "■  Stop" })
    .on("click", stopAnimation);

  // Lay out Play / Stop on the same row
  {
    const playEl = playBtn.element;
    const stopEl = stopBtn.element;
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "2px";
    playEl.parentElement!.insertBefore(row, playEl);
    row.appendChild(playEl);
    row.appendChild(stopEl);
    playEl.style.flex = "1";
    stopEl.style.flex = "1";
  }

  // Export all animation frames as a ZIP
  const exportFramesBtn = animFolder.addButton({
    title: "Export Frames",
  });
  let exporting = false;
  exportFramesBtn.on("click", async () => {
    if (exporting) return;
    exporting = true;
    const savedAzimuth = lightParams.azimuth;
    exportFramesBtn.title = "Exporting… 0%";
    try {
      await exportAnimationFrames(
        ctx,
        lightParams,
        lights,
        pane,
        animParams,
        (pct) => {
          exportFramesBtn.title = `Exporting… ${pct}%`;
        },
      );
    } finally {
      // Restore the user's original light position
      lightParams.azimuth = savedAzimuth;
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
      pane.refresh();
      exportFramesBtn.title = "Export Frames";
      exporting = false;
    }
  });
}
