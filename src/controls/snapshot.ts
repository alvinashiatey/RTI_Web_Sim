import { Vector3, Box3, RenderTarget, FloatType } from "three/webgpu";
import { startRenderLoop, type SceneContext } from "../scene";

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

let snapshotInProgress = false;

/**
 * Save a cropped snapshot of the image plane.
 *
 * Uses GPU readback from an offscreen float RenderTarget, which is reliable
 * for WebGPU canvases where 2D drawImage(canvas) can return blank pixels.
 */
export function saveSnapshot(ctx: SceneContext, onAfter?: () => void): void {
  if (snapshotInProgress) return;
  snapshotInProgress = true;

  const { renderer, camera, plane, scene, controls } = ctx;

  // prettier-ignore
  const BAYER8: number[] = [
    0, 48, 12, 60, 3, 51, 15, 63,
    32, 16, 44, 28, 35, 19, 47, 31,
    8, 56, 4, 52, 11, 59, 7, 55,
    40, 24, 36, 20, 43, 27, 39, 23,
    2, 50, 14, 62, 1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29,
    10, 58, 6, 54, 9, 57, 5, 53,
    42, 26, 38, 22, 41, 25, 37, 21,
  ];

  function floatToDitheredUint8(
    src: Float32Array,
    width: number,
    height: number,
    alignedFloatsPerRow: number,
  ): Uint8ClampedArray {
    const dst = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      // readRenderTargetPixelsAsync region already uses bottom-left origin via
      // `ry = h - bounds.y - bounds.height`, so applying another row flip here
      // causes a vertically inverted export on some WebGPU backends.
      const srcY = y;
      const srcRowOff = srcY * alignedFloatsPerRow;
      const dstRowOff = y * width * 4;
      for (let x = 0; x < width; x++) {
        const si = srcRowOff + x * 4;
        const di = dstRowOff + x * 4;
        const t = (BAYER8[(y & 7) * 8 + (x & 7)] / 64.0 - 0.5) * 1.5;
        dst[di] = Math.max(0, Math.min(255, Math.round(src[si] * 255 + t)));
        dst[di + 1] = Math.max(0, Math.min(255, Math.round(src[si + 1] * 255 + t)));
        dst[di + 2] = Math.max(0, Math.min(255, Math.round(src[si + 2] * 255 + t)));
        dst[di + 3] = Math.max(0, Math.min(255, Math.round(src[si + 3] * 255)));
      }
    }
    return dst;
  }

  (async () => {
    const canvas = renderer.domElement as HTMLCanvasElement;
    const w = canvas.width;
    const h = canvas.height;
    const bounds = computePlaneBounds(camera, plane, w, h);

    const rt = new RenderTarget(w, h, { type: FloatType });

    // Pause the main loop while we redirect output to a temporary RT.
    // This prevents render-target races that can leave post effects stale.
    renderer.setAnimationLoop(null);

    try {
      renderer.setOutputRenderTarget(rt);
      controls.update();
      renderer.render(scene, camera);

      const rx = bounds ? bounds.x : 0;
      const ry = bounds ? h - bounds.y - bounds.height : 0;
      const rw = bounds ? bounds.width : w;
      const rh = bounds ? bounds.height : h;

      const raw = await renderer.readRenderTargetPixelsAsync(rt, rx, ry, rw, rh);
      const bytesPerTexel = 16;
      const alignedBytesPerRow = Math.ceil((rw * bytesPerTexel) / 256) * 256;
      const alignedFloatsPerRow = alignedBytesPerRow / 4;
      const pixels = floatToDitheredUint8(raw as Float32Array, rw, rh, alignedFloatsPerRow);
      const imagePixels = Uint8ClampedArray.from(pixels as Iterable<number>);

      const out = document.createElement("canvas");
      out.width = rw;
      out.height = rh;
      const outCtx = out.getContext("2d");
      if (!outCtx) throw new Error("Failed to create 2D context");
      outCtx.putImageData(new ImageData(imagePixels, rw, rh), 0, 0);
      out.toBlob((blob) => blob && downloadBlob(blob, `rti-snapshot-${Date.now()}.png`), "image/png");
    } catch (err) {
      // Fallback is best-effort only; some WebGPU browsers return blank.
      console.warn("snapshot: GPU readback failed, using canvas fallback", err);
      canvas.toBlob((blob) => blob && downloadBlob(blob, `rti-snapshot-fallback-${Date.now()}.png`), "image/png");
    } finally {
      rt.dispose();
      renderer.setOutputRenderTarget(null);
      startRenderLoop(ctx);
      snapshotInProgress = false;
      onAfter?.();
    }
  })();
}
