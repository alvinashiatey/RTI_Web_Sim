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
 * Save a cropped snapshot of the image plane.
 */
export function saveSnapshot(ctx: SceneContext): void {
  const { renderer, camera, plane, scene, controls } = ctx;

  // Render a fresh frame (WebGPU discards after presentation)
  controls.update();
  renderer.render(scene, camera);

  const canvas = renderer.domElement as HTMLCanvasElement;
  const w = canvas.width;
  const h = canvas.height;

  const bounds = computePlaneBounds(camera, plane, w, h);

  if (!bounds) {
    // Plane is off-screen; save full canvas
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `rti-snapshot-full-${Date.now()}.png`);
      }
    }, "image/png");
    return;
  }

  // Create temporary canvas with matching color space
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = bounds.width;
  tempCanvas.height = bounds.height;

  // ✅ Critical: Match the WebGPU renderer's color space
  const ctx2d = tempCanvas.getContext("2d", {
    colorSpace: "display-p3", // Use "srgb" if your renderer uses SRGBColorSpace
    alpha: true,
  } satisfies CanvasRenderingContext2DSettings);

  if (!ctx2d) {
    console.error("Failed to create 2D context");
    return;
  }

  // Draw cropped region
  ctx2d.drawImage(
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

  // Export with maximum quality
  tempCanvas.toBlob(
    (blob) => {
      if (blob) {
        downloadBlob(blob, `rti-snapshot-${Date.now()}.png`);
      }
    },
    "image/png",
    1.0, // Quality parameter (though PNG ignores this, good practice)
  );
}
