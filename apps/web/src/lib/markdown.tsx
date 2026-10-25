import { Fragment, type ReactNode } from 'react';

/*
 * Just enough Markdown for chat answers: paragraphs, bullet and numbered lists, tables,
 * **bold** and `code`. It builds React elements, never HTML strings, so nothing a model writes
 * can become markup or script.
 */

type Align = 'left' | 'center' | 'right' | undefined;

/** `| a | b |` → ["a", "b"]; outer pipes are optional and `\|` stays a literal pipe. */
function cells(line: string): string[] {
  const row = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return row
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

/** The line under a table's header: `|---|:---:|--:|`, giving each column's alignment. */
function separator(line: string | undefined): Align[] | undefined {
  if (!line?.includes('-') || !line.includes('|')) return undefined;
  const parts = cells(line);
  if (!parts.every((part) => /^:?-+:?$/.test(part))) return undefined;
  return parts.map((part) =>
    part.startsWith(':') && part.endsWith(':')
      ? 'center'
      : part.endsWith(':')
        ? 'right'
        : part.startsWith(':')
          ? 'left'
          : undefined,
  );
}

function Table({
  header,
  aligns,
  rows,
  id,
}: {
  header: string[];
  aligns: Align[];
  rows: string[][];
  id: string;
}) {
  // Alignment as a class: the agent's Content-Security-Policy allows no inline styles.
  const cls = (i: number) => (aligns[i] ? `align-${aligns[i]}` : undefined);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} className={cls(i)}>
                {inline(cell, `${id}h${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {header.map((_, i) => (
                <td key={i} className={cls(i)}>
                  {inline(row[i] ?? '', `${id}r${r}c${i}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
          <strong key={`${key}b${i}.${j}`}>
            {breaks(piece.slice(2, -2), `${key}b${i}.${j}`)}
          </strong>
        ) : (
          <Fragment key={`${key}t${i}.${j}`}>
            {breaks(piece, `${key}t${i}.${j}`)}
          </Fragment>
        ),
      );
  });
}

/**
 * `<br>` is the one HTML tag allowed: models use it for line breaks inside table cells, where
 * Markdown has no other way. It becomes a real <br> element; any other tag stays text.
 */
function breaks(text: string, key: string): ReactNode[] {
  return text
    .split(/<br\s*\/?>/gi)
    .flatMap((piece, i) =>
      i === 0 ? [piece] : [<br key={`${key}br${i}`} />, piece],
    );
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

  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? '';

    // A table: a header row with pipes, then a separator row; body rows run until a line
    // without a pipe. While the answer streams, the header shows as text until the separator
    // arrives.
    const aligns = line.includes('|') ? separator(lines[n + 1]) : undefined;
    if (aligns) {
      flush();
      const id = `t${n}`;
      const header = cells(line);
      const rows: string[][] = [];
      n += 2;
      while (n < lines.length && lines[n]!.includes('|')) {
        rows.push(cells(lines[n]!));
        n++;
      }
      n--;
      blocks.push(
        <Table key={id} id={id} header={header} aligns={aligns} rows={rows} />,
      );
      continue;
    }

    const item = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = Boolean(item[1]);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(<li key={`i${n}`}>{inline(item[2] ?? '', `i${n}`)}</li>);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p${n}`}>{inline(line, `p${n}`)}</p>);
  }
  flush();
  return <>{blocks}</>;
}
