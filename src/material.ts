import {
  TextureLoader,
  SRGBColorSpace,
  NoColorSpace,
  CanvasTexture,
  PlaneGeometry,
  MeshStandardNodeMaterial,
  type Texture,
  type Mesh,
} from "three/webgpu";

// ── Adjustable material properties (Phase 3) ─────────────
export interface MaterialParams {
  roughness: number;
  metalness: number;
  normalScale: number;
  bumpScale: number;
}

export const DEFAULT_MATERIAL_PARAMS: MaterialParams = {
  roughness: 0.65,
  metalness: 0.0,
  normalScale: 1.0,
  bumpScale: 0.05,
};

/**
 * Load `sample.jpg` from the public folder, apply it to the
 * plane's MeshStandardMaterial, generate a normal map from the
 * image, and configure default material properties.
 */
export function loadDefaultTexture(plane: Mesh): Promise<Texture> {
  const loader = new TextureLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      "/sample.jpg",
      (texture) => {
        texture.colorSpace = SRGBColorSpace;

        const material = plane.material as MeshStandardNodeMaterial;
        material.map = texture;

        // Derive a normal map from the image
        const normalMap = generateNormalMap(texture.image as HTMLImageElement);
        material.normalMap = normalMap;
        material.normalScale.set(
          DEFAULT_MATERIAL_PARAMS.normalScale,
          DEFAULT_MATERIAL_PARAMS.normalScale,
        );

        // Apply default material properties
        applyMaterialParams(material, DEFAULT_MATERIAL_PARAMS);
        material.needsUpdate = true;

        // Resize plane to match the image aspect ratio
        const image = texture.image as HTMLImageElement;
        const aspect = image.width / image.height;
        const height = 2;
        const width = height * aspect;
        plane.geometry.dispose();
        plane.geometry = new PlaneGeometry(width, height);

        resolve(texture);
      },
      undefined,
      (err) => {
        console.error("Failed to load default texture:", err);
        reject(err);
      },
    );
  });
}

/**
 * Apply `MaterialParams` to a `MeshStandardMaterial`.
 */
export function applyMaterialParams(
  material: MeshStandardNodeMaterial,
  params: MaterialParams,
): void {
  material.roughness = params.roughness;
  material.metalness = params.metalness;
  material.normalScale.set(params.normalScale, params.normalScale);
  material.bumpScale = params.bumpScale;
  material.needsUpdate = true;
}

// ── Normal-map generation (Sobel-based) ──────────────────

/**
 * Generate a normal map from an image using a Sobel operator.
 *
 * 1. Draw the image to an off-screen canvas.
 * 2. Convert to grayscale (luminance).
 * 3. Run Sobel-X and Sobel-Y convolutions to estimate surface gradients.
 * 4. Pack gradients into an RGB normal map (tangent space).
 * 5. Return a `THREE.CanvasTexture`.
 */
export function generateNormalMap(
  image: HTMLImageElement,
  strength: number = 2.0,
): CanvasTexture {
  const w = image.width;
  const h = image.height;

  // ── Draw image to canvas & read pixels ─────────────────
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.drawImage(image, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  // ── Build grayscale heightmap ──────────────────────────
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = srcData[i * 4];
    const g = srcData[i * 4 + 1];
    const b = srcData[i * 4 + 2];
    // ITU-R BT.601 luminance
    gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // ── Helper: clamped pixel access ───────────────────────
  function heightAt(x: number, y: number): number {
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    return gray[y * w + x];
  }

  // ── Sobel convolution → normal map ─────────────────────
  const dstCanvas = document.createElement("canvas");
  dstCanvas.width = w;
  dstCanvas.height = h;
  const dstCtx = dstCanvas.getContext("2d")!;
  const dstImage = dstCtx.createImageData(w, h);
  const dst = dstImage.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel X kernel
      const dX =
        -1 * heightAt(x - 1, y - 1) +
        1 * heightAt(x + 1, y - 1) +
        -2 * heightAt(x - 1, y) +
        2 * heightAt(x + 1, y) +
        -1 * heightAt(x - 1, y + 1) +
        1 * heightAt(x + 1, y + 1);

      // Sobel Y kernel
      const dY =
        -1 * heightAt(x - 1, y - 1) +
        -2 * heightAt(x, y - 1) +
        -1 * heightAt(x + 1, y - 1) +
        1 * heightAt(x - 1, y + 1) +
        2 * heightAt(x, y + 1) +
        1 * heightAt(x + 1, y + 1);

      // Normal vector (tangent space)
      const nx = -dX * strength;
      const ny = -dY * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      // Pack into 0-255 range ([-1,1] → [0,255])
      const idx = (y * w + x) * 4;
      dst[idx] = ((nx / len) * 0.5 + 0.5) * 255; // R
      dst[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255; // G
      dst[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255; // B
      dst[idx + 3] = 255; // A
    }
  }

  dstCtx.putImageData(dstImage, 0, 0);

  const normalTexture = new CanvasTexture(dstCanvas);
  normalTexture.colorSpace = NoColorSpace;
  return normalTexture;
}

// ── Max image dimension (downscale if larger) ────────────
const MAX_IMAGE_DIM = 4096;

/**
 * Swap the plane's texture with a user-uploaded image file.
 * Generates a new normal map and resizes the plane to match.
 * Returns the new texture, or `null` on failure.
 */
export function swapTextureFromFile(
  plane: Mesh,
  file: File,
  materialParams: MaterialParams,
): Promise<Texture | null> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) {
      console.warn("Not an image file:", file.type);
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      console.error("FileReader error");
      resolve(null);
    };

    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // ── Downscale if necessary ─────────────────────
        let { width, height } = img;
        if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
          console.warn(
            `Image ${width}×${height} exceeds ${MAX_IMAGE_DIM}px — downscaling`,
          );
          const scale = MAX_IMAGE_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        // Draw (possibly scaled) to canvas for clean pixel data
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx2d = canvas.getContext("2d")!;
        ctx2d.drawImage(img, 0, 0, width, height);

        // Create a new image from the (possibly downscaled) canvas
        const scaledImg = new Image();
        scaledImg.onload = () => {
          const texture = new CanvasTexture(canvas);
          texture.colorSpace = SRGBColorSpace;

          const material = plane.material as MeshStandardNodeMaterial;

          // Dispose old textures
          material.map?.dispose();
          material.normalMap?.dispose();

          material.map = texture;

          // Re-derive normal map
          const normalMap = generateNormalMap(scaledImg);
          material.normalMap = normalMap;

          applyMaterialParams(material, materialParams);
          material.needsUpdate = true;

          // Resize plane to image aspect ratio
          const aspect = width / height;
          const h = 2;
          const w2 = h * aspect;
          plane.geometry.dispose();
          plane.geometry = new PlaneGeometry(w2, h);

          resolve(texture);
        };
        scaledImg.src = canvas.toDataURL();
      };

      img.onerror = () => {
        console.error("Failed to decode image");
        resolve(null);
      };
      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  });
}
