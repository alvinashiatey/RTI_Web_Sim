import { Vector3, Box3 } from "three/webgpu";
import type { SceneContext } from "../scene";

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the screen-space bounding rectangle of the plane.
 */
function computePlaneBounds(
  camera: SceneContext["camera"],
  plane: SceneContext["plane"],
  canvasWidth: number,
  canvasHeight: number,
): CropRect | null {
  const box = new Box3().setFromObject(plane);

  const corners: Vector3[] = [
    new Vector3(box.min.x, box.min.y, box.min.z),
    new Vector3(box.min.x, box.min.y, box.max.z),
    new Vector3(box.min.x, box.max.y, box.min.z),
    new Vector3(box.min.x, box.max.y, box.max.z),
    new Vector3(box.max.x, box.min.y, box.min.z),
    new Vector3(box.max.x, box.min.y, box.max.z),
    new Vector3(box.max.x, box.max.y, box.min.z),
    new Vector3(box.max.x, box.max.y, box.max.z),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const corner of corners) {
    corner.project(camera); // Mutates to NDC [-1, 1]
    const screenX = ((corner.x + 1) / 2) * canvasWidth;
    const screenY = ((1 - corner.y) / 2) * canvasHeight; // Flip Y
    minX = Math.min(minX, screenX);
    minY = Math.min(minY, screenY);
    maxX = Math.max(maxX, screenX);
    maxY = Math.max(maxY, screenY);
  }

  // Clamp to canvas bounds
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const width = Math.min(canvasWidth, Math.ceil(maxX)) - x;
  const height = Math.min(canvasHeight, Math.ceil(maxY)) - y;

  if (width <= 0 || height <= 0) {
    return null; // Off-screen
  }

  return { x, y, width, height };
}

/**
 * Download a blob as a file.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Apply subtle ordered dithering to reduce visible gradient banding
 * when exporting 8-bit PNG snapshots.
 */
function applyOrderedDither(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number = 1.5,
): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  const bayer8 = [
    0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52,
    11, 59, 7, 55, 40, 24, 36, 20, 43, 27, 39, 23, 2, 50, 14, 62, 1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6, 54, 9, 57, 5, 53, 42, 26, 38, 22,
    41, 25, 37, 21,
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = (bayer8[(y & 7) * 8 + (x & 7)] / 64 - 0.5) * strength;
      data[i] = Math.max(0, Math.min(255, Math.round(data[i] + t)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(data[i + 1] + t)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(data[i + 2] + t)));
    }
  }

  ctx.putImageData(image, 0, 0);
}

/**
 * Save a cropped snapshot of the image plane.
 */
export function saveSnapshot(ctx: SceneContext, onAfter?: () => void): void {
  const { renderer, camera, plane, scene, controls } = ctx;

  // Render a fresh frame before snapshotting.
  controls.update();
  renderer.render(scene, camera);

  const canvas = renderer.domElement as HTMLCanvasElement;
  const w = canvas.width;
  const h = canvas.height;
  const bounds = computePlaneBounds(camera, plane, w, h);

  if (!bounds) {
    canvas.toBlob(
      (blob) => {
        if (blob) downloadBlob(blob, `rti-snapshot-full-${Date.now()}.png`);
      },
      "image/png",
      1,
    );
    onAfter?.();
    return;
  }

  const out = document.createElement("canvas");
  out.width = bounds.width;
  out.height = bounds.height;

  const outCtx = out.getContext("2d", {
    colorSpace: "display-p3",
    alpha: true,
  } satisfies CanvasRenderingContext2DSettings);

  if (!outCtx) {
    console.error("snapshot: failed to create 2D context");
    onAfter?.();
    return;
  }

  outCtx.drawImage(
    canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );

  // Skip dithering when using display-p3 — getImageData returns
  // sRGB-converted bytes, so dithering corrupts wide-gamut colors
  // applyOrderedDither(outCtx, bounds.width, bounds.height);

  out.toBlob(
    (blob) => {
      if (blob) downloadBlob(blob, `rti-snapshot-${Date.now()}.png`);
    },
    "image/png",
    1,
  );
  onAfter?.();
}
