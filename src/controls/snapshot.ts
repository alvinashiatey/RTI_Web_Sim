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
 *
 * Improvements compared to the previous implementation:
 * - Capture rendered output via a high-precision Float RenderTarget so the
 *   renderer's full output pipeline (toneMapping + sRGB encoding) is used.
 * - Enable `material.dithering` for the plane while capturing.
 * - Apply subtle ordered (Bayer) dithering when converting to 8-bit to
 *   remove banding without changing appearance in the live canvas.
 * - Avoid any color-space double-conversion by reading GPU float pixels and
 *   writing sRGB 8-bit pixels directly into ImageData.
 */
export function saveSnapshot(ctx: SceneContext): void {
  const { renderer, camera, plane, scene, controls } = ctx;

  // Local helpers: 8×8 Bayer ordered-dither matrix (normalised 0..1)
  // (Copied from export-frames.ts — small, well-tested matrix.)
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

  // Slightly stronger ordered-dither to further reduce residual banding
  const DITHER_STRENGTH = 1.5;

  function floatToDitheredUint8(
    src: Float32Array,
    width: number,
    height: number,
    alignedFloatsPerRow: number,
  ): Uint8ClampedArray {
    const dst = new Uint8ClampedArray(width * height * 4);
    const dstStride = width * 4;

    for (let y = 0; y < height; y++) {
      const srcY = height - 1 - y; // GPU readback is bottom-to-top
      const srcRowOff = srcY * alignedFloatsPerRow;
      const dstRowOff = y * dstStride;

      for (let x = 0; x < width; x++) {
        const si = srcRowOff + x * 4;
        const di = dstRowOff + x * 4;

        // Bayer threshold centred on 0 → range ≈ [-0.5 … +0.48], scaled
        const t = (BAYER8[(y & 7) * 8 + (x & 7)] / 64.0 - 0.5) * DITHER_STRENGTH;

        // Apply the ordered dither to RGB; alpha is straight rounded.
        dst[di] = Math.max(0, Math.min(255, Math.round(src[si] * 255 + t)));
        dst[di + 1] = Math.max(
          0,
          Math.min(255, Math.round(src[si + 1] * 255 + t)),
        );
        dst[di + 2] = Math.max(
          0,
          Math.min(255, Math.round(src[si + 2] * 255 + t)),
        );
        dst[di + 3] = Math.max(0, Math.min(255, Math.round(src[si + 3] * 255)));
      }
    }

    return dst;
  }

  // Capture asynchronously but keep the public API synchronous (click handler
  // doesn't need a Promise). This avoids changing the ControlState signature.
  (async () => {
    // Temporarily enable per-material dithering for the plane to help the
    // renderer produce slightly-noisy outputs that reduce banding.
    const mat = plane.material as any;
    const prevDithering = mat?.dithering ?? false;
    if (mat) mat.dithering = true;

    // Create a high-precision RenderTarget and mark it as the renderer's
    // output target so toneMapping + output encoding are applied on the GPU.
    const canvas = renderer.domElement as HTMLCanvasElement;
    const w = canvas.width;
    const h = canvas.height;

    const bounds = computePlaneBounds(camera, plane, w, h);

    // Use a Float render target so we read tone-mapped *float* pixels from
    // the GPU (pre-8bit quantisation).  This exactly matches the live
    // appearance (tone mapping + output encoding) and prevents double
    // color-space conversions.
    const rt = new (await import("three/webgpu")).RenderTarget(w, h, {
      type: (await import("three/webgpu")).FloatType,
    });

    try {
      // Render through the full pipeline into the RT
      renderer.setOutputRenderTarget(rt);
      controls.update();
      // `render` issues the draw; subsequent readRenderTargetPixelsAsync
      // will wait for GPU completion where necessary.
      renderer.render(scene, camera);

      // If the plane is off-screen, capture the full canvas; otherwise
      // read only the cropped region for smaller downloads.
      if (!bounds) {
        const raw = await (renderer as any).readRenderTargetPixelsAsync(rt, 0, 0, w, h);

        const bytesPerTexel = 16; // RGBA32Float
        const alignedBytesPerRow = Math.ceil((w * bytesPerTexel) / 256) * 256;
        const alignedFloatsPerRow = alignedBytesPerRow / 4;

        const pixels = floatToDitheredUint8(raw as Float32Array, w, h, alignedFloatsPerRow);

        // Ensure a plain Uint8ClampedArray backed by an ArrayBuffer for ImageData
        // Copy into a fresh Uint8ClampedArray (ensures a plain ArrayBuffer-backed
        // buffer so the DOM ImageData constructor accepts it).
        let imagePixels = Uint8ClampedArray.from(pixels as Iterable<number>);

        // Detect/correct orientation mismatches (some backends / readbacks
        // may return flipped buffers). Compare a sample pixel from the
        // onscreen canvas to the captured buffer; if they mismatch in a
        // flipped position, rotate/flip the captured pixels accordingly.
        try {
          const probeCanvas = document.createElement("canvas");
          probeCanvas.width = canvas.width;
          probeCanvas.height = canvas.height;
          const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });
          if (probeCtx) probeCtx.drawImage(canvas, 0, 0);

          const sampleX = Math.max(1, Math.min(w - 2, Math.floor(w / 4)));
          const sampleY = Math.max(1, Math.min(h - 2, Math.floor(h / 4)));
          const screenSample = probeCtx?.getImageData(sampleX, sampleY, 1, 1).data;

          if (screenSample) {
            const getPixel = (arr: Uint8ClampedArray, x: number, y: number, width: number) => {
              const i = (y * width + x) * 4;
              return [arr[i], arr[i + 1], arr[i + 2], arr[i + 3]];
            };

            const close = (a: number[], b: Uint8ClampedArray, tol = 24) =>
              Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

            const cx = sampleX; // local coords for full-canvas capture
            const cy = sampleY;
            const captured = getPixel(imagePixels, cx, cy, w);

            if (!close(screenSample as unknown as number[], new Uint8ClampedArray(captured))) {
              // Check if rotated 180°
              const rot180 = getPixel(imagePixels, w - 1 - cx, h - 1 - cy, w);
              if (close(screenSample as unknown as number[], new Uint8ClampedArray(rot180))) {
                // rotate 180°
                const outArr = new Uint8ClampedArray(imagePixels.length);
                for (let yy = 0; yy < h; yy++) {
                  for (let xx = 0; xx < w; xx++) {
                    const si = (yy * w + xx) * 4;
                    const di = ((h - 1 - yy) * w + (w - 1 - xx)) * 4;
                    outArr[di] = imagePixels[si];
                    outArr[di + 1] = imagePixels[si + 1];
                    outArr[di + 2] = imagePixels[si + 2];
                    outArr[di + 3] = imagePixels[si + 3];
                  }
                }
                imagePixels = outArr;
              }
            }
          }
        } catch (e) {
          /* ignore detection errors — fall back to saving as-is */
        }

        const tmp = document.createElement("canvas");
        tmp.width = w;
        tmp.height = h;
        const ctx2d = tmp.getContext("2d");
        if (!ctx2d) throw new Error("Failed to create 2D context");
        ctx2d.putImageData(new ImageData(imagePixels, w, h), 0, 0);

        tmp.toBlob((blob) => {
          if (blob) downloadBlob(blob, `rti-snapshot-full-${Date.now()}.png`);
        }, "image/png");

        return;
      }

      // Read only the plane region (readRenderTargetPixelsAsync expects
      // bottom-left origin — flip Y from our top-left bounds).
      const rx = bounds.x;
      const ry = h - bounds.y - bounds.height;
      const rw = bounds.width;
      const rh = bounds.height;

      const raw = await (renderer as any).readRenderTargetPixelsAsync(
        rt,
        rx,
        ry,
        rw,
        rh,
      );

      const bytesPerTexel = 16; // RGBA32Float
      const alignedBytesPerRow = Math.ceil((rw * bytesPerTexel) / 256) * 256;
      const alignedFloatsPerRow = alignedBytesPerRow / 4;

      const pixels = floatToDitheredUint8(raw as Float32Array, rw, rh, alignedFloatsPerRow);
      let imagePixels = Uint8ClampedArray.from(pixels as Iterable<number>);

      // Orientation detection for cropped capture (compare onscreen sample
      // with captured buffer). If the captured buffer is rotated 180° we
      // rotate it back before saving.
      try {
        const probeCanvas = document.createElement("canvas");
        probeCanvas.width = canvas.width;
        probeCanvas.height = canvas.height;
        const probeCtx = probeCanvas.getContext("2d", { willReadFrequently: true });
        if (probeCtx) probeCtx.drawImage(canvas, 0, 0);

        const sampleX = Math.max(1, Math.min(bounds.x + Math.floor(rw / 4), canvas.width - 2));
        const sampleY = Math.max(1, Math.min(bounds.y + Math.floor(rh / 4), canvas.height - 2));
        const screenSample = probeCtx?.getImageData(sampleX, sampleY, 1, 1).data;

        if (screenSample) {
          const getPixel = (arr: Uint8ClampedArray, x: number, y: number, width: number) => {
            const i = (y * width + x) * 4;
            return [arr[i], arr[i + 1], arr[i + 2], arr[i + 3]];
          };

          const close = (a: number[], b: Uint8ClampedArray, tol = 24) =>
            Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

          const lx = sampleX - bounds.x;
          const ly = sampleY - bounds.y;
          const captured = getPixel(imagePixels, lx, ly, rw);

          if (!close(screenSample as unknown as number[], new Uint8ClampedArray(captured))) {
            const rot180 = getPixel(imagePixels, rw - 1 - lx, rh - 1 - ly, rw);
            if (close(screenSample as unknown as number[], new Uint8ClampedArray(rot180))) {
              const outArr = new Uint8ClampedArray(imagePixels.length);
              for (let yy = 0; yy < rh; yy++) {
                for (let xx = 0; xx < rw; xx++) {
                  const si = (yy * rw + xx) * 4;
                  const di = ((rh - 1 - yy) * rw + (rw - 1 - xx)) * 4;
                  outArr[di] = imagePixels[si];
                  outArr[di + 1] = imagePixels[si + 1];
                  outArr[di + 2] = imagePixels[si + 2];
                  outArr[di + 3] = imagePixels[si + 3];
                }
              }
              imagePixels = outArr;
            }
          }
        }
      } catch (e) {
        /* ignore detection errors */
      }

      // Create a small canvas (sRGB) and write the dithered ImageData.
      const out = document.createElement("canvas");
      out.width = rw;
      out.height = rh;
      const outCtx = out.getContext("2d");
      if (!outCtx) throw new Error("Failed to create 2D context");
      outCtx.putImageData(new ImageData(imagePixels, rw, rh), 0, 0);

      out.toBlob((blob) => {
        if (blob) downloadBlob(blob, `rti-snapshot-${Date.now()}.png`);
      }, "image/png");
    } catch (err) {
      console.error("Failed to capture snapshot via RenderTarget:", err);
      // Fall back to grabbing the visible canvas as-is (best-effort).
      canvas.toBlob((blob) => blob && downloadBlob(blob, `rti-snapshot-fallback-${Date.now()}.png`), "image/png");
    } finally {
      // Restore renderer output target and material dithering state.
      rt.dispose();
      renderer.setOutputRenderTarget(null);
      if (mat) mat.dithering = prevDithering;

      // Re-render a frame so the live canvas state is unaffected.
      controls.update();
      renderer.render(scene, camera);
    }
  })();
}
