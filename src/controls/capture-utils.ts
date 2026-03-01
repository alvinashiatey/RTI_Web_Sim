import { Vector3, Box3 } from "three/webgpu";
import type { SceneContext } from "../scene";

export type CropRect = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export function computePlaneScreenRect(
  camera: SceneContext["camera"],
  plane: SceneContext["plane"],
  canvasW: number,
  canvasH: number,
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
    corner.project(camera);
    const screenX = ((corner.x + 1) / 2) * canvasW;
    const screenY = ((1 - corner.y) / 2) * canvasH;
    minX = Math.min(minX, screenX);
    minY = Math.min(minY, screenY);
    maxX = Math.max(maxX, screenX);
    maxY = Math.max(maxY, screenY);
  }

  const sx = Math.max(0, Math.floor(minX));
  const sy = Math.max(0, Math.floor(minY));
  const sw = Math.min(canvasW, Math.ceil(maxX)) - sx;
  const sh = Math.min(canvasH, Math.ceil(maxY)) - sy;

  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}

export function drawImageCrop(
  src: HTMLCanvasElement,
  rect: CropRect | null,
  opts?: CanvasRenderingContext2DSettings,
): HTMLCanvasElement {
  if (!rect) {
    // Return a copy of the whole canvas
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext("2d", opts ?? {})!;
    ctx.drawImage(src, 0, 0);
    return out;
  }

  const out = document.createElement("canvas");
  out.width = rect.sw;
  out.height = rect.sh;
  const ctx = out.getContext("2d", opts ?? {})!;
  ctx.drawImage(
    src,
    rect.sx,
    rect.sy,
    rect.sw,
    rect.sh,
    0,
    0,
    rect.sw,
    rect.sh,
  );
  return out;
}

export function canvasToBlob(
  c: HTMLCanvasElement,
  mime: string = "image/png",
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob((b) => resolve(b), mime, quality));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
