import { Vector3, Box3, RenderTarget, FloatType } from "three/webgpu";
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

/**
 * Compute the plane's bounding rectangle on screen (in pixels).
 * Returns { sx, sy, sw, sh } clamped to canvas bounds, or null
 * if the plane is entirely off-screen.
 */
function _planeScreenRect(
  camera: SceneContext["camera"],
  plane: SceneContext["plane"],
  w: number,
  h: number,
): { sx: number; sy: number; sw: number; sh: number } | null {
  const box = new Box3().setFromObject(plane);
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
    c.project(camera);
    const px = ((c.x + 1) / 2) * w;
    const py = ((1 - c.y) / 2) * h;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }

  const sx = Math.max(0, Math.floor(minX));
  const sy = Math.max(0, Math.floor(minY));
  const sw = Math.min(w, Math.ceil(maxX)) - sx;
  const sh = Math.min(h, Math.ceil(maxY)) - sy;

  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}

// ── Bayer 8×8 ordered-dithering matrix (normalised to 0…1) ──
// prettier-ignore
const _BAYER8: number[] = [
   0, 48, 12, 60,  3, 51, 15, 63,
  32, 16, 44, 28, 35, 19, 47, 31,
   8, 56,  4, 52, 11, 59,  7, 55,
  40, 24, 36, 20, 43, 27, 39, 23,
   2, 50, 14, 62,  1, 49, 13, 61,
  34, 18, 46, 30, 33, 17, 45, 29,
  10, 58,  6, 54,  9, 57,  5, 53,
  42, 26, 38, 22, 41, 25, 37, 21,
];

/**
 * Convert a Float32 RGBA pixel buffer (bottom-to-top row order, possibly
 * row-padded to 256-byte alignment by WebGPU) into a top-to-bottom
 * Uint8ClampedArray suitable for ImageData, applying Bayer 8×8 ordered
 * dithering on the RGB channels to eliminate gradient banding.
 */
function _floatToDitheredUint8(
  src: Float32Array,
  width: number,
  height: number,
  alignedFloatsPerRow: number,
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(width * height * 4);
  const dstStride = width * 4;

  for (let y = 0; y < height; y++) {
    // Flip Y: GPU readback is bottom-to-top, PNG needs top-to-bottom.
    const srcY = height - 1 - y;
    const srcRowOff = srcY * alignedFloatsPerRow;
    const dstRowOff = y * dstStride;

    for (let x = 0; x < width; x++) {
      const si = srcRowOff + x * 4;
      const di = dstRowOff + x * 4;

      // Bayer threshold centred on 0  →  range ≈ [-0.5 … +0.48], scale up slightly
      const t = (_BAYER8[(y & 7) * 8 + (x & 7)] / 64.0 - 0.5) * 1.5;

      // RGB: dither.  Alpha: straight round.
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

/* -------------------------------------------------------------------------- */
/*                            Readback orientation                             */
/* -------------------------------------------------------------------------- */

type _ReadbackOrientation = "normal" | "flipX" | "flipY" | "flipXY";

function _clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function _buildSamplePoints(
  canvasW: number,
  canvasH: number,
  bounds: { sx: number; sy: number; sw: number; sh: number } | null,
): Array<[number, number]> {
  if (bounds) {
    const { sx, sy, sw, sh } = bounds;
    return [
      [sx + Math.floor(sw * 0.25), sy + Math.floor(sh * 0.25)],
      [sx + Math.floor(sw * 0.75), sy + Math.floor(sh * 0.25)],
      [sx + Math.floor(sw * 0.25), sy + Math.floor(sh * 0.75)],
      [sx + Math.floor(sw * 0.75), sy + Math.floor(sh * 0.75)],
      [sx + Math.floor(sw * 0.5), sy + Math.floor(sh * 0.5)],
    ];
  }

  return [
    [Math.floor(canvasW * 0.25), Math.floor(canvasH * 0.25)],
    [Math.floor(canvasW * 0.75), Math.floor(canvasH * 0.25)],
    [Math.floor(canvasW * 0.25), Math.floor(canvasH * 0.75)],
    [Math.floor(canvasW * 0.75), Math.floor(canvasH * 0.75)],
    [Math.floor(canvasW * 0.5), Math.floor(canvasH * 0.5)],
  ];
}

function _patchSumCanvas(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  patchRadius: number,
): number {
  const sx = Math.max(0, cx - patchRadius);
  const sy = Math.max(0, cy - patchRadius);
  const sizeX = Math.min(patchRadius * 2 + 1, ctx.canvas.width - sx);
  const sizeY = Math.min(patchRadius * 2 + 1, ctx.canvas.height - sy);

  try {
    const id = ctx.getImageData(sx, sy, sizeX, sizeY).data;
    let s = 0;
    for (let i = 0; i < id.length; i += 4) s += id[i] + id[i + 1] + id[i + 2];
    return s;
  } catch {
    return -1;
  }
}

function _patchSumBuffer(
  buf: Uint8ClampedArray,
  bw: number,
  bh: number,
  cx: number,
  cy: number,
  patchRadius: number,
): number {
  const sx = Math.max(0, cx - patchRadius);
  const sy = Math.max(0, cy - patchRadius);
  const ex = Math.min(bw - 1, cx + patchRadius);
  const ey = Math.min(bh - 1, cy + patchRadius);

  let s = 0;
  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      const i = (y * bw + x) * 4;
      s += buf[i] + buf[i + 1] + buf[i + 2];
    }
  }
  return s;
}

function _mapByOrientation(
  x: number,
  y: number,
  w: number,
  h: number,
  orientation: _ReadbackOrientation,
): [number, number] {
  switch (orientation) {
    case "flipX":
      return [w - 1 - x, y];
    case "flipY":
      return [x, h - 1 - y];
    case "flipXY":
      return [w - 1 - x, h - 1 - y];
    default:
      return [x, y];
  }
}

function _detectReadbackOrientation(params: {
  screenCtx: CanvasRenderingContext2D;
  samplePoints: Array<[number, number]>;
  pixels: Uint8ClampedArray;
  captureWidth: number;
  captureHeight: number;
  mapScreenToCapture: (sx: number, sy: number) => [number, number];
  patchRadius?: number;
}): _ReadbackOrientation {
  const {
    screenCtx,
    samplePoints,
    pixels,
    captureWidth,
    captureHeight,
    mapScreenToCapture,
  } = params;

  const patchRadius = params.patchRadius ?? 2;
  const candidates: _ReadbackOrientation[] = [
    "normal",
    "flipX",
    "flipY",
    "flipXY",
  ];
  const error: Record<_ReadbackOrientation, number> = {
    normal: 0,
    flipX: 0,
    flipY: 0,
    flipXY: 0,
  };

  let validSamples = 0;

  for (const [sx, sy] of samplePoints) {
    const screenSum = _patchSumCanvas(screenCtx, sx, sy, patchRadius);
    if (screenSum < 0) continue;

    let [mx, my] = mapScreenToCapture(sx, sy);
    mx = _clamp(mx, 0, captureWidth - 1);
    my = _clamp(my, 0, captureHeight - 1);

    for (const o of candidates) {
      const [tx, ty] = _mapByOrientation(
        mx,
        my,
        captureWidth,
        captureHeight,
        o,
      );
      const capSum = _patchSumBuffer(
        pixels,
        captureWidth,
        captureHeight,
        tx,
        ty,
        patchRadius,
      );
      error[o] += Math.abs(screenSum - capSum);
    }

    validSamples++;
  }

  if (validSamples === 0) return "normal";

  let best: _ReadbackOrientation = "normal";
  for (const o of candidates) {
    if (error[o] < error[best]) best = o;
  }
  return best;
}

function _applyReadbackOrientation(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  orientation: _ReadbackOrientation,
): Uint8ClampedArray {
  if (orientation === "normal") return pixels;

  const out = new Uint8ClampedArray(pixels.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const [tx, ty] = _mapByOrientation(x, y, w, h, orientation);
      const di = (ty * w + tx) * 4;
      out[di] = pixels[si];
      out[di + 1] = pixels[si + 1];
      out[di + 2] = pixels[si + 2];
      out[di + 3] = pixels[si + 3];
    }
  }

  return out;
}

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

/**
 * Export the same stepped animation as a recorded WebM video using
 * MediaRecorder + canvas.captureStream(). The renderer is stepped
 * deterministically (one render per animation step) so the resulting
 * video matches the frame sequence produced by `exportAnimationFrames`.
 */
export async function exportAnimationVideo(
  ctx: SceneContext,
  lightParams: LightParams,
  lights: Lights,
  _pane: Pane,
  animParams: {
    startAzimuth: number;
    endAzimuth: number;
    steps: number;
    duration: number;
  },
  onProgress: (pct: number) => void,
): Promise<void> {
  const { renderer, camera, scene, controls, plane } = ctx;

  // Choose the best-supported WebM mime type.
  const mimeCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  let mime: string | undefined;
  for (const c of mimeCandidates) {
    try {
      if (
        typeof MediaRecorder !== "undefined" &&
        (MediaRecorder as any).isTypeSupported?.(c)
      ) {
        mime = c;
        break;
      }
    } catch (e) {
      /* ignore */
    }
  }
  mime = mime ?? "video/webm";

  const fps = Math.max(
    1,
    Math.min(
      60,
      Math.round(animParams.steps / Math.max(animParams.duration, 0.001)),
    ),
  );

  // Recording resolution: default to 2× the canvas backing, capped to 3840px width.
  const srcCanvas = renderer.domElement as HTMLCanvasElement;
  const srcW = Math.max(1, srcCanvas.width);
  const srcH = Math.max(1, srcCanvas.height);
  const quality = (animParams as any).recordQuality ?? 2;
  const recW = Math.min(3840, Math.max(1, Math.round(srcW * quality)));
  const recH = Math.max(1, Math.round((recW / srcW) * srcH));

  // RenderTarget + hidden canvas capture path (higher-quality and deterministic).
  const rt = new RenderTarget(recW, recH, { type: FloatType });
  const outCanvas = document.createElement("canvas");
  outCanvas.width = recW;
  outCanvas.height = recH;
  outCanvas.style.position = "fixed";
  outCanvas.style.left = "-9999px";
  outCanvas.style.top = "-9999px";
  document.body.appendChild(outCanvas);
  const outCtx = outCanvas.getContext("2d")!;

  // Improve banding in recorded output by enabling material dithering.
  const planeMat = (plane.material as any) ?? null;
  const prevDither = planeMat?.dithering ?? false;
  if (planeMat) planeMat.dithering = true;

  if (typeof (outCanvas as any).captureStream !== "function") {
    throw new Error("canvas.captureStream() is not supported in this browser");
  }

  const stream = outCanvas.captureStream(fps);
  const chunks: Blob[] = [];
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime });
  } catch (err) {
    recorder = new MediaRecorder(stream);
  }
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size) chunks.push(ev.data);
  };

  // Pause the main loop and record frames rendered into `rt`.
  renderer.setAnimationLoop(null);
  recorder.start();

  // Detect once, apply every frame.
  let readbackOrientation: _ReadbackOrientation | null = null;

  try {
    renderer.setOutputRenderTarget(rt);

    for (let i = 0; i < animParams.steps; i++) {
      const fraction = i / Math.max(animParams.steps - 1, 1);
      lightParams.azimuth =
        animParams.startAzimuth +
        (animParams.endAzimuth - animParams.startAzimuth) * fraction;
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
      controls.update();

      renderer.render(scene, camera);

      // Read full RT back and convert to 8-bit with ordered dithering.
      const raw = await renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        recW,
        recH,
      );
      const bytesPerTexel = 16; // RGBA32Float
      const alignedBytesPerRow = Math.ceil((recW * bytesPerTexel) / 256) * 256;
      const alignedFloatsPerRow = alignedBytesPerRow / 4;
      let pixels = _floatToDitheredUint8(
        raw as Float32Array,
        recW,
        recH,
        alignedFloatsPerRow,
      );

      if (readbackOrientation === null) {
        try {
          const probe = document.createElement("canvas");
          probe.width = srcCanvas.width;
          probe.height = srcCanvas.height;
          const pctx = probe.getContext("2d", { willReadFrequently: true });

          if (pctx) {
            pctx.drawImage(srcCanvas, 0, 0);

            const bounds = _planeScreenRect(
              camera,
              plane,
              srcCanvas.width,
              srcCanvas.height,
            );
            const samplePoints = _buildSamplePoints(
              srcCanvas.width,
              srcCanvas.height,
              bounds,
            );

            readbackOrientation = _detectReadbackOrientation({
              screenCtx: pctx,
              samplePoints,
              pixels,
              captureWidth: recW,
              captureHeight: recH,
              patchRadius: 2,
              mapScreenToCapture: (sx, sy) => {
                const mapX = Math.floor(
                  (sx / Math.max(srcCanvas.width, 1)) * recW,
                );
                const mapY = Math.floor(
                  (sy / Math.max(srcCanvas.height, 1)) * recH,
                );
                return [mapX, mapY];
              },
            });
          } else {
            readbackOrientation = "normal";
          }
        } catch {
          readbackOrientation = "normal";
        }
      }

      pixels = _applyReadbackOrientation(
        pixels,
        recW,
        recH,
        readbackOrientation ?? "normal",
      );

      const img = new ImageData(recW, recH);
      img.data.set(pixels as unknown as Uint8ClampedArray);
      outCtx.putImageData(img, 0, 0);

      // Allow the compositor to sample the updated hidden canvas.
      await new Promise((r) => requestAnimationFrame(r));

      onProgress(Math.round(((i + 1) / animParams.steps) * 100));
    }
  } finally {
    recorder.stop();
    await new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

    renderer.setOutputRenderTarget(null);
    startRenderLoop(ctx);

    if (planeMat) planeMat.dithering = prevDither;
    rt.dispose();
    outCanvas.remove();
  }

  if (chunks.length === 0) return;

  const blob = new Blob(chunks, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rti-animation.${mime.includes("mp4") ? "mp4" : "webm"}`;
  a.click();
  URL.revokeObjectURL(url);
}
