/**
 * Settlement structure art (top-down, painted into the terrain). Each kind has a generated placeholder; set
 * `file` to a sprite path (under public/) to use real art — preloadArt loads it and it replaces the stub.
 */
import type { StructureKind } from "../worldgen/settlements";

export interface StructureArtSpec {
  label: string;
  /** Real art (path under public/), when it exists. Omit → generated placeholder. */
  file?: string;
  /** Destroyed art, for kinds that spawn as units. */
  hulk?: string;
  /** Ground-level body for a roofed structure (`struct_<kind>_base`, wreck `struct_<kind>_base_hulk`), `size` world units square. */
  base?: { file: string; size: number; hulk?: string };
  /** Baked from another kind's art (and hulk): horizontal slice `x0`–`x1` (fractions of its width). */
  crop?: { from: StructureKind; x0: number; x1: number };
}

export const STRUCTURE_ART: Record<StructureKind, StructureArtSpec> = {
  house: { label: "House", file: "sprites/structures/house.png", hulk: "sprites/structures/house_hulk.png" },
  warehouse: { label: "Warehouse", file: "sprites/structures/warehouse.png", hulk: "sprites/structures/warehouse_hulk.png" },
  plaza: { label: "Town plaza", file: "sprites/structures/plaza.png" },
  runway: { label: "Runway", file: "sprites/structures/runway.png" },
  hangar: { label: "Hangar", file: "sprites/structures/hangar.png", hulk: "sprites/structures/hangar_hulk.png" },
  control_tower: { label: "Control tower", file: "sprites/structures/control_tower.png", hulk: "sprites/structures/control_tower_hulk.png" },
  pier: { label: "Pier", file: "sprites/structures/pier.png" },
  dock_shed: { label: "Dock shed", file: "sprites/structures/dock_shed.png", hulk: "sprites/structures/dock_shed_hulk.png" },
  dam: { label: "Dam", file: "sprites/structures/dam.png" },
  field_wheat: { label: "Wheat field", file: "sprites/structures/field_wheat.png" },
  field_green: { label: "Crop field", file: "sprites/structures/field_green.png" },
  field_plowed: { label: "Plowed field", file: "sprites/structures/field_plowed.png" },
  helipad: { label: "Helipad", file: "sprites/structures/helipad.png" },
  pylon: {
    label: "Power pylon",
    file: "sprites/structures/pylon.png",
    hulk: "sprites/structures/pylon_hulk.png",
    base: { file: "sprites/structures/pylon_base.png", size: 28, hulk: "sprites/structures/pylon_base_hulk.png" },
  },
  bridge: { label: "Bridge", file: "sprites/structures/bridge.png", hulk: "sprites/structures/bridge_hulk.png" },
  bridge_steel: {
    label: "Steel bridge",
    file: "sprites/structures/bridge_steel.png",
    hulk: "sprites/structures/bridge_steel_hulk.png",
  },
  power_station: { label: "Power station", file: "sprites/structures/power_station.png", hulk: "sprites/structures/power_station_hulk.png" },
  silo: { label: "Grain silos", file: "sprites/structures/silo.png", hulk: "sprites/structures/silo_hulk.png" },
  silo_single: { label: "Grain silo", crop: { from: "silo", x0: 0, x1: 0.48 } },
  oil_rig: { label: "Oil rig", file: "sprites/structures/oil_rig.png", hulk: "sprites/structures/oil_rig_hulk.png" },
  sea_platform: { label: "Heli platform", file: "sprites/structures/sea_platform.png", hulk: "sprites/structures/sea_platform_hulk.png" },
  military_helipad: { label: "Military helipad", crop: { from: "helipad", x0: 0, x1: 1 } },
  military_platform: { label: "Military heli platform", crop: { from: "sea_platform", x0: 0, x1: 1 } },
  dock_building: { label: "Dock house", file: "sprites/structures/dock_building.png", hulk: "sprites/structures/dock_building_hulk.png" },
  fishing_boat: { label: "Fishing boat", file: "sprites/structures/fishing_boat.png", hulk: "sprites/structures/fishing_boat_hulk.png" },
  yacht: { label: "Yacht", file: "sprites/structures/yacht.png", hulk: "sprites/structures/yacht_hulk.png" },
};

/** Texture key for a structure kind (sprite rig + loaded art). */
export function structureTexKey(kind: StructureKind): string {
  return `struct_${kind}`;
}

const loaded = new Map<StructureKind, CanvasImageSource>();
const stubs = new Map<StructureKind, HTMLCanvasElement>();

/** Register real art loaded by Phaser (replaces the stub everywhere). */
export function setStructureImage(kind: StructureKind, img: CanvasImageSource): void {
  loaded.set(kind, img);
}

/** Image for a structure: real art if loaded, else the placeholder. Drawn with its long axis along +x. */
export function structureImage(kind: StructureKind): CanvasImageSource {
  return loaded.get(kind) ?? stubImage(kind);
}

// Placeholder size (px, long axis × short axis). Drawn once per kind; stretched into each footprint.
const STUB_L = 64;

function stubImage(kind: StructureKind): HTMLCanvasElement {
  let c = stubs.get(kind);
  if (c) return c;
  const aspect = kind === "runway" ? 0.07 : kind === "pier" ? 0.17 : kind === "dam" ? 0.25 : kind === "bridge_steel" ? 0.35 : 0.7;
  c = document.createElement("canvas");
  c.width = STUB_L;
  c.height = Math.max(4, Math.round(STUB_L * aspect));
  drawStub(c.getContext("2d")!, kind, c.width, c.height);
  stubs.set(kind, c);
  return c;
}

function drawStub(g: CanvasRenderingContext2D, kind: StructureKind, w: number, h: number): void {
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
    case "house":
      rect(0, 0, w, h, "#8c4a32");
      rect(0, h / 2 - 1, w, 2, "#5e2f20");
      for (let x = 4; x < w; x += 6) rect(x, 0, 1, h, "rgba(0,0,0,0.12)");
      outline();
      break;
    case "warehouse":
      rect(0, 0, w, h, "#8a8e90");
      for (let x = 3; x < w; x += 5) rect(x, 0, 2, h, "rgba(255,255,255,0.12)");
      outline();
      break;
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
    case "hangar":
      rect(0, 0, w, h, "#6d7a6a");
      for (let y = 3; y < h; y += 4) rect(0, y, w, 1, "rgba(255,255,255,0.18)");
      rect(0, 0, 3, h, "#3e463c");
      outline();
      break;
    case "control_tower":
      rect(0, 0, w, h, "#b9b6ab");
      g.fillStyle = "#4d6f86";
      g.beginPath();
      g.arc(w / 2, h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
      g.fill();
      outline();
      break;
    case "pier":
      rect(0, 0, w, h, "#7a5c3c");
      for (let x = 0; x < w; x += 3) rect(x, 0, 1, h, "rgba(0,0,0,0.25)");
      break;
    case "dock_shed":
      rect(0, 0, w, h, "#4f6e86");
      for (let x = 3; x < w; x += 5) rect(x, 0, 2, h, "rgba(255,255,255,0.14)");
      outline();
      break;
    case "bridge_steel":
      rect(0, 0, w, h, "#55585a");
      rect(0, h / 2 - 0.5, w, 1, "#d8c25a");
      rect(0, 0, w, h * 0.16, "#7b4a32");
      rect(0, h * 0.84, w, h * 0.16, "#7b4a32");
      for (let x = 0; x < w; x += 8) {
        rect(x, 0, 2, h * 0.16, "#3a2a20");
        rect(x, h * 0.84, 2, h * 0.16, "#3a2a20");
      }
      break;
    case "dam":
      rect(0, 0, w, h, "#9d9a92");
      rect(0, h * 0.35, w, h * 0.3, "#7e7b74");
      for (let x = w * 0.4; x < w * 0.6; x += 3) rect(x, 0, 1, h, "rgba(40,70,90,0.5)");
      outline("rgba(40,38,34,0.8)");
      break;
  }
}
