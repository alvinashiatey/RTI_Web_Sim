import type { Mesh } from "three/webgpu";
import { swapTextureFromFile, type MaterialParams } from "./material";

/**
 * Set up drag-and-drop + file-input image upload.
 *
 * When a valid image is selected / dropped the texture is swapped
 * on the plane, a new normal map is generated, and the plane is
 * resized to match the image aspect ratio.
 */
export function initImageUpload(
  plane: Mesh,
  materialParams: MaterialParams,
  onSwap?: (source: HTMLCanvasElement | HTMLImageElement) => void,
): void {
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById(
    "file-input",
  ) as HTMLInputElement | null;

  if (!dropZone || !fileInput) {
    console.warn("Upload UI elements not found — skipping upload init");
    return;
  }

  // ── File input change ──────────────────────────────────
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file, plane, materialParams, dropZone, onSwap);
  });

  // ── Click to open file picker ──────────────────────────
  dropZone.addEventListener("click", () => fileInput.click());

  // ── Drag & drop ────────────────────────────────────────
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file, plane, materialParams, dropZone, onSwap);
  });
}

// ── Helpers ──────────────────────────────────────────────

async function handleFile(
  file: File,
  plane: Mesh,
  materialParams: MaterialParams,
  dropZone: HTMLElement,
  onSwap?: (source: HTMLCanvasElement | HTMLImageElement) => void,
): Promise<void> {
  if (!file.type.startsWith("image/")) {
    showStatus(dropZone, "⚠ Not an image file", true);
    return;
  }

  showStatus(dropZone, "Loading…");

  const texture = await swapTextureFromFile(plane, file, materialParams);

  if (texture) {
    showStatus(dropZone, `✓ ${file.name}`, false);
    // Notify the effects pipeline about the new source image
    if (onSwap && texture.image) {
      onSwap(texture.image as HTMLCanvasElement | HTMLImageElement);
    }
  } else {
    showStatus(dropZone, "⚠ Failed to load image", true);
  }
}

function showStatus(
  dropZone: HTMLElement,
  message: string,
  isError = false,
): void {
  const label = dropZone.querySelector(".drop-label");
  if (label) {
    label.textContent = message;
    dropZone.classList.toggle("error", isError);
  }
}
