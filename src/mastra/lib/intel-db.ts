import { createClient, type Client } from '@libsql/client';
import { competitorSnapshotSchema, type CompetitorSnapshot } from './types';

/**
 * Main Database (relational half of the memory split, PRD §6):
 *  - normalized competitor snapshots ("Save Normalized Data" edge) — the exact
 *    payload the deterministic diff engine compares against
 *  - the Official Record of verified growth briefs (+ guardrail audit log)
 * Mastra's own working memory lives in mastra.db; this file is domain data.
 */

let client: Client | null = null;
let initialized = false;

function db(): Client {
  client ??= createClient({ url: process.env.INTEL_DB_URL ?? 'file:./intel.db' });
  return client;
}

async function init(): Promise<Client> {
  const c = db();
  if (!initialized) {
    await c.batch([
      `CREATE TABLE IF NOT EXISTS snapshots (
        competitor TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        products_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (competitor, snapshot_date)
      )`,
      `CREATE TABLE IF NOT EXISTS briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_of TEXT NOT NULL,
        brief_markdown TEXT NOT NULL,
        green_light INTEGER NOT NULL,
        grounding_json TEXT NOT NULL,
        safety_json TEXT NOT NULL,
        diff_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ]);
    initialized = true;
  }
  return c;
}

export async function saveSnapshot(snapshot: CompetitorSnapshot): Promise<void> {
  const c = await init();
  await c.execute({
    sql: `INSERT OR REPLACE INTO snapshots (competitor, snapshot_date, products_json) VALUES (?, ?, ?)`,
    args: [snapshot.competitor, snapshot.snapshotDate, JSON.stringify(snapshot.products)],
  });
}

/** Most recent snapshot for a competitor strictly BEFORE the given date. */
export async function getPreviousSnapshot(
  competitor: string,
  beforeDate: string,
): Promise<CompetitorSnapshot | null> {
  const c = await init();
  const res = await c.execute({
    sql: `SELECT snapshot_date, products_json FROM snapshots
          WHERE competitor = ? AND snapshot_date < ?
          ORDER BY snapshot_date DESC LIMIT 1`,
    args: [competitor, beforeDate],
  });
  const row = res.rows[0];
  if (!row) return null;
  return competitorSnapshotSchema.parse({
    competitor,
    snapshotDate: row.snapshot_date as string,
    products: JSON.parse(row.products_json as string),
  });
}

export async function saveBrief(args: {
  weekOf: string;
  briefMarkdown: string;
  greenLight: boolean;
  grounding: unknown;
  safety: unknown;
  diff: unknown;
}): Promise<number> {
  const c = await init();
  const res = await c.execute({
    sql: `INSERT INTO briefs (week_of, brief_markdown, green_light, grounding_json, safety_json, diff_json)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      args.weekOf,
      args.briefMarkdown,
      args.greenLight ? 1 : 0,
      JSON.stringify(args.grounding),
      JSON.stringify(args.safety),
      JSON.stringify(args.diff),
    ],
  });
  return Number(res.lastInsertRowid);
}

export async function listBriefs(limit = 20) {
  const c = await init();
  const res = await c.execute({
    sql: `SELECT id, week_of, green_light, created_at, brief_markdown FROM briefs
          ORDER BY id DESC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map(r => ({
    id: Number(r.id),
    weekOf: r.week_of as string,
    greenLight: Boolean(r.green_light),
    createdAt: r.created_at as string,
    briefMarkdown: r.brief_markdown as string,
  }));
}
