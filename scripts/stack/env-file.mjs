// Reading and editing .env without disturbing it: comments, order and other settings stay as
// they are. Pure (env-file.test.mjs).
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

export const readEnv = (text) => parseEnv(text);

const SETUP_HEADER = '# Chosen by pnpm stack:setup';

/**
 * Sets keys in .env text: an existing `KEY=` line is replaced where it is; a new key is added
 * under one "# Chosen by pnpm stack:setup" heading at the end. Unchanged values are left alone.
 * Returns the new text and what changed, as ["KEY: old → new", …].
 */
export function setEnv(text, updates) {
  const lines = text.split('\n');
  const changes = [];
  const added = [];
  for (const [key, value] of Object.entries(updates)) {
    const at = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (at >= 0) {
      const old = lines[at].slice(key.length + 1);
      if (old === value) continue;
      lines[at] = `${key}=${value}`;
      changes.push(`${key}: ${old || '(empty)'} → ${value}`);
    } else {
      added.push(`${key}=${value}`);
      changes.push(`${key}: (not set) → ${value}`);
    }
  }
  if (added.length === 0) return { text: lines.join('\n'), changes };

  while (lines.length && lines.at(-1) === '') lines.pop();
  if (!lines.includes(SETUP_HEADER)) lines.push('', SETUP_HEADER);
  // Keep setup's lines together under the heading, even when it already exists.
  const headerAt = lines.indexOf(SETUP_HEADER);
  let end = headerAt + 1;
  while (end < lines.length && /^[A-Z0-9_]+=/.test(lines[end])) end++;
  lines.splice(end, 0, ...added);
  return { text: `${lines.join('\n')}\n`, changes };
}

/** A new .env from .env.example, with a random key for both the API and the chat. */
export function newEnvFromExample(
  example,
  key = randomBytes(24).toString('hex'),
) {
  return example
    .replace(/^API_KEYS=.*$/m, `API_KEYS=${key}`)
    .replace(/^NORTHWIND_API_KEY=.*$/m, `NORTHWIND_API_KEY=${key}`);
}
