import { Fragment, type ReactNode } from 'react';

/*
 * Just enough Markdown for chat answers: paragraphs, bullet and numbered lists, **bold** and
 * `code`. It builds React elements, never HTML strings, so nothing a model writes can become
 * markup or script.
 */

function inline(text: string, key: string): ReactNode[] {
  // Split on `code` first (its content stays literal), then on **bold**.
  return text.split(/(`[^`]+`)/g).flatMap((part, i): ReactNode[] => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return [<code key={`${key}c${i}`}>{part.slice(1, -1)}</code>];
    }
    return part
      .split(/(\*\*[^*]+\*\*)/g)
      .map((piece, j) =>
        piece.startsWith('**') && piece.endsWith('**') && piece.length > 4 ? (
          <strong key={`${key}b${i}.${j}`}>{piece.slice(2, -2)}</strong>
        ) : (
          <Fragment key={`${key}t${i}.${j}`}>{piece}</Fragment>
        ),
      );
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | undefined;

  const flush = () => {
    if (!list) return;
    const key = `l${blocks.length}`;
    blocks.push(
      list.ordered ? (
        <ol key={key}>{list.items}</ol>
      ) : (
        <ul key={key}>{list.items}</ul>
      ),
    );
    list = undefined;
  };

  text.split('\n').forEach((line, n) => {
    const item = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = Boolean(item[1]);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(<li key={`i${n}`}>{inline(item[2] ?? '', `i${n}`)}</li>);
      return;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p${n}`}>{inline(line, `p${n}`)}</p>);
  });
  flush();
  return <>{blocks}</>;
}
