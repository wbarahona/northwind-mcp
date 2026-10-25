// pnpm stack:test
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluate, versionAtLeast } from './checks.mjs';

const mac = {
  platform: 'darwin',
  arch: 'arm64',
  wsl: false,
  cpu: 'Apple M1',
  memoryGb: 16,
  freeDiskGb: 90,
  appleSilicon: true,
  nvidia: null,
};
const linuxGpu = {
  platform: 'linux',
  arch: 'x64',
  wsl: false,
  cpu: 'AMD Ryzen 7',
  memoryGb: 32,
  freeDiskGb: 200,
  appleSilicon: false,
  nvidia: 'NVIDIA GeForce RTX 4070',
};
const desktop = {
  installed: true,
  running: true,
  desktopVersion: '4.50.0',
  composeVersion: '2.40.0',
  vmMemoryGb: 3,
  nvidiaRuntime: false,
  modelRunner: { installed: true, running: true, hostTcp: true },
};
const engine = {
  ...desktop,
  desktopVersion: null,
  engineVersion: '28.1.0',
  modelRunner: { installed: false },
};
const freePorts = [{ port: 5173, inUse: false, byStack: false }];

const items = (verdict) => verdict.sections.flatMap((s) => s.items);
const has = (verdict, level, pattern) =>
  items(verdict).some((i) => i.level === level && pattern.test(i.text));

describe('versionAtLeast', () => {
  it('compares dotted versions numerically', () => {
    assert.equal(versionAtLeast('2.38.0', '2.40.1'), true);
    assert.equal(versionAtLeast('2.38.0', '2.38'), true);
    assert.equal(versionAtLeast('2.38.0', '2.9.0'), false);
    assert.equal(versionAtLeast('4.40.0', '5.0'), true);
  });
});

describe('evaluate', () => {
  it('passes the current Mac setup and lists what setup will add to an old .env', () => {
    const v = evaluate({
      machine: mac,
      docker: desktop,
      env: { API_KEYS: 'k', NORTHWIND_API_KEY: 'k' },
      envExists: true,
      ports: freePorts,
    });
    assert.equal(v.failed, false);
    assert.equal(v.choice.provider, 'docker-model-runner');
    assert.ok(
      has(
        v,
        'warn',
        /setup will set LLM_PROVIDER=docker-model-runner and COMPOSE_FILE=docker-compose\.yml:compose\.model-runner\.yml/,
      ),
    );
  });

  it('is quiet about .env once setup has written it', () => {
    const env = {
      LLM_PROVIDER: 'docker-model-runner',
      COMPOSE_FILE: 'docker-compose.yml:compose.model-runner.yml',
    };
    const v = evaluate({
      machine: mac,
      docker: desktop,
      env,
      envExists: true,
      ports: [],
    });
    assert.ok(!has(v, 'warn', /setup will set/));
  });

  it('suggests Ollama with the GPU on Linux with an NVIDIA card, and needs the toolkit', () => {
    const v = evaluate({
      machine: linuxGpu,
      docker: engine,
      env: {},
      envExists: false,
      ports: [],
    });
    assert.equal(v.choice.provider, 'ollama');
    assert.equal(v.choice.nvidia, true);
    assert.ok(has(v, 'bad', /NVIDIA Container Toolkit/));
    const ok = evaluate({
      machine: linuxGpu,
      docker: { ...engine, nvidiaRuntime: true },
      env: {},
      envExists: false,
      ports: [],
    });
    assert.equal(ok.failed, false);
  });

  it('fails Model Runner without Model Runner, but not Ollama on the same machine', () => {
    const env = { LLM_PROVIDER: 'docker-model-runner' };
    assert.ok(
      has(
        evaluate({
          machine: linuxGpu,
          docker: engine,
          env,
          envExists: true,
          ports: [],
        }),
        'bad',
        /Model Runner is missing/,
      ),
    );
    const ollama = evaluate({
      machine: { ...linuxGpu, nvidia: null },
      docker: engine,
      env: { LLM_PROVIDER: 'ollama' },
      envExists: true,
      ports: [],
    });
    assert.equal(ollama.failed, false);
  });

  it('checks against the provider asked for, and its default model', () => {
    const v = evaluate({
      machine: mac,
      docker: desktop,
      env: { LLM_MODEL: 'hf.co/x' },
      envExists: true,
      ports: [],
      requested: { provider: 'ollama' },
    });
    assert.equal(v.choice.provider, 'ollama');
    assert.ok(has(v, 'ok', /model: qwen3:4b \(the default\)/));
    assert.ok(has(v, 'warn', /VM has 3 GB/));
  });

  it('needs the stack URL and model for an OpenAI-compatible server', () => {
    const v = evaluate({
      machine: mac,
      docker: desktop,
      env: { LLM_PROVIDER: 'openai-compatible' },
      envExists: true,
      ports: [],
    });
    assert.ok(has(v, 'bad', /STACK_LLM_URL is not set/));
    assert.ok(has(v, 'bad', /LLM_MODEL is not set/));
  });

  it('fails without Docker, or with an old Compose, or a chat key the API rejects', () => {
    assert.ok(
      has(
        evaluate({
          machine: mac,
          docker: { installed: false },
          env: {},
          envExists: false,
          ports: [],
        }),
        'bad',
        /isn't installed/,
      ),
    );
    assert.ok(
      has(
        evaluate({
          machine: mac,
          docker: { ...desktop, composeVersion: '2.30.0' },
          env: {},
          envExists: false,
          ports: [],
        }),
        'bad',
        /2\.38\.0 or later/,
      ),
    );
    const env = { API_KEYS: 'a,b', NORTHWIND_API_KEY: 'c' };
    assert.ok(
      has(
        evaluate({
          machine: mac,
          docker: desktop,
          env,
          envExists: true,
          ports: [],
        }),
        'bad',
        /must be one of API_KEYS/,
      ),
    );
  });

  it('tells ports used by the stack from ports used by something else', () => {
    const ports = [
      { port: 3000, inUse: true, byStack: true },
      { port: 5173, inUse: true, byStack: false },
    ];
    const v = evaluate({
      machine: mac,
      docker: desktop,
      env: {},
      envExists: false,
      ports,
    });
    assert.ok(has(v, 'ok', /port 3000 is used by the stack itself/));
    assert.ok(has(v, 'warn', /port 5173 is in use by something else/));
  });
});
