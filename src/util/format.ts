/** h:mm:ss (or m:ss under an hour). */
export function formatDuration(sec: number): string {
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** HUD distance, 10 m steps (finer readouts re-render text every frame while moving). */
export function formatMeters(dist: number): string {
  return `${Math.round(dist / 10) * 10}m`;
}
