import type { CompletionChunk, CompletionRequest, LlmClient } from '../src/llm';

/*
 * A scripted model for tests: each round is the exact chunk sequence a model server would
 * stream, in the shapes llama.cpp uses.
 */

export const say = (text: string): CompletionChunk => ({
  choices: [{ delta: { content: text } }],
});

/** A tool call streamed the way llama.cpp does: id and name first, arguments in pieces. */
export const callTool = (
  name: string,
  args: string,
  index = 0,
  id = `id_${name}`,
): CompletionChunk[] => [
  {
    choices: [
      {
        delta: {
          tool_calls: [{ index, id, function: { name, arguments: '' } }],
        },
      },
    ],
  },
  ...[args.slice(0, 5), args.slice(5)].map((part): CompletionChunk => ({
    choices: [
      { delta: { tool_calls: [{ index, function: { arguments: part } }] } },
    ],
  })),
];

/** Plays one scripted round per request and records what it was asked. */
export function scriptedLlm(rounds: CompletionChunk[][]) {
  const requests: CompletionRequest[] = [];
  const llm: LlmClient = {
    model: 'scripted',
    async *stream(request) {
      // Copy the messages: the loop keeps appending to the same array.
      requests.push({
        ...request,
        messages: structuredClone(request.messages),
      });
      const round = rounds[requests.length - 1];
      if (!round) throw new Error(`No scripted round ${requests.length}`);
      for (const chunk of round) yield chunk;
    },
  };
  return { llm, requests };
}
