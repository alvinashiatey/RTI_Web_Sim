import {
  texture,
  uv,
  uniform,
  vec3,
  vec4,
  float,
  vec2,
  floor,
  min,
  mix,
  fract,
  sqrt,
  fwidth,
  smoothstep,
  clamp,
  length,
} from "three/tsl";
import type TextureNode from "three/src/nodes/accessors/TextureNode.js";
import type { Effect, EffectInstance } from "./common";
import type { Texture } from "three/webgpu";
import { Vector2 } from "three/webgpu";
import type { FolderApi } from "tweakpane";

export const halftoneCMYK: Effect = {
  name: "Halftone CMYK",
  defaults: () => ({
    pixelSize: 8.0,
    dotSize: 0.7,
    cyanStrength: 1.0,
    magentaStrength: 1.0,
    yellowStrength: 1.0,
    blackStrength: 1.0,
  }),

  createNode(tex: Texture, resolution: Vector2) {
    const mapTex = texture(tex, uv()) as TextureNode;
    const pixelSizeU = uniform(8.0);
    const dotSizeU = uniform(0.7);
    const resolutionU = uniform(vec2(1.0 / resolution.x, 1.0 / resolution.y));
    const cyanStrengthU = uniform(1.0);
    const magentaStrengthU = uniform(1.0);
    const yellowStrengthU = uniform(1.0);
    const blackStrengthU = uniform(1.0);

    const uvCoord = uv();

    // Helper function to create halftone for a single channel
    const createHalftone = (angleDeg: number) => {
      const angleRad = (angleDeg * Math.PI) / 180;
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);

      // Rotate UV to grid space
      const uvScaled = uvCoord.mul(resolutionU).div(pixelSizeU);
      const rotX = uvScaled.x.mul(cosA).sub(uvScaled.y.mul(sinA));
      const rotY = uvScaled.x.mul(sinA).add(uvScaled.y.mul(cosA));
      const gridUV = vec2(rotX, rotY);

      // Get cell center in grid space
      const cellCenter = floor(gridUV).add(0.5);

      // Rotate back to UV space
      const rotBackX = cellCenter.x.mul(cosA).add(cellCenter.y.mul(sinA));
      const rotBackY = cellCenter.y.mul(cosA).sub(cellCenter.x.mul(sinA));
      const centerUV = vec2(rotBackX, rotBackY)
        .mul(pixelSizeU)
        .div(resolutionU);

      // Sample texture at cell center
      const cellColor = mapTex.sample(centerUV);

      // Convert to CMYK
      const r = cellColor.r;
      const g = cellColor.g;
      const b = cellColor.b;
      const k = min(
        float(1.0).sub(r),
        min(float(1.0).sub(g), float(1.0).sub(b)),
      );
      const invK = float(1.0).sub(k);

      const c = mix(
        float(0.0),
        float(1.0).sub(r).sub(k).div(invK),
        invK.greaterThan(0.0),
      );
      const m = mix(
        float(0.0),
        float(1.0).sub(g).sub(k).div(invK),
        invK.greaterThan(0.0),
      );
      const y = mix(
        float(0.0),
        float(1.0).sub(b).sub(k).div(invK),
        invK.greaterThan(0.0),
      );

      // Calculate dot
      const gv = fract(gridUV).sub(0.5);
      const dist = length(vec2(gv.x, gv.y));

      return {
        cmyk: vec4(c, m, y, k),
        gridUV,
        dist,
      };
    };

    // Create halftones for each channel
    const cyan = createHalftone(15);
    const magenta = createHalftone(75);
    const yellow = createHalftone(0);
    const black = createHalftone(45);

    // Generate dots with proper coverage
    const radiusC = dotSizeU.mul(sqrt(clamp(cyan.cmyk.x, 0.0, 1.0)));
    const aaC = fwidth(cyan.dist);
    const dotC = float(radiusC.greaterThan(0.0)).mul(
      float(1.0).sub(smoothstep(radiusC.sub(aaC), radiusC.add(aaC), cyan.dist)),
    );

    const radiusM = dotSizeU.mul(sqrt(clamp(magenta.cmyk.y, 0.0, 1.0)));
    const aaM = fwidth(magenta.dist);
    const dotM = float(radiusM.greaterThan(0.0)).mul(
      float(1.0).sub(
        smoothstep(radiusM.sub(aaM), radiusM.add(aaM), magenta.dist),
      ),
    );

    const radiusY = dotSizeU.mul(sqrt(clamp(yellow.cmyk.z, 0.0, 1.0)));
    const aaY = fwidth(yellow.dist);
    const dotY = float(radiusY.greaterThan(0.0)).mul(
      float(1.0).sub(
        smoothstep(radiusY.sub(aaY), radiusY.add(aaY), yellow.dist),
      ),
    );

    const radiusK = dotSizeU.mul(sqrt(clamp(black.cmyk.w, 0.0, 1.0)));
    const aaK = fwidth(black.dist);
    const dotK = float(radiusK.greaterThan(0.0)).mul(
      float(1.0).sub(
        smoothstep(radiusK.sub(aaK), radiusK.add(aaK), black.dist),
      ),
    );

    // Subtractive color mixing (CMYK)
    const outR = float(1.0).sub(cyanStrengthU.mul(dotC));
    const outG = float(1.0).sub(magentaStrengthU.mul(dotM));
    const outB = float(1.0).sub(yellowStrengthU.mul(dotY));
    const outK = float(1.0).sub(blackStrengthU.mul(dotK));

    const finalColor = vec3(outR, outG, outB).mul(outK);

    const colorNode = vec4(finalColor, float(1.0));

    return {
      colorNode,
      updateTexture(t: Texture) {
        mapTex.value = t;
      },
      getParams: () => ({
        pixelSize: pixelSizeU.value,
        dotSize: dotSizeU.value,
        cyanStrength: cyanStrengthU.value,
        magentaStrength: magentaStrengthU.value,
        yellowStrength: yellowStrengthU.value,
        blackStrength: blackStrengthU.value,
      }),
      setParams(p: Record<string, unknown>) {
        if (p.pixelSize != null) pixelSizeU.value = p.pixelSize as number;
        if (p.dotSize != null) dotSizeU.value = p.dotSize as number;
        if (p.cyanStrength != null)
          cyanStrengthU.value = p.cyanStrength as number;
        if (p.magentaStrength != null)
          magentaStrengthU.value = p.magentaStrength as number;
        if (p.yellowStrength != null)
          yellowStrengthU.value = p.yellowStrength as number;
        if (p.blackStrength != null)
          blackStrengthU.value = p.blackStrength as number;
      },
    };
  },

  buildUI(folder: FolderApi, instance: EffectInstance) {
    const obj = {
      pixelSize: 8.0,
      dotSize: 0.7,
      cyanStrength: 1.0,
      magentaStrength: 1.0,
      yellowStrength: 1.0,
      blackStrength: 1.0,
    };
    Object.assign(obj, instance.getParams());

    folder
      .addBinding(obj, "pixelSize", {
        min: 2,
        max: 32,
        step: 2,
        label: "Pixel Size",
      })
      .on("change", () => instance.setParams(obj));

    folder
      .addBinding(obj, "dotSize", {
        min: 0.25,
        max: 1.0,
        step: 0.05,
        label: "Dot Size",
      })
      .on("change", () => instance.setParams(obj));

    folder
      .addBinding(obj, "cyanStrength", {
        min: 0,
        max: 2,
        step: 0.05,
        label: "Cyan Strength",
      })
      .on("change", () => instance.setParams(obj));

    folder
      .addBinding(obj, "magentaStrength", {
        min: 0,
        max: 2,
        step: 0.05,
        label: "Magenta Strength",
      })
      .on("change", () => instance.setParams(obj));

    folder
      .addBinding(obj, "yellowStrength", {
        min: 0,
        max: 2,
        step: 0.05,
        label: "Yellow Strength",
      })
      .on("change", () => instance.setParams(obj));

    folder
      .addBinding(obj, "blackStrength", {
        min: 0,
        max: 2,
        step: 0.05,
        label: "Black Strength",
      })
      .on("change", () => instance.setParams(obj));
  },
};
