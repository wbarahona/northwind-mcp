// pnpm stack:test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newEnvFromExample, readEnv, setEnv } from './env-file.mjs';

const today = `# Copy to .env and adjust.
API_KEYS=abc
NORTHWIND_API_KEY=abc

# Chat agent
LLM_MODEL=hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M
`;

describe('setEnv', () => {
  it('adds new keys under one heading at the end and changes nothing else', () => {
    const { text, changes } = setEnv(today, {
      LLM_PROVIDER: 'docker-model-runner',
      COMPOSE_FILE: 'docker-compose.yml:compose.model-runner.yml',
    });
    assert.equal(
      text,
      `${today}\n# Chosen by pnpm stack:setup\nLLM_PROVIDER=docker-model-runner\nCOMPOSE_FILE=docker-compose.yml:compose.model-runner.yml\n`,
    );
    assert.deepEqual(changes, [
      'LLM_PROVIDER: (not set) → docker-model-runner',
      'COMPOSE_FILE: (not set) → docker-compose.yml:compose.model-runner.yml',
    ]);
  });

  it('replaces an existing key where it is, and leaves equal values alone', () => {
    const { text, changes } = setEnv(today, {
      LLM_MODEL: 'qwen3:4b',
      API_KEYS: 'abc',
    });
    assert.equal(
      text,
      today.replace(
        'LLM_MODEL=hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M',
        'LLM_MODEL=qwen3:4b',
      ),
    );
    assert.deepEqual(changes, [
      'LLM_MODEL: hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M → qwen3:4b',
    ]);
  });

  it('is idempotent: a second run changes nothing', () => {
    const once = setEnv(today, { LLM_PROVIDER: 'ollama' }).text;
    const twice = setEnv(once, { LLM_PROVIDER: 'ollama' });
    assert.equal(twice.text, once);
    assert.deepEqual(twice.changes, []);
  });

  it('keeps later additions under the same heading', () => {
    const once = setEnv(today, { LLM_PROVIDER: 'ollama' }).text;
    const { text } = setEnv(`${once}\n# mine\nFOO=1\n`, { COMPOSE_FILE: 'x' });
    assert.match(
      text,
      /# Chosen by pnpm stack:setup\nLLM_PROVIDER=ollama\nCOMPOSE_FILE=x\n\n# mine\nFOO=1\n$/,
    );
  });

  it('ignores commented-out examples of the same key', () => {
    const { text } = setEnv('# LLM_PROVIDER=ollama\n', {
      LLM_PROVIDER: 'docker-model-runner',
    });
    assert.equal(readEnv(text).LLM_PROVIDER, 'docker-model-runner');
    assert.match(text, /^# LLM_PROVIDER=ollama\n/);
  });
});

describe('newEnvFromExample', () => {
  it('puts one random key in both API_KEYS and NORTHWIND_API_KEY', () => {
    const env = readEnv(
      newEnvFromExample(
        'API_KEYS=dev-key-change-me\nNORTHWIND_API_KEY=dev-key-change-me\n',
      ),
    );
    assert.match(env.API_KEYS, /^[0-9a-f]{48}$/);
    assert.equal(env.NORTHWIND_API_KEY, env.API_KEYS);
  });
});
