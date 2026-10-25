import { useLayoutEffect, useRef, useState } from 'react';

export function Composer({
  onSend,
  onStop,
  busy,
  disabled,
}: {
  onSend: (question: string) => void;
  onStop: () => void;
  busy: boolean;
  /** Nothing to talk to yet (agent unreachable, model not ready). */
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to the CSS max-height. (Set through the DOM, not a style attribute:
  // the Content-Security-Policy allows no inline styles.)
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = () => {
    const question = text.trim();
    if (!question || busy || disabled) return;
    onSend(question);
    setText('');
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={input}
        rows={1}
        value={text}
        placeholder="Ask about Northwind…"
        aria-label="Your question"
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter adds a line; not while an input method is composing.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      {busy ? (
        <button type="button" className="stop" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button type="submit" disabled={disabled || !text.trim()}>
          Send
        </button>
      )}
    </form>
  );
}
