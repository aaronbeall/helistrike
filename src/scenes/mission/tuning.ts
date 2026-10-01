/** Mission-scene tuning constants shared by subsystems. */
/** Battery icon width (body + nub) at scale 1. */
export const BATTERY_ICON_W = 26.4;
export const BULLET_TIME_SCALE = 0.25;
export const BULLET_TIME_DURATION = 6;
export const BULLET_TIME_RECHARGE = 9;

/** Player chin / cabin traverse rate (rad/s) — also used by crew-served auto stations. */
export const GUN_STATION_TURN_RATE = 6.4;

/** AI gun-aim precision: seconds of continuous tracking to fully narrow from wide to tight jitter. */
export const AI_AIM_NARROW_BASE = 2.5;

/** AI gun-aim precision: freshly-acquired jitter is this many × the weapon's authored (fully-aimed) jitter. */
export const AI_AIM_WIDE_MUL = 2.2;

/** AI missile lock: base seconds of continuous tracking required to acquire lock before firing. */
export const AI_LOCK_BASE = 1.8;
/** Max AGL drones will climb/charge to — covers Lightning/Warthog, excludes Reaper (~620). */
export const DRONE_KAMIKAZE_AGL = 400;
