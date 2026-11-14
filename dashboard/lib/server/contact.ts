/**
 * Where users are sent when we can't read a store automatically (no catalogue
 * file, and AI reading is switched off): they email the team and get the
 * analysis by mail. Set CONTACT_EMAIL to change it without a code change.
 */
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL?.trim() || 'sahoodhkr@gmail.com';

/** AI reading of stores with no catalogue file (Firecrawl, ~50 credits each). Off unless AI_READ=on. */
export const aiReadEnabled = (): boolean => process.env.AI_READ === 'on';

/** The reason shown on the brief and in the queue for a store that needs a manual read. */
export function manualReadMessage(store: string, why: string): string {
  return `We can't read ${store} automatically — ${why}. Want the analysis anyway? Email ${CONTACT_EMAIL} with the store name and we'll send you the results.`;
}
