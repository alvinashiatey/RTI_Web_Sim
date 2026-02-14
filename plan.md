# RTI Web Simulator

## Overview

A web application that simulates Reflectance Transformation Imaging (RTI) behavior. Users upload a 2D image, and Three.js renders it on a surface with interactive lighting—allowing adjustment of light direction, intensity, and material properties via Tweakpane controls. Results can be saved and shared.

## Tech Stack

- **HTML / CSS / JavaScript** — Frontend interface
- **Three.js** — 3D rendering & RTI simulation
- **Three.js WebGPU Renderer** — GPU-accelerated rendering via WebGPU (with WebGL2 fallback)
- **Three.js Shading Language (TSL)** — GPU-accelerated image effects pipeline
- **Tweakpane** — Parameter control UI
- **Vite** — Dev server & build tooling

---

## Phase 1: Project Scaffold

- [x] Initialize the project with `pnpm create vite@latest` (vanilla TS template)
- [x] Install dependencies: `three`, `tweakpane`
- [x] Set up project folder structure:
  ```
  src/
    main.ts          # Entry point
    scene.ts         # Three.js scene setup
    lighting.ts      # Light creation & helpers
    material.ts      # Material/shader setup
    controls.ts      # Tweakpane UI bindings
    utils.ts         # Shared helpers (file I/O, etc.)
  public/
    sample.jpg       # Default sample image
  index.html
  style.css
  ```
- [x] Create a minimal `index.html` with a `<canvas>` element and an upload area
- [x] Add base styles in `style.css` (full-viewport canvas, overlay UI panel)
- [x] Verify the dev server runs with `pnpm run dev`

---

## Phase 2: Three.js Scene & Rendering Foundation

- [x] In `scene.ts`, create a `Scene`, `PerspectiveCamera`, and `WebGPURenderer` bound to the canvas
- [x] Add an `OrbitControls` instance for basic camera interaction (zoom/pan)
- [x] Create a flat plane geometry (`PlaneGeometry`) to serve as the image surface
- [x] Load the default `sample.jpg` as a `Texture` and apply it to the plane via `MeshStandardNodeMaterial`
- [x] Add a single `PointLight` (or `DirectionalLight`) and an `AmbientLight` to the scene
- [x] Implement a render loop (`renderer.setAnimationLoop()`) and confirm the textured plane displays correctly

---

## Phase 3: RTI Simulation Logic

- [x] Implement a lighting model that simulates RTI raking-light behavior:
  - Map a 2D light-direction vector (azimuth & elevation) to the 3D light position on a hemisphere above the surface
- [x] Generate or derive a simple normal map from the uploaded image (e.g., Sobel-based or grayscale-to-normal conversion) to give the flat image surface detail
- [x] Apply the normal map to `MeshStandardMaterial.normalMap` so light interacts with surface relief
- [x] Expose adjustable material properties:
  - `roughness`, `metalness`, `normalScale`, `bumpScale`
- [x] Verify that moving the light source produces visible, realistic shading changes across the surface

---

## Phase 4: Tweakpane Controls

- [x] Initialize a Tweakpane pane anchored to the UI panel
- [x] Add **Light Direction** controls:
  - Azimuth slider (0–360°)
  - Elevation slider (0–90°)
- [x] Add **Light Intensity** slider (0–5)
- [x] Add **Light Color** picker
- [x] Add **Material** folder:
  - Roughness (0–1)
  - Metalness (0–1)
  - Normal map intensity (0–3)
- [x] Add **Ambient Light** intensity slider
- [x] Bind every control to its corresponding Three.js property and confirm real-time updates

---

## Phase 5: Image Upload

- [x] Add a drag-and-drop zone + file `<input>` for image upload
- [x] On file select, load the image as a `Three.TextureLoader` texture and swap it onto the plane material
- [x] Re-derive the normal map from the new image
- [x] Handle edge cases: non-image files, very large images (warn or downscale), upload errors
- [x] Update the plane's aspect ratio to match the uploaded image dimensions

---

## Phase 6: Save & Share

- [x] **Snapshot**: Add a "Save Image" button that projects the plane's bounding box to screen space, crops just the image plane region (excluding the background), and triggers a PNG download
- [x] **Parameter Export**: Add "Export Settings" to serialize the current Tweakpane parameter state to a JSON file download
- [x] **Parameter Import**: Add "Import Settings" to load a JSON file and restore all parameters
- [x] **Shareable Link** (stretch): Encode parameters into a URL hash/query string so a link reproduces the same view (without the uploaded image)

---

## Phase 7: Polish & UX

- [x] Make the layout responsive (canvas resizes on window resize, controls collapse on mobile)
- [x] Add keyboard shortcuts (e.g., `R` to reset light, `S` to save snapshot)
- [x] Add a subtle loading spinner while textures process
- [x] Add tooltips or a brief help overlay explaining RTI and each control
- [x] Ensure accessibility: focus management, ARIA labels on controls
- [x] Add **Mouse → Light** toggle: when enabled, mouse position over the canvas drives the light azimuth & elevation in real time (toggle via Tweakpane checkbox or `M` key)

---

## Phase 8: Image Effects Pipeline (GPU-accelerated via TSL)

All effects run **entirely on the GPU** using Three.js Shading Language (TSL). Instead of the original CPU-based canvas pixel processing, each effect builds a TSL node graph that is compiled into a GPU shader. Parameter changes update uniform values instantly with zero reprocessing.

### 8.1 Architecture

- [x] Create `src/effects.ts` — registry of available effects, each exporting a name, default params, and a `createNode()` function that builds a TSL node graph
- [x] Define an `Effect` interface and `EffectInstance` interface:

  ```ts
  interface EffectInstance {
    colorNode: Node; // TSL node assigned to material.colorNode
    updateTexture(tex: Texture): void; // Hot-swap texture without rebuilding the graph
    getParams(): Record<string, unknown>;
    setParams(params: Record<string, unknown>): void;
  }

  interface Effect {
    name: string;
    defaults(): Record<string, unknown>;
    createNode(tex: Texture, pixelSize: Vector2): EffectInstance;
    buildUI(folder: FolderApi, instance: EffectInstance): void;
  }
  ```

- [x] Add an **Effects** folder to the Tweakpane pane in `controls.ts`
- [x] Add a dropdown (`list` binding) populated from the effect registry
- [x] On dropdown change: clear previous parameter bindings, call `createNode()` for the selected effect (which sets `material.colorNode`), then call `buildUI()` to wire Tweakpane sliders directly to TSL uniforms
- [x] Provide a "None" / passthrough option that sets `material.colorNode = null` to restore the original texture

### 8.2 TSL Implementation Details

The migration from CPU to GPU involved:

- **Renderer**: `WebGLRenderer` → `WebGPURenderer` (from `three/webgpu`). The renderer requires async `init()` and uses `setAnimationLoop()` instead of `requestAnimationFrame`.
- **Material**: `MeshStandardMaterial` → `MeshStandardNodeMaterial` (from `three/webgpu`). This node material exposes a `colorNode` property that accepts TSL node graphs.
- **Type declarations**: Custom `src/three-webgpu.d.ts` bridges `three/webgpu` and `three/tsl` module paths to the source-level `@types/three` type definitions, since the published type package doesn't include bundle-level module declarations.
- **Texture sampling**: Effects use `texture(tex, uv())` to sample the diffuse texture on the GPU. Convolution effects (Normal Map, Sobel, Emboss) offset the UV coordinates by a `pixelSize` uniform (`1/width`, `1/height`) to sample neighboring pixels.
- **Uniform-driven params**: Each effect parameter is a TSL `uniform()`. Tweakpane sliders write directly to `uniform.value`, so the GPU shader reflects changes instantly — no texture re-generation, no CPU pixel loops.
- **Texture hot-swap**: When the user uploads a new image, `EffectInstance.updateTexture()` updates the `TextureNode.value` reference without rebuilding the node graph.

### 8.3 Built-in Effects

All effects are implemented as TSL node graphs. Convolution-based effects sample 8 neighboring texels via UV offsets derived from a `pixelSize` uniform.

#### Normal Map Visualisation

- [x] Compute Sobel X/Y gradients on the GPU via 8-tap texture sampling, construct and normalize a 3D normal vector, pack `[-1,1]` → `[0,1]` for display
- [x] Dynamic params: **Strength** (0–10) — scales gradient magnitude before normalization

#### Sobel Edge Detection

- [x] Compute Sobel gradient magnitude on the GPU, threshold via `step()`, optionally invert via `mix()`
- [x] Dynamic params: **Threshold** (0–1), **Invert** (toggle, encoded as a 0/1 uniform)

#### Emboss

- [x] Compute directional emboss by projecting the Sobel gradient vector onto a direction defined by angle. Direction cosines (cos/sin) are precomputed on the CPU and passed as uniforms (updated via `setParams`)
- [x] Dynamic params: **Strength** (0–5), **Angle** (0–360°)

#### Grayscale

- [x] Dot product of sampled RGB with weight uniforms (auto-normalized in the shader to maintain luminance balance)
- [x] Dynamic params: **R / G / B weight** sliders (0–1 each, normalised on GPU via `weight / max(sum, 0.001)`)

#### Chromatic Aberration

- [x] Splits R/G/B channels by sampling texture at offset UVs radiating from a configurable center point, creating a prismatic fringe effect. Includes a subtle vignette (lens-darkening at edges).
- [x] Dynamic params: **Intensity** (0–0.1), **Center X** (0–1), **Center Y** (0–1)

#### Halftone

- [x] Converts image to a newspaper-style dot pattern. UV grid is rotated by an adjustable angle; dot radius is driven by local luminance (darker = larger dot). Supports mono (black-on-white) or colour-tinted modes.
- [x] Dynamic params: **Dot Size** (2–40 px), **Angle** (0–180°), **Color** (toggle)

### 8.4 Integration

- [x] When an effect is active, apply it after texture load **and** after every image upload swap
- [x] Persist the selected effect + params in Export/Import Settings JSON
- [x] Include the active effect in the shareable link hash
- [x] Add `E` keyboard shortcut to cycle through effects, with a toast showing the current name

---

## Phase 9: Build & Deploy

- [ ] Configure Vite production build (`pnpm run build`) and verify output
- [ ] Add a `README.md` with setup instructions, screenshots, and usage guide
- [ ] Deploy to a static host (GitHub Pages, Vercel, or Netlify)
- [ ] Test across browsers (Chrome, Firefox, Safari) and on mobile devices
