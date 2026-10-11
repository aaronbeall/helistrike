/** Camo pattern names and the `<texture>__<camo>` skin-key suffix (data; importable from any layer). */
export const CAMO_NAMES = ["woodland", "desert", "urban", "snow", "digital", "naval", "dazzle"] as const;
export type CamoKind = (typeof CAMO_NAMES)[number];

/** "theater" = the map theme's pattern; "biome" = the theme's pattern for the spawn biome; a list = uniform pick, "none" entries spawn bare. */
export type CamoRoll = "theater" | "biome" | readonly (CamoKind | "none")[];
/** Matches a skinned texture key's camo suffix. */
export const CAMO_SUFFIX = new RegExp(`__(${CAMO_NAMES.join("|")})$`);

export function stripCamoSuffix(key: string): string {
  return key.replace(CAMO_SUFFIX, "");
}
