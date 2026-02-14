import { Vector3, Box3, RenderTarget, FloatType } from "three/webgpu";
import type { Pane } from "tweakpane";
import type { LightParams, Lights } from "../lighting";
import { setLightPosition, syncHelper } from "../lighting";
import { startRenderLoop, type SceneContext } from "../scene";
import { buildZip, type ZipEntry } from "./zip";

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
): Uint8ClampedArray<ArrayBuffer> {
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

  // Create a FloatType render target so tone-mapped + sRGB values are
  // stored at full precision (no 8-bit quantisation on the GPU).
  const canvas = renderer.domElement as HTMLCanvasElement;
  const w = canvas.width;
  const h = canvas.height;
  const rt = new RenderTarget(w, h, { type: FloatType });

  // Temporarily enable material dithering for the plane to further reduce
  // banding in combination with the ordered-dither pass below.
  const planeMat = plane.material as any;
  const prevDither = planeMat?.dithering ?? false;
  if (planeMat) planeMat.dithering = true;

  // Mark the RT as the *output* target so the renderer's full output
  // pipeline — ACES Filmic tone mapping + sRGB encoding — is applied,
  // exactly matching the live canvas appearance.
  renderer.setOutputRenderTarget(rt);

  try {
    for (let i = 0; i < steps; i++) {
      const fraction = i / Math.max(steps - 1, 1);
      lightParams.azimuth =
        startAzimuth + (endAzimuth - startAzimuth) * fraction;
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
      controls.update();

      // Render through the normal pipeline — output lands in `rt`.
      await renderer.renderAsync(scene, camera);

      // Read pixels directly from GPU memory.
      const rect = _planeScreenRect(camera, plane, w, h);
      const rx = rect ? rect.sx : 0;
      // readRenderTargetPixelsAsync uses bottom-left origin (GL convention).
      // Our screen rect has top-left origin, so flip Y.
      const ry = rect ? h - rect.sy - rect.sh : 0;
      const rw = rect ? rect.sw : w;
      const rh = rect ? rect.sh : h;

      const rawBuffer = await renderer.readRenderTargetPixelsAsync(
        rt,
        rx,
        ry,
        rw,
        rh,
      );

      // WebGPU pads each row to 256-byte alignment.  For RGBA32Float
      // (16 bytes/texel) the padded stride may exceed rw * 4 floats.
      const bytesPerTexel = 16; // RGBA32Float
      const alignedBytesPerRow = Math.ceil((rw * bytesPerTexel) / 256) * 256;
      const alignedFloatsPerRow = alignedBytesPerRow / 4;

      // Convert float buffer → dithered Uint8, flipping rows.
      const pixels = _floatToDitheredUint8(
        rawBuffer as Float32Array,
        rw,
        rh,
        alignedFloatsPerRow,
      );

      // Paint onto a temporary canvas to encode as PNG.
      const tmp = document.createElement("canvas");
      tmp.width = rw;
      tmp.height = rh;
      const ctx2d = tmp.getContext("2d")!;
      ctx2d.putImageData(new ImageData(pixels, rw, rh), 0, 0);

      const blob = await new Promise<Blob | null>((resolve) => {
        tmp.toBlob((b) => resolve(b), "image/png");
      });

      if (blob) {
        const data = new Uint8Array(await blob.arrayBuffer());
        const num = String(i + 1).padStart(padLen, "0");
        entries.push({ name: `frame_${num}.png`, data });
      }

      onProgress(Math.round(((i + 1) / steps) * 100));
    }
  } finally {
    rt.dispose();
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

  try {
    renderer.setOutputRenderTarget(rt);

    // Orientation detection flag: null = not yet tested, true = data is
    // rotated 180°, false = normal orientation.
    let rotated180: boolean | null = null;



    for (let i = 0; i < animParams.steps; i++) {
      const fraction = i / Math.max(animParams.steps - 1, 1);
      lightParams.azimuth =
        animParams.startAzimuth +
        (animParams.endAzimuth - animParams.startAzimuth) * fraction;
      setLightPosition(lights.pointLight, lightParams);
      syncHelper(lights);
      controls.update();

      await renderer.renderAsync(scene, camera);

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

      // Robust orientation detection (multi-sample voting).  Some backends
      // return readback buffers with ambiguous regions where a single-pixel
      // test can be wrong — sample multiple points and pick the majority.
      if (rotated180 === null) {
        try {
          const probe = document.createElement("canvas");
          probe.width = srcCanvas.width;
          probe.height = srcCanvas.height;
          const pctx = probe.getContext("2d");
          if (pctx) pctx.drawImage(srcCanvas, 0, 0);

          const samples: Array<[number, number]> = [
            [0.2, 0.2],
            [0.8, 0.2],
            [0.2, 0.8],
            [0.8, 0.8],
            [0.5, 0.5],
          ];

          let normalVotes = 0;
          let rotVotes = 0;

          const getPixel = (arr: Uint8ClampedArray, x: number, y: number, width: number) => {
            const i = (y * width + x) * 4;
            return [arr[i], arr[i + 1], arr[i + 2], arr[i + 3]] as number[];
          };

          const close = (a: number[], b: number[], tol = 32) =>
            Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

          for (const [ox, oy] of samples) {
            const sx = Math.max(1, Math.min(srcCanvas.width - 2, Math.floor(srcCanvas.width * ox)));
            const sy = Math.max(1, Math.min(srcCanvas.height - 2, Math.floor(srcCanvas.height * oy)));
            const screenData = pctx?.getImageData(sx, sy, 1, 1).data;
            if (!screenData) continue;
            const screenSample = [screenData[0], screenData[1], screenData[2]];

            const mapX = Math.floor((sx / srcCanvas.width) * recW);
            const mapY = Math.floor((sy / srcCanvas.height) * recH);

            const cap = getPixel(pixels, mapX, mapY, recW);
            const capRot = getPixel(pixels, recW - 1 - mapX, recH - 1 - mapY, recW);

            if (close(screenSample, [cap[0], cap[1], cap[2]])) normalVotes++;
            if (close(screenSample, [capRot[0], capRot[1], capRot[2]])) rotVotes++;
          }

          rotated180 = rotVotes > normalVotes;
        } catch (e) {
          rotated180 = false;
        }
      }

      if (rotated180) {
        const out = new Uint8ClampedArray(pixels.length);
        for (let yy = 0; yy < recH; yy++) {
          for (let xx = 0; xx < recW; xx++) {
            const si = (yy * recW + xx) * 4;
            const di = ((recH - 1 - yy) * recW + (recW - 1 - xx)) * 4;
            out[di] = pixels[si];
            out[di + 1] = pixels[si + 1];
            out[di + 2] = pixels[si + 2];
            out[di + 3] = pixels[si + 3];
          }
        }
        pixels = out;
      }

      outCtx.putImageData(new ImageData(pixels, recW, recH), 0, 0);

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
