// three/webgpu imports not needed here anymore; capture helpers live in capture-utils.
import type { Pane } from "tweakpane";
import type { LightParams, Lights } from "../lighting";
import { setLightPosition, syncHelper } from "../lighting";
import { startRenderLoop, type SceneContext } from "../scene";
import { buildZip, type ZipEntry } from "./zip";
import {
  computePlaneScreenRect,
  drawImageCrop,
  canvasToBlob,
} from "./capture-utils";

// Plane-screen rectangle calculation moved to `capture-utils.ts`.
// Use `computePlaneScreenRect` from that module instead of this helper.

// Dithering/readback helpers removed — frames now capture from the
// visible canvas and video export was removed.

// Readback/orientation helpers removed — not used by frames capture.

/**
 * Render each animation step using the renderer's full output pipeline
 * (tone mapping + sRGB) into a high-precision offscreen RenderTarget,
 * read pixels from the GPU, apply ordered dithering, crop to the plane
 * region, encode as PNG, and bundle all frames into a ZIP download.
 */
export async function exportAnimationFrames(
  ctx: SceneContext,
  lightParams: LightParams,
  lights: Lights,
  _pane: Pane,
  animParams: {
    startAzimuth: number;
    endAzimuth: number;
    steps: number;
  },
  onProgress: (pct: number) => void,
): Promise<void> {
  const { renderer, camera, plane, scene, controls } = ctx;
  const { startAzimuth, endAzimuth, steps } = animParams;
  const padLen = String(steps).length;
  const entries: ZipEntry[] = [];

  // Pause the main animation loop so it doesn't race with our renders.
  renderer.setAnimationLoop(null);

  const canvas = renderer.domElement as HTMLCanvasElement;

  // Temporarily enable material dithering for the plane to further reduce
  // banding in combination with the ordered-dither pass below.
  const planeMat = plane.material as any;
  const prevDither = planeMat?.dithering ?? false;
  if (planeMat) planeMat.dithering = true;

  // Use the visible canvas as the output target; capture is done via
  // `drawImage` from the displayed canvas (no GPU readback here).

  // (readback orientation helpers are used by video export)

  try {
    for (let i = 0; i < steps; i++) {
      const fraction = i / Math.max(steps - 1, 1);
      lightParams.azimuth =
        startAzimuth + (endAzimuth - startAzimuth) * fraction;
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
      controls.update();

      // Render to the visible canvas and capture via drawImage (same path
      // as `saveSnapshot`), avoiding GPU readback + manual pixel reformat.
      renderer.setOutputRenderTarget(null);
      renderer.render(scene, camera);

      const bounds = computePlaneScreenRect(
        camera,
        plane,
        canvas.width,
        canvas.height,
      );
      const cropped = drawImageCrop(canvas, bounds, {
        colorSpace: "display-p3",
        alpha: true,
      } as CanvasRenderingContext2DSettings);

      const blob = await canvasToBlob(cropped, "image/png", 1);
      if (blob) {
        const data = new Uint8Array(await blob.arrayBuffer());
        const num = String(i + 1).padStart(padLen, "0");
        entries.push({ name: `frame_${num}.png`, data });
      }

      onProgress(Math.round(((i + 1) / steps) * 100));
    }
  } finally {
    // (no RT to dispose when using canvas capture path)
    // Restore material dithering state.
    if (planeMat) planeMat.dithering = prevDither;
    // Restore canvas as the output target and resume the render loop.
    renderer.setOutputRenderTarget(null);
    startRenderLoop(ctx);
  }

  if (entries.length === 0) return;

  const zip = buildZip(entries);
  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rti-frames-${Date.now()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
