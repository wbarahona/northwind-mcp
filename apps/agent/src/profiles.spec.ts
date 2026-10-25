import { PROFILES, profileFor, taggedToolCalls } from './profiles';

describe('profileFor', () => {
  it('picks qwen3 from the model name, whatever the server calls it', () => {
    for (const model of [
      'hf.co/Qwen/Qwen3-4B-GGUF:Q4_K_M',
      'ai/qwen3:8B-Q4_K_M',
      'qwen3:4b',
    ]) {
      expect(profileFor(model).name).toBe('qwen3');
    }
  });

  it('gives any other model the generic profile', () => {
    for (const model of [
      'llama3.1:8b',
      'mistral-small',
      'gpt-4.1-mini',
      'qwen2.5:7b',
    ]) {
      expect(profileFor(model).name).toBe('generic');
    }
  });

  it('lets LLM_PROFILE override the guess', () => {
    expect(profileFor('my-finetune', 'qwen3')).toBe(PROFILES.qwen3);
    expect(profileFor('qwen3:4b', 'generic')).toBe(PROFILES.generic);
  });
});

describe('the profiles', () => {
  it('qwen3 turns thinking off with /no_think unless it is on', () => {
    expect(PROFILES.qwen3.thinkingSwitch).toBe(true);
    expect(PROFILES.qwen3.promptSuffix({ thinking: false })).toBe('/no_think');
    expect(PROFILES.qwen3.promptSuffix({ thinking: true })).toBe('');
  });

  it('generic adds nothing and reads no text tool calls', () => {
    const text =
      '<tool_call>{"name": "get_order", "arguments": {}}</tool_call>';
    expect(PROFILES.generic.thinkingSwitch).toBe(false);
    expect(PROFILES.generic.promptSuffix({ thinking: false })).toBe('');
    expect(PROFILES.generic.textToolCalls(text)).toEqual([]);
    expect(PROFILES.qwen3.textToolCalls(text)).toHaveLength(1);
  });
});

describe('taggedToolCalls', () => {
  it('reads <tool_call> blocks from text, ignoring anything that is not one', () => {
    expect(
      taggedToolCalls(
        'Let me check.\n<tool_call>\n{"name": "find_orders", "arguments": {"customer": "ALFKI"}}\n</tool_call>' +
          '<tool_call>{"name": "get_order", "arguments": "{\\"order\\":\\"1\\"}"}</tool_call>' +
          '<tool_call>not json</tool_call><tool_call>{"arguments": {}}</tool_call>',
      ),
    ).toEqual([
      { id: '', name: 'find_orders', arguments: '{"customer":"ALFKI"}' },
      { id: '', name: 'get_order', arguments: '{"order":"1"}' },
    ]);
    expect(taggedToolCalls('A normal answer with no tool calls.')).toEqual([]);
  });
});
