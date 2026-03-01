import type { SceneContext } from "../scene";
import {
  computePlaneScreenRect,
  drawImageCrop,
  canvasToBlob,
  downloadBlob,
} from "./capture-utils";

/**
 * Apply subtle ordered dithering to reduce visible gradient banding
 * when exporting 8-bit PNG snapshots.
 */
// function applyOrderedDither(
//   ctx: CanvasRenderingContext2D,
//   width: number,
//   height: number,
//   strength: number = 1.5,
// ): void {
//   const image = ctx.getImageData(0, 0, width, height);
//   const data = image.data;

//   const bayer8 = [
//     0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52,
//     11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23, 2, 50, 14, 62, 1, 49, 13, 61,
//     34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22,
//     41, 25, 37, 21,
//   ];

//   for (let y = 0; y < height; y++) {
//     for (let x = 0; x < width; x++) {
//       const i = (y * width + x) * 4;
//       const t = (bayer8[(y & 7) * 8 + (x & 7)] / 64 - 0.5) * strength;
//       data[i] = Math.max(0, Math.min(255, Math.round(data[i] + t)));
//       data[i + 1] = Math.max(0, Math.min(255, Math.round(data[i + 1] + t)));
//       data[i + 2] = Math.max(0, Math.min(255, Math.round(data[i + 2] + t)));
//     }
//   }

//   ctx.putImageData(image, 0, 0);
// }

/**
 * Save a cropped snapshot of the image plane.
 */
export async function saveSnapshot(
  ctx: SceneContext,
  onAfter?: () => void,
): Promise<void> {
  const { renderer, camera, plane, scene, controls } = ctx;

  // Render a fresh frame before snapshotting.
  controls.update();
  renderer.render(scene, camera);

  const canvas = renderer.domElement as HTMLCanvasElement;
  const w = canvas.width;
  const h = canvas.height;
  const bounds = computePlaneScreenRect(camera, plane, w, h);

  const cropped = drawImageCrop(canvas, bounds, {
    colorSpace: "display-p3",
    alpha: true,
  } as CanvasRenderingContext2DSettings);

  const blob = await canvasToBlob(cropped, "image/png", 1);
  if (blob) downloadBlob(blob, `rti-snapshot-${Date.now()}.png`);
  onAfter?.();
}
