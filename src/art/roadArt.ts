/** Road ribbon art (seamless horizontal tiles), once loaded. Bridges are structures (`structureArt`). */

export type RoadArtKind = "road" | "paved";

/** Real tiles; a kind without one falls back to the dirt road. */
export const ROAD_ART: Partial<Record<RoadArtKind, string>> = {
  road: "sprites/roads/road.png",
  paved: "sprites/roads/road_paved.png",
};

type Img = HTMLImageElement | HTMLCanvasElement;
const loaded = new Map<RoadArtKind, Img>();

/** Register real art loaded by Phaser. */
export function setRoadImage(kind: RoadArtKind, img: Img): void {
  loaded.set(kind, img);
}

/** Loaded tile for a road ribbon, if any. */
export function roadImage(kind: RoadArtKind): Img | undefined {
  return loaded.get(kind);
}
