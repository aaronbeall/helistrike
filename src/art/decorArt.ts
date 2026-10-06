/** Terrain decor print art (`decor_<kind>`, sprites/decor/): plazas, runways, dams, fields, helipads; generated stub when a file is missing. */
import type { StructureKind, UnitStructureKind } from "../worldgen/settlements";

/** Settlement structures painted into the terrain instead of spawning as units. */
export type DecorKind = Exclude<StructureKind, UnitStructureKind>;

export interface DecorArtSpec {
  label: string;
  /** Real art (path under public/). Omit → generated placeholder. */
  file?: string;
}

const D = "sprites/decor/decor_";

export const DECOR_ART: Record<DecorKind, DecorArtSpec> = {
  plaza: { label: "Town plaza", file: `${D}plaza.png` },
  runway: { label: "Runway", file: `${D}runway.png` },
  dam: { label: "Dam", file: `${D}dam.png` },
  field_wheat: { label: "Wheat field", file: `${D}field_wheat.png` },
  field_green: { label: "Crop field", file: `${D}field_green.png` },
  field_plowed: { label: "Plowed field", file: `${D}field_plowed.png` },
  helipad: { label: "Helipad", file: `${D}helipad.png` },
};

/** Texture key for a decor kind (sprite rig preview). */
export function decorTexKey(kind: DecorKind): string {
  return `decor_${kind}`;
}

const loaded = new Map<DecorKind, CanvasImageSource>();
const stubs = new Map<DecorKind, HTMLCanvasElement>();

/** Register real art loaded by Phaser (replaces the stub). */
export function setDecorImage(kind: DecorKind, img: CanvasImageSource): void {
  loaded.set(kind, img);
}

/** Image for a decor print: real art if loaded, else the placeholder. Drawn with its long axis along +x. */
export function decorImage(kind: DecorKind): CanvasImageSource {
  return loaded.get(kind) ?? stubImage(kind);
}

// Placeholder size (px, long axis × short axis). Drawn once per kind; stretched into each footprint.
const STUB_L = 64;

function stubImage(kind: DecorKind): HTMLCanvasElement {
  let c = stubs.get(kind);
  if (c) return c;
  const aspect = kind === "runway" ? 0.07 : kind === "dam" ? 0.25 : 0.7;
  c = document.createElement("canvas");
  c.width = STUB_L;
  c.height = Math.max(4, Math.round(STUB_L * aspect));
  drawStub(c.getContext("2d")!, kind, c.width, c.height);
  stubs.set(kind, c);
  return c;
}

function drawStub(g: CanvasRenderingContext2D, kind: DecorKind, w: number, h: number): void {
  const rect = (x: number, y: number, rw: number, rh: number, fill: string) => {
    g.fillStyle = fill;
    g.fillRect(x, y, rw, rh);
  };
  const outline = (col = "rgba(20,18,14,0.75)") => {
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  };
  switch (kind) {
    case "plaza":
      rect(0, 0, w, h, "#a59c88");
      for (let x = 0; x < w; x += 8) rect(x, 0, 1, h, "rgba(0,0,0,0.15)");
      for (let y = 0; y < h; y += 8) rect(0, y, w, 1, "rgba(0,0,0,0.15)");
      g.fillStyle = "#6f8c5a";
      g.beginPath();
      g.arc(w / 2, h / 2, Math.min(w, h) * 0.18, 0, Math.PI * 2);
      g.fill();
      break;
    case "runway":
      rect(0, 0, w, h, "#3a3b3d");
      for (let x = 6; x < w - 6; x += 6) rect(x, h / 2 - 0.5, 3, 1, "#e6e2d6");
      rect(1, 0, 2, h, "#e6e2d6");
      rect(w - 3, 0, 2, h, "#e6e2d6");
      break;
    case "dam":
      rect(0, 0, w, h, "#9d9a92");
      rect(0, h * 0.35, w, h * 0.3, "#7e7b74");
      for (let x = w * 0.4; x < w * 0.6; x += 3) rect(x, 0, 1, h, "rgba(40,70,90,0.5)");
      outline("rgba(40,38,34,0.8)");
      break;
    default:
      rect(0, 0, w, h, "#7d8a5a");
      outline();
  }
}
