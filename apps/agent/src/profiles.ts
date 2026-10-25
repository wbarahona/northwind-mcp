/**
 * Model profiles: what the agent does differently for one family of models. The tool loop
 * itself is the same for every model; a profile only adds to the system prompt and reads tool
 * calls that a model writes as text. A model with no known profile gets `generic`, so nothing
 * meant for another family is sent to it.
 */

export const PROFILE_NAMES = ['qwen3', 'generic'] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

/** A tool call read from the model's text, in the shape the loop collects them in. */
export interface TextToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelProfile {
  readonly name: ProfileName;
  /** Whether LLM_THINKING changes anything for this model. */
  readonly thinkingSwitch: boolean;
  /** Text appended to the system prompt; empty for none. */
  promptSuffix(options: { thinking: boolean }): string;
  /** Tool calls the model wrote as text instead of as structured calls; [] if none. */
  textToolCalls(text: string): TextToolCall[];
}

/**
 * Qwen3 has a `/no_think` switch, and sometimes writes a tool call as text in its own format:
 *   <tool_call>{"name": "find_orders", "arguments": {"customer": "ALFKI"}}</tool_call>
 * llama.cpp sometimes passes such a block on as reasoning or content rather than as a tool
 * call, so the agent runs it instead of ending the chat with an empty answer.
 */
const qwen3: ModelProfile = {
  name: 'qwen3',
  thinkingSwitch: true,
  // Skip the reasoning phase unless thinking is on: much faster on a laptop.
  promptSuffix: ({ thinking }) => (thinking ? '' : '/no_think'),
  textToolCalls: taggedToolCalls,
};

/** Any model that calls tools the standard way. */
const generic: ModelProfile = {
  name: 'generic',
  thinkingSwitch: false,
  promptSuffix: () => '',
  textToolCalls: () => [],
};

export const PROFILES: Record<ProfileName, ModelProfile> = { qwen3, generic };

/**
 * The profile for a model: the one named in LLM_PROFILE, or else the one its name suggests
 * ("hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M", "ai/qwen3", "qwen3:8b" → qwen3).
 */
export function profileFor(model: string, name?: ProfileName): ModelProfile {
  if (name) return PROFILES[name];
  return /qwen3/i.test(model) ? qwen3 : generic;
}

/** `<tool_call>{json}</tool_call>` blocks; ones that aren't valid JSON with a name are ignored. */
export function taggedToolCalls(text: string): TextToolCall[] {
  const calls: TextToolCall[] = [];
  for (const match of text.matchAll(
    /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,
  )) {
    try {
      const parsed = JSON.parse(match[1] ?? '') as {
        name?: unknown;
        arguments?: unknown;
      };
      if (typeof parsed.name !== 'string' || !parsed.name) continue;
      const args = parsed.arguments ?? {};
      calls.push({
        id: '',
        name: parsed.name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args),
      });
    } catch {
      // Not a tool call after all.
    }
  }
  return calls;
}
