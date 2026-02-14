import {
  Scene,
  Color,
  PerspectiveCamera,
  PlaneGeometry,
  Mesh,
  ACESFilmicToneMapping,
  WebGPURenderer,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGPURenderer;
  controls: OrbitControls;
  plane: Mesh;
}

/**
 * Create the Three.js scene, camera, WebGPU renderer, orbit controls,
 * and a textured plane.  The renderer is initialised asynchronously so
 * TSL / node-material features are ready before the first frame.
 */
export async function createScene(
  canvas: HTMLCanvasElement,
): Promise<SceneContext> {
  // ── Scene ──────────────────────────────────────────────
  const scene = new Scene();
  scene.background = new Color(0x1a1a1a);

  // ── Camera ─────────────────────────────────────────────
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new PerspectiveCamera(45, aspect, 0.1, 100);
  camera.position.set(0, 0, 3);

  // ── Renderer (WebGPU with automatic WebGL2 fallback) ───
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
  });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  // ── OrbitControls ──────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1;
  controls.maxDistance = 10;

  // ── Plane geometry (1:1 default, will be resized on image load) ──
  const geometry = new PlaneGeometry(2, 2);

  const material = new MeshStandardNodeMaterial({
    color: 0xffffff,
  });

  material.dithering = true; // ✅ ADD THIS LINE

  const plane = new Mesh(geometry, material);
  scene.add(plane);

  // ── Handle resize ──────────────────────────────────────
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, controls, plane };
}

/**
 * Start the render loop via `setAnimationLoop` (required by WebGPURenderer
 * for proper frame scheduling and auto-init guarantees).
 */
export function startRenderLoop(ctx: SceneContext): void {
  const { scene, camera, renderer, controls } = ctx;

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}
