#!/usr/bin/env node
// The stack's setup tools. Plain Node (no pnpm install needed), the same on macOS, Linux and
// Windows:
//
//   node scripts/stack/cli.mjs doctor              (or: pnpm stack:doctor)
//       checks this machine and the repo, and says which model server fits it
//   node scripts/stack/cli.mjs setup [options]     (or: pnpm stack:setup)
//       everything from a fresh checkout to a running chat; safe to re-run
//
// Setup options:
//   --dry-run                 show each step without doing it
//   --provider <name>         docker-model-runner | ollama | openai-compatible
//                             (default: .env's, else asked, suggesting one for this machine)
//   --model <name>            the model (default: the provider's Qwen3 4B)
//   --url <url>               openai-compatible: the server as the stack's container sees it
//   --nvidia / --no-nvidia    ollama: use the NVIDIA GPU (default: when one is found)
//   --yes                     take the suggestions without asking
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { evaluate } from './checks.mjs';
import { readEnv } from './env-file.mjs';
import { collectFacts, setup, SetupError } from './setup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const MARK = { ok: paint(32, '✓'), warn: paint(33, '!'), bad: paint(31, '✗') };

const ui = {
  step: (text) => console.log(`\n${paint(1, `▸ ${text}`)}`),
  note: (text) => console.log(`  ${text}`),
  command: (text) => console.log(`  ${paint(2, `$ ${text}`)}`),
  printChecks(sections) {
    for (const { title, items } of sections) {
      console.log(title);
      for (const { level, text } of items)
        console.log(`  ${MARK[level]} ${text}`);
    }
  },
};

function usage() {
  const text = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  console.log(
    text
      .slice(
        1,
        text.findIndex((line) => line.startsWith('import')),
      )
      .map((l) => l.replace(/^\/\/ ?/, ''))
      .join('\n'),
  );
}

async function main() {
  const { values: opts, positionals } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== '--'),
    allowPositionals: true,
    allowNegative: true,
    options: {
      'dry-run': { type: 'boolean' },
      provider: { type: 'string' },
      model: { type: 'string' },
      url: { type: 'string' },
      nvidia: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (opts.help || !['doctor', 'setup'].includes(command)) {
    usage();
    process.exit(opts.help ? 0 : 2);
  }

  if (command === 'doctor') {
    const envPath = join(root, '.env');
    const envExists = existsSync(envPath);
    const env = envExists ? readEnv(readFileSync(envPath, 'utf8')) : {};
    const verdict = evaluate(await collectFacts(root, env, envExists));
    ui.printChecks(verdict.sections);
    if (verdict.failed)
      console.log('\nFix the ✗ items above, then run this again.');
    process.exit(verdict.failed ? 1 : 0);
  }

  await setup(
    root,
    {
      dryRun: opts['dry-run'],
      provider: opts.provider,
      model: opts.model,
      url: opts.url,
      nvidia: opts.nvidia,
      yes: opts.yes,
    },
    ui,
  );
}

main().catch((error) => {
  if (
    error instanceof SetupError ||
    error?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
  ) {
    console.error(`\n${paint(31, '✗')} ${error.message}`);
    process.exit(1);
  }
  throw error;
});
