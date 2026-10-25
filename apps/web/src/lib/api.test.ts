import { modelName, readNdjson } from './api';

const stream = (...parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });

const collect = async <T>(source: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
};

describe('readNdjson', () => {
  it('reads objects split anywhere across chunks, skipping blank lines', async () => {
    expect(
      await collect(
        readNdjson(
          stream('{"type":"tok', 'en","text":"Hi"}\n\n{"type":', '"done"}'),
        ),
      ),
    ).toEqual([{ type: 'token', text: 'Hi' }, { type: 'done' }]);
  });

  it('keeps multi-byte characters split across chunks intact', async () => {
    const bytes = new TextEncoder().encode('{"text":"Côte de Blaye"}\n');
    const split = 11; // between the two bytes of "ô"
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, split));
        c.enqueue(bytes.slice(split));
        c.close();
      },
    });

    expect(await collect(readNdjson(source))).toEqual([
      { text: 'Côte de Blaye' },
    ]);
  });
});

describe('modelName', () => {
  it.each([
    ['hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M', 'Qwen3-8B'],
    ['ai/qwen3:8B-Q4_K_M', 'qwen3'],
    ['', 'Model'],
  ])('%s → %s', (model, name) => {
    expect(modelName(model)).toBe(name);
  });
});
