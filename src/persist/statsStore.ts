/** Stats persistence: the mission history (one entry per mission, append-only) and the lifetime totals derived from it. */
import {
  addTables,
  bookOf,
  emptyBook,
  recordOf,
  restoreTables,
  STATS_VERSION,
  type MissionRecord,
  type MissionRun,
  type StatsBook,
} from "../sim/stats";
import { storage } from "../util/storage";

const BOOK_KEY = "stats";
const MISSION_PREFIX = "mission:";

let book: StatsBook = emptyBook();
/** Newest first. */
let history: MissionRecord[] = [];

/** Load the history and lifetime totals (once, at boot); totals out of step with the history are rebuilt from it. */
export async function loadStatsStore(): Promise<void> {
  const store = storage();
  const [entries, saved] = await Promise.all([store.list<MissionRecord>(MISSION_PREFIX), store.read<StatsBook>(BOOK_KEY)]);
  history = entries
    .map(([, r]) => r)
    .filter((r) => r?.version === STATS_VERSION && !!r.result)
    .map((r) => ({ version: r.version, result: r.result, ...restoreTables(r) }))
    .sort((a, b) => b.result.at - a.result.at);
  if (saved?.version === STATS_VERSION && saved.missions === history.length) {
    book = { version: STATS_VERSION, missions: saved.missions, ...restoreTables(saved) };
  } else {
    book = bookOf(history);
    void store.write(BOOK_KEY, book);
  }
}

/** Lifetime totals across every recorded mission. */
export function lifetimeStats(): StatsBook {
  return book;
}

/** Every recorded mission, newest first. */
export function missionHistory(): readonly MissionRecord[] {
  return history;
}

/** Record a finished mission: append it to the history and add it to the lifetime totals. */
export function commitRun(run: MissionRun): void {
  const record = recordOf(run);
  if (!record) return;
  history.unshift(record);
  addTables(book, record);
  book.missions++;
  const store = storage();
  const key = `${MISSION_PREFIX}${record.result.at}-${Math.random().toString(36).slice(2, 8)}`;
  void store.write(key, record).then(() => store.write(BOOK_KEY, book));
}
