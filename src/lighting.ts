import * as THREE from "three";

export interface Lights {
  pointLight: THREE.PointLight;
  ambientLight: THREE.AmbientLight;
  /** Visual helper sphere showing the light position */
  lightHelper: THREE.Mesh;
}

/** Parameters that drive the RTI raking-light position */
export interface LightParams {
  /** Azimuth angle in degrees (0–360, 0 = right / +X) */
  azimuth: number;
  /** Elevation angle in degrees (0–90, 0 = grazing, 90 = directly above) */
  elevation: number;
  /** Radius of the hemisphere the light sits on */
  radius: number;
}

/** Sensible defaults for the RTI light */
export const DEFAULT_LIGHT_PARAMS: LightParams = {
  azimuth: 45,
  elevation: 45,
  radius: 2.5,
};

/**
 * Create a point light (simulates the raking light in RTI) and
 * an ambient light for base illumination. A small sphere mesh
 * is added as a visual indicator of the point-light position.
 */
export function createLights(scene: THREE.Scene): Lights {
  // ── Point light (main RTI light) ───────────────────────
  const pointLight = new THREE.PointLight(0xffffff, 1.5, 0, 2);
  scene.add(pointLight);

  // Position the light using the default azimuth/elevation
  setLightPosition(pointLight, DEFAULT_LIGHT_PARAMS);

  // ── Small emissive sphere to visualise light position ──
  const helperGeo = new THREE.SphereGeometry(0.04, 16, 16);
  const helperMat = new THREE.MeshBasicMaterial({ color: 0xffff80 });
  const lightHelper = new THREE.Mesh(helperGeo, helperMat);
  lightHelper.position.copy(pointLight.position);
  scene.add(lightHelper);

  // ── Ambient light (fill) ───────────────────────────────
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambientLight);

  return { pointLight, ambientLight, lightHelper };
}

/**
 * Map azimuth & elevation angles to a 3D position on a
 * hemisphere above the image plane (centered at origin).
 *
 * Convention:
 *   azimuth  0° → +X   (right)
 *   azimuth 90° → +Y   (up in plane)
 *   elevation 0° → on the plane (grazing / raking light)
 *   elevation 90° → directly above (+Z)
 */
export function setLightPosition(
  light: THREE.PointLight,
  params: LightParams,
): void {
  const azRad = THREE.MathUtils.degToRad(params.azimuth);
  const elRad = THREE.MathUtils.degToRad(params.elevation);
  const r = params.radius;

  light.position.set(
    r * Math.cos(elRad) * Math.cos(azRad),
    r * Math.cos(elRad) * Math.sin(azRad),
    r * Math.sin(elRad),
  );
}

/**
 * Convenience: sync the helper sphere with current light position.
 */
export function syncHelper(lights: Lights): void {
  lights.lightHelper.position.copy(lights.pointLight.position);
}
