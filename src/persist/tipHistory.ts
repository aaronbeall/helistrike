/** How many times each tactical tip has been shown (persists across sessions; drives least-shown-first ordering). */
import { storage } from "../util/storage";

const TIPS_SHOWN_KEY = "tipsShown";

let counts: Record<string, number> = {};

/** Load the counts (once, at boot). */
export async function loadTipHistory(): Promise<void> {
  counts = (await storage().read<Record<string, number>>(TIPS_SHOWN_KEY)) ?? {};
}

/** Times shown, by tip id. */
export function tipShownCounts(): Readonly<Record<string, number>> {
  return counts;
}

/** A tip was put on screen: count it and save. */
export function markTipShown(id: string): void {
  counts[id] = (counts[id] ?? 0) + 1;
  void storage().write(TIPS_SHOWN_KEY, counts);
}
