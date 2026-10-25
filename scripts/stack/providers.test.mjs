// pnpm stack:test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  composeFileFor,
  modelAdvice,
  providerOf,
  suggestProvider,
} from './providers.mjs';

describe('providerOf', () => {
  it('reads LLM_PROVIDER, and treats a .env without it as Docker Model Runner', () => {
    assert.equal(providerOf({ LLM_PROVIDER: 'ollama' }), 'ollama');
    assert.equal(providerOf({}), 'docker-model-runner');
    assert.equal(providerOf({ LLM_PROVIDER: ' ' }), 'docker-model-runner');
  });
});

describe('composeFileFor', () => {
  it('is the base file plus the provider’s own', () => {
    assert.equal(
      composeFileFor('docker-model-runner'),
      'docker-compose.yml:compose.model-runner.yml',
    );
    assert.equal(
      composeFileFor('ollama'),
      'docker-compose.yml:compose.ollama.yml',
    );
    assert.equal(
      composeFileFor('ollama', { nvidia: true, separator: ';' }),
      'docker-compose.yml;compose.ollama.yml;compose.ollama-nvidia.yml',
    );
    assert.equal(composeFileFor('openai-compatible'), 'docker-compose.yml');
  });
});

describe('suggestProvider', () => {
  const machine = (over) => ({
    appleSilicon: false,
    nvidia: null,
    modelRunner: { installed: false },
    ...over,
  });

  it('suggests Model Runner on Apple silicon with Model Runner installed', () => {
    assert.equal(
      suggestProvider(
        machine({ appleSilicon: true, modelRunner: { installed: true } }),
      ).provider,
      'docker-model-runner',
    );
  });

  it('suggests Ollama with its GPU file when there is an NVIDIA GPU', () => {
    const s = suggestProvider(
      machine({
        nvidia: 'NVIDIA GeForce RTX 4070',
        modelRunner: { installed: true },
      }),
    );
    assert.deepEqual([s.provider, s.nvidia], ['ollama', true]);
  });

  it('falls back to Model Runner if installed, else Ollama on the CPU', () => {
    assert.equal(
      suggestProvider(machine({ modelRunner: { installed: true } })).provider,
      'docker-model-runner',
    );
    assert.equal(suggestProvider(machine({})).provider, 'ollama');
    assert.equal(
      suggestProvider(machine({ appleSilicon: true })).provider,
      'ollama',
    );
  });
});

describe('modelAdvice', () => {
  it('goes by memory for local models, and ignores it for a remote server', () => {
    assert.match(modelAdvice('ollama', 32).text, /qwen3:8b/);
    assert.equal(modelAdvice('docker-model-runner', 16).level, 'ok');
    assert.equal(modelAdvice('docker-model-runner', 8).level, 'warn');
    assert.equal(modelAdvice('ollama', 4).level, 'bad');
    assert.equal(modelAdvice('openai-compatible', 4).level, 'ok');
  });
});
