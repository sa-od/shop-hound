import { db, BRIEFS } from './db';
import { changesFromCompetitorDiff, rankChanges, type Change } from './changes';
import { WEEK_DAYS } from './briefs-store';
import type { CompetitorDiff } from './types';

/**
 * "This week": a ranked feed of changes across every watched store, over a
 * ROLLING window (the last `days` days, not a calendar week).
 *
 * Per store, the latest COMPARED (verified) read in the window gives its
 * changes; a store whose only reads in the window are first reads is listed
 * under firstReads; a watched store with no read in the window is unread,
 * with the latest reason we have. Facts are template-built (changes.ts).
 *
 * One aggregation over the window's briefs (grouped per store in the
 * database), plus the watch state (a fixed number of queries, not per store).
 */

export interface ThisWeek {
  window: { from: string; to: string };
  stores: {
    /** Stores being watched (active or paused). */
    watched: number;
    /** Watched stores read at least once in the window. */
    read: number;
    unread: { store: string; reason: string }[];
  };
  /** Ranked 1..n across all stores. */
  changes: Change[];
  /** Watched stores whose only reads in the window were first reads (nothing to compare yet). */
  firstReads: { store: string; productCount: number; readAt: string; nextCheck: string | null }[];
}

interface Row {
  _id: string; // store domain
  best: { briefId: unknown; createdAt: Date; d: CompetitorDiff };
  latest: { createdAt: Date; status: string; reason?: string | null };
}

export async function getThisWeek(opts: { days?: number; now?: Date } = {}): Promise<ThisWeek> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? WEEK_DAYS;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const [rows, { listTrackedSets }] = await Promise.all([
    db()
      .collection(BRIEFS)
      .aggregate<Row>([
        { $match: { createdAt: { $gte: from, $lte: now } } },
        { $project: { createdAt: 1, competitors: 1, d: '$diff.diffs' } },
        { $unwind: '$d' },
        {
          $addFields: {
            // verified (compared) > first read > not read
            readRank: { $switch: { branches: [{ case: { $eq: ['$d.status', 'verified'] }, then: 2 }, { case: { $eq: ['$d.status', 'first_snapshot'] }, then: 1 }], default: 0 } },
            reason: {
              $first: {
                $map: { input: { $filter: { input: { $ifNull: ['$competitors', []] }, as: 'c', cond: { $eq: ['$$c.competitor', '$d.competitor'] } } }, as: 'c', in: '$$c.reason' },
              },
            },
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$d.competitor',
            best: { $topN: { n: 1, sortBy: { readRank: -1, createdAt: -1 }, output: { briefId: '$_id', createdAt: '$createdAt', d: '$d' } } },
            latest: { $first: { createdAt: '$createdAt', status: '$d.status', reason: '$reason' } },
          },
        },
        { $set: { best: { $first: '$best' } } },
      ])
      .toArray(),
    import('./tracking'),
  ]);

  // Watched = tracked sets (removed ones are excluded there), by store.
  const sets = await listTrackedSets(now);
  const watchedBy = new Map<string, (typeof sets)[number]>();
  for (const s of sets) for (const c of s.competitors) watchedBy.set(c, s);
  const byStore = new Map(rows.map(r => [r._id, r]));

  const changes: Change[] = [];
  const firstReads: ThisWeek['firstReads'] = [];
  const unread: ThisWeek['stores']['unread'] = [];
  let read = 0;
  for (const [store, set] of [...watchedBy].sort(([a], [b]) => a.localeCompare(b))) {
    const r = byStore.get(store);
    const status = r?.best.d.status;
    if (status === 'verified') {
      read++;
      changes.push(...changesFromCompetitorDiff(r!.best.d, String(r!.best.briefId)));
    } else if (status === 'first_snapshot') {
      read++;
      firstReads.push({
        store,
        productCount: r!.best.d.catalog?.productCount ?? r!.best.d.productCount,
        readAt: r!.best.createdAt.toISOString(),
        nextCheck: set.paused ? null : set.nextCheck,
      });
    } else {
      unread.push({
        store,
        reason: r?.latest.reason || (r ? 'The store couldn’t be read' : set.lastBriefAt ? `Not checked in the last ${days} days` : 'Not checked yet'),
      });
    }
  }

  return {
    window: { from: from.toISOString(), to: now.toISOString() },
    stores: { watched: watchedBy.size, read, unread },
    changes: rankChanges(changes),
    firstReads,
  };
}
