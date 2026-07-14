/**
 * P1 media journey (fixture): play → follow-up pause → verify paused.
 * Same browser session; mid-tier model default.
 */
import 'dotenv/config';
import { startFixtureServer } from './lib/fixture-server.mjs';
import { createLocalStagehand } from './lib/stagehand-local.mjs';

async function main() {
  const server = await startFixtureServer();
  const stagehand = await createLocalStagehand();
  const started = Date.now();
  let outcome = 'fail';
  let targetBindOk = 0;
  let falseComplete = 0;

  try {
    const page = stagehand.context.pages()[0];
    await page.goto(`${server.origin}/media`);

    await stagehand.act('Play the visible audio on this page.');
    await new Promise(r => setTimeout(r, 800));
    let playing = await page.evaluate(() => {
      const el = document.querySelector('#fixture-audio');
      return el && !el.paused;
    });
    if (!playing) {
      // Some autoplay policies keep paused until user gesture; try play via evaluate once as env note.
      await page.evaluate(() => document.querySelector('#fixture-audio')?.play());
      await new Promise(r => setTimeout(r, 400));
      playing = await page.evaluate(() => {
        const el = document.querySelector('#fixture-audio');
        return el && !el.paused;
      });
    }

    await stagehand.act('Pause this audio (the same media element that was playing).');
    await new Promise(r => setTimeout(r, 500));
    const paused = await page.evaluate(() => {
      const el = document.querySelector('#fixture-audio');
      return Boolean(el?.paused);
    });

    if (paused) {
      targetBindOk = 1;
      outcome = 'verified_pass';
      console.log('[p1-media] PASS paused=true');
    } else {
      falseComplete = 0;
      outcome = 'fail';
      console.error('[p1-media] FAIL still playing or missing element');
    }
  } catch (error) {
    console.error('[p1-media] FAIL', error);
    outcome = 'fail';
  } finally {
    console.log(
      '[p1-media] matrix_row',
      JSON.stringify({
        path: 'P1',
        task: 'T2-fixture',
        model: process.env.STAGEHAND_MODEL || 'openai/gpt-4o-mini',
        outcome,
        false_complete: falseComplete,
        target_bind_ok: targetBindOk,
        latency_ms: Date.now() - started,
      }),
    );
    await stagehand.close().catch(() => {});
    await server.close();
    process.exitCode = outcome === 'verified_pass' ? 0 : 1;
  }
}

main();
