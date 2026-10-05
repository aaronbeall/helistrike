/** Player persistence: load everything once at boot; reads are then synchronous, writes save in the background. */
import { loadStatsStore } from "./statsStore";
import { loadTipHistory } from "./tipHistory";

export async function loadPersistence(): Promise<void> {
  await Promise.all([loadStatsStore(), loadTipHistory()]);
}
