/**
 * pnpm seed            seeds MONGO_URI (from the environment or the repo's .env)
 * pnpm seed -- --yes   required when MONGO_URI points somewhere other than this machine
 *
 * SEED_ANCHOR_DATE=YYYY-MM-DD fixes the date shift for reproducible data.
 */
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';
import { parseIsoDate, utcToday } from './dates';
import { seedDatabase } from './seed';

async function main(): Promise<void> {
  // Same lookup as the API: a package-level .env first, then the repo root one.
  // Variables already set in the environment win.
  for (const file of ['.env', '../../.env']) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set (see .env.example).');

  const target = describeTarget(uri);
  if (!target.local && !process.argv.includes('--yes')) {
    throw new Error(
      `Refusing to reset ${target.label}: it is not on this machine. ` +
        'Re-run with --yes if you really mean it.',
    );
  }

  const anchor = process.env.SEED_ANCHOR_DATE
    ? parseIsoDate(process.env.SEED_ANCHOR_DATE)
    : utcToday();

  console.log(`Seeding ${target.label} (anchor ${isoDate(anchor)})…`);
  const connection = await mongoose
    .createConnection(uri, { autoIndex: false })
    .asPromise();

  try {
    const result = await seedDatabase(connection, { anchor });

    console.table({ ...result.counts, ...result.embeddedCounts });
    console.log(
      `Dates shifted by ${result.dateShiftDays} days (${(result.dateShiftDays / 7).toFixed(0)} weeks).`,
    );
    if (result.phonesKeptAsIs.length > 0) {
      console.log(
        `Phones kept as written (couldn't be read as numbers): ${result.phonesKeptAsIs
          .map((p) => `${p.record} ${p.phone}`)
          .join('; ')}`,
      );
    }
    console.log(`Done in ${result.durationMs} ms.`);
  } finally {
    await connection.close();
  }
}

/** Host and database for display, never credentials. */
function describeTarget(uri: string): { label: string; local: boolean } {
  const url = new URL(uri);
  const hosts = url.host.split(',').map((h) => h.replace(/:\d+$/, ''));
  const local = hosts.every((h) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(h),
  );
  const database = url.pathname.replace(/^\//, '') || '(default database)';
  return { label: `${url.host}/${database}`, local };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
