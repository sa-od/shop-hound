import { db, WATCHLIST } from './db';

/**
 * The user's choices about each watched store, on top of automatic tracking
 * (tracking.ts derives WHAT is watched from dashboard runs). One document per
 * store key; no document = the defaults (watched while tracked, not paused).
 *
 *  - paused:  still listed, but the
 *             daily check skips it. Resume clears it.
 *  - removed: stop watching and hide it from the lists. Its briefs and
 *             snapshots are kept (nothing is deleted). Adding the store again
 *             from the dashboard clears it.
 */

export type WatchState = 'paused' | 'removed';

export interface WatchEntry {
  state?: WatchState;
}

interface WatchDoc extends WatchEntry {
  _id: string;
  updatedAt: Date;
}

const coll = () => db().collection<WatchDoc>(WATCHLIST);

/** Every store's watch entry, in one query (the collection holds one small doc per store). */
export async function loadWatchlist(): Promise<Map<string, WatchEntry>> {
  const docs = await coll().find({}).toArray();
  return new Map(docs.map(d => [d._id, (d.state ? { state: d.state } : {})]));
}

export async function setWatchState(key: string, state: WatchState | null): Promise<void> {
  await coll().updateOne(
    { _id: key },
    { ...(state ? { $set: { state, updatedAt: new Date() } } : { $set: { updatedAt: new Date() }, $unset: { state: '' } }) },
    { upsert: true },
  );
}

/** A user added the store again: it's watched again (not removed, not paused). */
export async function watchAgain(key: string): Promise<void> {
  await coll().updateOne({ _id: key, state: { $exists: true } }, { $unset: { state: '' }, $set: { updatedAt: new Date() } });
}
