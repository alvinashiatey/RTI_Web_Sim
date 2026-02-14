import { Vector3, Box3 } from "three/webgpu";
import type { SceneContext } from "../scene";

/**
 * Save a cropped snapshot of just the image plane (no background).
 *
 * Projects the plane's world-space bounding box corners into screen
 * pixels, computes the visible rectangle, then draws that sub-region
 * of the renderer canvas onto a temporary canvas for export.
 */
export function saveSnapshot(ctx: SceneContext): void {
  const { renderer, camera, plane, scene, controls } = ctx;
  // WebGPU discards the framebuffer after presentation, so the canvas
  // is blank unless we render a fresh frame right before reading it.
  controls.update();
  renderer.render(scene, camera);
  _captureCanvas(renderer, camera, plane);
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
