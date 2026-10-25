#!/usr/bin/env node
// pnpm chat:bench: asks a running chat agent the nine benchmark questions
// (scripts/bench/questions.mjs), several times each, and scores every answer from key facts.
//
//   pnpm chat:bench                                  the dev agent on 127.0.0.1:5174, 3 runs
//   pnpm chat:bench --url http://127.0.0.1:5175 --runs 5 --label qwen3-8b
//
// Expected facts come from packages/seed/data/raw (seeded with the 10388-day shift, run in
// Q4 2026); see docs/benchmark.md. Full answers are written to bench-results/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { QUESTIONS, score } from './bench/questions.mjs';

// pnpm passes a literal "--" through; drop it so both `pnpm chat:bench --runs 5` forms work.
const { values: opts } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5174' },
    runs: { type: 'string', default: '3' },
    label: { type: 'string' },
    only: { type: 'string' },
  },
});
const RUNS = Number(opts.runs);

/** One question through /api/chat; the answer is the text after the last tool step. */
async function ask(question) {
  const started = performance.now();
  const res = await fetch(new URL('/api/chat', opts.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  const events = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  let answer = '';
  for (const e of events) {
    if (e.type === 'token') answer += e.text;
    if (e.type === 'step' && e.label !== 'Answer') answer = '';
  }
  const speeds = events
    .filter((e) => e.type === 'step' && e.tokensPerSecond)
    .map((e) => e.tokensPerSecond);
  return {
    answer: answer.trim(),
    seconds: (performance.now() - started) / 1000,
    tools: events
      .filter((e) => e.type === 'tool')
      .map((e) => ({ name: e.name, args: e.args, isError: e.isError })),
    errors: events.filter((e) => e.type === 'error').map((e) => e.message),
    tokensPerSecond: speeds.length
      ? speeds.reduce((a, b) => a + b, 0) / speeds.length
      : undefined,
  };
}

const catalog = await fetch(new URL('/api/tools', opts.url))
  .then((r) => r.json())
  .catch(() => null);
if (!catalog) {
  console.error(
    `No chat agent at ${opts.url}. Start it (pnpm dev) or pass --url.`,
  );
  process.exit(1);
}
const model = catalog.llm.model;
const label =
  opts.label ?? model.split('/').pop().replace(/[:]/g, '-').toLowerCase();
const selected = opts.only
  ? opts.only.split(',').map(Number)
  : QUESTIONS.map((_, i) => i + 1);
console.log(
  `Benchmark: ${model} at ${opts.url}, ${selected.length} questions × ${RUNS} runs\n`,
);

const results = [];
for (const n of selected) {
  const item = QUESTIONS[n - 1];
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const run = await ask(item.q);
    const s = run.errors.length
      ? {
          verdict: 'fail',
          missing: [],
          wrong: [],
          error: run.errors.join('; '),
        }
      : score(run.answer, item);
    runs.push({ ...run, ...s });
    process.stdout.write(
      s.verdict === 'pass' ? '✅' : s.verdict === 'partial' ? '⚠️ ' : '❌',
    );
  }
  const passes = runs.filter((r) => r.verdict === 'pass').length;
  const avg = (key) =>
    runs.reduce(
      (a, r) => a + (typeof r[key] === 'number' ? r[key] : r[key].length),
      0,
    ) / runs.length;
  console.log(
    `  ${n}. ${item.q}  ${passes}/${RUNS} right · ${avg('seconds').toFixed(1)} s · ${avg('tools').toFixed(1)} tool calls`,
  );
  for (const r of runs.filter((x) => x.verdict !== 'pass')) {
    console.log(
      `       ${r.verdict}: ${r.error ?? [r.missing.length && `missing ${r.missing.join(', ')}`, r.wrong.length && `wrong ${r.wrong.join(', ')}`].filter(Boolean).join('; ')}`,
    );
  }
  results.push({ n, question: item.q, runs });
}

const all = results.flatMap((r) => r.runs);
const perRun = all.filter((r) => r.verdict === 'pass').length / RUNS;
const partial = all.filter((r) => r.verdict === 'partial').length / RUNS;
const speeds = all.map((r) => r.tokensPerSecond).filter(Boolean);
console.log(
  `\n${model}: ${perRun.toFixed(1)} of ${selected.length} right per run on average (${partial.toFixed(1)} partial)` +
    ` · ${(all.reduce((a, r) => a + r.seconds, 0) / all.length).toFixed(1)} s per answer` +
    (speeds.length
      ? ` · ${(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(0)} tokens/s`
      : ''),
);

const dir = join(import.meta.dirname, '..', 'bench-results');
mkdirSync(dir, { recursive: true });
const file = join(
  dir,
  `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.json`,
);
writeFileSync(
  file,
  JSON.stringify(
    { model, url: opts.url, runs: RUNS, perRun, partial, results },
    null,
    2,
  ),
);
console.log(`Full answers: ${file}`);
