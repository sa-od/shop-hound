/**
 * Run the full pipeline once from the terminal, against the real services.
 *
 *   npx tsx --env-file=.env.local scripts/run-once.ts goodr.com magicspoon.com
 *   npx tsx --env-file=.env.local scripts/run-once.ts injection-demo.test
 *
 * No deadline by default; pass --deadline=300 to rehearse the Hobby limit.
 */
import { runAnalysis } from '../lib/server/pipeline';
import { startRunNow, finishRun } from '../lib/server/runs';
import { closeDb } from '../lib/server/db';

async function main() {
  const args = process.argv.slice(2);
  const deadlineArg = args.find(a => a.startsWith('--deadline='));
  const competitors = args.filter(a => !a.startsWith('--'));
  const deadlineAt = deadlineArg ? Date.now() + Number.parseInt(deadlineArg.split('=')[1], 10) * 1000 : undefined;

  const started = Date.now();
  const run = await startRunNow({ competitors, trigger: 'cli' });
  console.log(`run ${run.runId} started (${competitors.join(', ') || 'COMPETITOR_STORES'})`);
  try {
    const result = await runAnalysis({
      competitors,
      deadlineAt,
      log: m => console.log(`+${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s ${m}`),
    });
    await finishRun(run.runId, { status: 'success', briefId: result.briefId });
    console.log(`\n${'─'.repeat(72)}\n${result.brief}\n${'─'.repeat(72)}`);
    console.log(`greenLight=${result.greenLight} briefId=${result.briefId} weekOf=${result.weekOf} vectors=${result.vectorsUpserted}`);
    console.log('grounding:', result.auditLog.grounding.greenLight, result.auditLog.grounding.violations);
    console.log('safety:   ', result.auditLog.safety.greenLight, result.auditLog.safety.violations);
  } catch (err) {
    const { classifyFailure } = await import('../lib/server/failure');
    await finishRun(run.runId, { status: 'failed', error: String(err instanceof Error ? (err.stack ?? err.message) : err), failureKind: classifyFailure(err) });
    throw err;
  } finally {
    console.log(`took ${Math.round((Date.now() - started) / 1000)}s`);
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
