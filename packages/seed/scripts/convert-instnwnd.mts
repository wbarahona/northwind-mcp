/**
 * One-time converter: Microsoft's classic `instnwnd.sql` → data/raw/*.json.
 *
 *   pnpm --filter @northwind/seed convert /path/to/instnwnd.sql
 *
 * Output stays faithful to the source: original table and column names, one JSON file per
 * table. Only three things change: binary image blobs are dropped, M/D/YYYY dates become
 * ISO YYYY-MM-DD, and money/discount values are kept as their exact source text (strings)
 * so no float rounding can creep in. Everything else (codes, emails, phones, date shift)
 * happens in src/transform.ts at seed time.
 *
 * Runs directly on Node 24 (built-in type stripping); uses only Node built-ins.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Value = string | number | null;

interface TableSpec {
  file: string;
  /** Column order for `INSERT ... VALUES` statements that don't list columns. */
  columns?: string[];
  dates?: string[];
  /** money / real columns: kept as exact decimal strings. */
  decimals?: string[];
  drop?: string[];
}

// Column orders verified against the CREATE TABLE statements in instnwnd.sql.
const TABLES: Record<string, TableSpec> = {
  Categories: { file: 'categories.json', drop: ['Picture'] },
  Customers: {
    file: 'customers.json',
    columns: [
      'CustomerID',
      'CompanyName',
      'ContactName',
      'ContactTitle',
      'Address',
      'City',
      'Region',
      'PostalCode',
      'Country',
      'Phone',
      'Fax',
    ],
  },
  Employees: {
    file: 'employees.json',
    dates: ['BirthDate', 'HireDate'],
    drop: ['Photo'],
  },
  EmployeeTerritories: {
    file: 'employee-territories.json',
    columns: ['EmployeeID', 'TerritoryID'],
  },
  'Order Details': {
    file: 'order-details.json',
    columns: ['OrderID', 'ProductID', 'UnitPrice', 'Quantity', 'Discount'],
    decimals: ['UnitPrice', 'Discount'],
  },
  Orders: {
    file: 'orders.json',
    dates: ['OrderDate', 'RequiredDate', 'ShippedDate'],
    decimals: ['Freight'],
  },
  Products: { file: 'products.json', decimals: ['UnitPrice'] },
  Region: { file: 'regions.json', columns: ['RegionID', 'RegionDescription'] },
  Shippers: { file: 'shippers.json' },
  Suppliers: { file: 'suppliers.json' },
  Territories: {
    file: 'territories.json',
    columns: ['TerritoryID', 'TerritoryDescription', 'RegionID'],
  },
};

const INSERT =
  /\bINSERT\s+(?:INTO\s+)?(?:"([^"]+)"|(\w+))\s*(?:\(([^)]*)\))?\s*VALUES\s*\(/gi;

/** NULL, a hex blob, or a number; sticky so it matches exactly at `lastIndex`. */
const TOKEN = /NULL|0x[0-9A-F]*|-?\d+(?:\.\d+)?(?:E[+-]?\d+)?/iy;

/** A literal plus the source text, so decimals can be kept exactly as written. */
interface Literal {
  value: Value;
  text: string;
  hex?: boolean;
}

function main(): void {
  const sqlPath = process.argv[2];
  if (!sqlPath) {
    console.error('Usage: convert-instnwnd.mts <path to instnwnd.sql>');
    process.exit(1);
  }

  const sql = readFileSync(sqlPath, 'utf8');
  const rows = new Map<string, Record<string, Value>[]>();

  for (const match of sql.matchAll(INSERT)) {
    const table = match[1] ?? match[2] ?? '';
    const spec = TABLES[table];
    if (!spec) throw new Error(`Unexpected table in INSERT: ${table}`);

    const columns =
      match[3]?.split(',').map((c) => c.trim().replace(/^"|"$/g, '')) ??
      spec.columns;
    if (!columns) throw new Error(`No column list known for ${table}`);

    const literals = parseValues(sql, (match.index ?? 0) + match[0].length);
    if (literals.length !== columns.length) {
      throw new Error(
        `${table}: ${literals.length} values for ${columns.length} columns`,
      );
    }

    const row: Record<string, Value> = {};
    columns.forEach((column, i) => {
      const literal = literals[i]!;
      if (spec.drop?.includes(column) || literal.hex) return;
      row[column] = convert(column, literal, spec);
    });

    rows.set(table, [...(rows.get(table) ?? []), row]);
  }

  const outDir = join(dirname(fileURLToPath(import.meta.url)), '../data/raw');
  mkdirSync(outDir, { recursive: true });
  for (const [table, spec] of Object.entries(TABLES)) {
    const tableRows = rows.get(table) ?? [];
    writeFileSync(
      join(outDir, spec.file),
      `${JSON.stringify(tableRows, null, 2)}\n`,
    );
    console.log(`${spec.file.padEnd(26)} ${tableRows.length} rows`);
  }
}

function convert(column: string, literal: Literal, spec: TableSpec): Value {
  if (literal.value === null) return null;
  if (spec.decimals?.includes(column)) return literal.text;
  if (spec.dates?.includes(column)) return toIsoDate(String(literal.value));
  return literal.value;
}

/** `7/4/1996` (the script sets DATEFORMAT mdy) → `1996-07-04`. */
function toIsoDate(mdy: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdy);
  if (!match) throw new Error(`Unexpected date: ${mdy}`);
  const [, m = '', d = '', y = ''] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Parses a VALUES list starting just after its opening parenthesis. */
function parseValues(sql: string, start: number): Literal[] {
  const values: Literal[] = [];
  let i = start;

  while (i < sql.length) {
    while (/\s/.test(sql[i] ?? '')) i++;
    const ch = sql[i];

    if (ch === "'" || ((ch === 'N' || ch === 'n') && sql[i + 1] === "'")) {
      i += ch === "'" ? 1 : 2;
      let text = '';
      for (;;) {
        if (i >= sql.length) throw new Error('Unterminated string literal');
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            text += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        text += sql[i];
        i++;
      }
      values.push({ value: text, text });
    } else {
      TOKEN.lastIndex = i;
      const token = TOKEN.exec(sql)?.[0];
      if (!token)
        throw new Error(`Unexpected token near: ${sql.slice(i, i + 40)}`);
      i += token.length;

      if (/^NULL$/i.test(token)) values.push({ value: null, text: token });
      else if (/^0x/i.test(token))
        values.push({ value: null, text: '', hex: true });
      else values.push({ value: Number(token), text: token });
    }

    while (/\s/.test(sql[i] ?? '')) i++;
    if (sql[i] === ',') {
      i++;
      continue;
    }
    if (sql[i] === ')') return values;
    throw new Error(`Expected , or ) near: ${sql.slice(i, i + 40)}`);
  }
  throw new Error('Unterminated VALUES list');
}

main();
