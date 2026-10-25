import {
  type NorthwindClient,
  NorthwindApiError,
  unwrap,
} from '@northwind/api-client';
import {
  type Candidate,
  closeMatches,
  exactMatch,
  partialMatch,
} from './match';

/** The kinds of record a tool argument can refer to by code or by name. */
export type RefKind =
  | 'customer'
  | 'product'
  | 'employee'
  | 'category'
  | 'supplier'
  | 'shipper'
  | 'territory';

/** Directories are small (dozens of records); this caps a runaway loop, not real data. */
const MAX_PAGES = 10;

interface KindInfo {
  /** "customer" in messages. */
  label: string;
  /** Where the model can browse this kind: "find_customers". */
  browse: string;
  /** The canonical code if `value` is written like one ("alfki" → "ALFKI", "11" → "PRD-011"). */
  code: (value: string) => string | undefined;
  /** One page of the directory. */
  page: (
    api: NorthwindClient,
    page: number,
  ) => Promise<{ items: Candidate[]; totalPages: number }>;
}

/** "CAT-4", "cat-04" and "4" → "CAT-04" (classic Northwind numeric ids keep working). */
const prefixed =
  (prefix: string, width: number) =>
  (value: string): string | undefined => {
    const match = new RegExp(`^(?:${prefix}-)?([0-9]+)$`, 'i').exec(value);
    return match ? `${prefix}-${match[1]!.padStart(width, '0')}` : undefined;
  };

const query = (page: number) => ({ params: { query: { page, limit: 100 } } });
const pageOf = <T>(
  result: { data: T[]; meta: { totalPages: number } },
  toCandidate: (item: T) => Candidate,
) => ({
  items: result.data.map(toCandidate),
  totalPages: result.meta.totalPages,
});

const KINDS: Record<RefKind, KindInfo> = {
  customer: {
    label: 'customer',
    browse: 'find_customers',
    code: (v) => (/^[a-z]{5}$/i.test(v) ? v.toUpperCase() : undefined),
    page: async (api, page) =>
      pageOf(await unwrap(api.GET('/v1/customers', query(page))), (c) => ({
        code: c.code,
        name: c.companyName,
      })),
  },
  product: {
    label: 'product',
    browse: 'find_products',
    code: prefixed('PRD', 3),
    page: async (api, page) =>
      pageOf(await unwrap(api.GET('/v1/products', query(page))), (p) => ({
        code: p.code,
        name: p.name,
      })),
  },
  employee: {
    label: 'employee',
    browse: 'find_employees',
    code: prefixed('EMP', 3),
    page: async (api, page) =>
      pageOf(await unwrap(api.GET('/v1/employees', query(page))), (e) => ({
        code: e.code,
        name: `${e.firstName} ${e.lastName}`,
      })),
  },
  category: {
    label: 'category',
    browse: 'list_reference_data with kind "categories"',
    code: prefixed('CAT', 2),
    page: async (api, page) =>
      pageOf(await unwrap(api.GET('/v1/categories', query(page))), (c) => ({
        code: c.code,
        name: c.name,
      })),
  },
  supplier: {
    label: 'supplier',
    browse: 'list_reference_data with kind "suppliers"',
    code: prefixed('SUP', 3),
    page: async (api, page) =>
      pageOf(await unwrap(api.GET('/v1/suppliers', query(page))), (s) => ({
        code: s.code,
        name: s.companyName,
      })),
  },
  shipper: {
    label: 'shipper',
    browse: 'list_reference_data with kind "shippers"',
    code: prefixed('SHP', 2),
    page: async (api, page) =>
      pageOf(await unwrap(api.GET('/v1/shippers', query(page))), (s) => ({
        code: s.code,
        name: s.companyName,
      })),
  },
  territory: {
    label: 'territory',
    browse: 'list_reference_data with kind "regions"',
    code: (v) => (/^[0-9]{5}$/.test(v) ? v : undefined),
    page: async (api, page) => {
      const regions = await unwrap(api.GET('/v1/regions', query(page)));
      return {
        items: regions.data.flatMap((r) => r.territories),
        totalPages: regions.meta.totalPages,
      };
    },
  },
};

/** A code or name that matches nothing; the message lists close matches when there are any. */
export class NoMatchError extends Error {
  override readonly name = 'NoMatchError';

  constructor(
    readonly kind: RefKind,
    readonly input: string,
    readonly suggestions: Candidate[],
  ) {
    const { label, browse } = KINDS[kind];
    super(
      suggestions.length
        ? `No ${label} matches "${input}". Did you mean ${suggestions
            .map((s) => `${s.code} (${s.name})`)
            .join(', or ')}? Call again with the code.`
        : `No ${label} matches "${input}". Use ${browse} to look it up.`,
    );
  }
}

export interface ResolvedArgs<K extends string> {
  codes: Partial<Record<K, string>>;
  /** One per name that was turned into a code, for the result summary. */
  notes: string[];
  /** Arguments given as codes (not looked up yet), checked by `checkEmpty()`. */
  typed: { arg: K; kind: RefKind; code: string; input: string }[];
}

export interface Resolved {
  code: string;
  /** Set when a name was turned into a code: `"Dairy Products" is CAT-04.` */
  note?: string;
}

/**
 * Turns the codes and names a model passes into codes the API accepts. Codes pass straight
 * through (no extra request); names are looked up in that kind's directory. Create one per
 * tool call: directories are cached for the call only, so they're never stale.
 */
export class References {
  private readonly directories = new Map<RefKind, Promise<Candidate[]>>();

  constructor(private readonly api: NorthwindClient) {}

  async resolve(kind: RefKind, input: string): Promise<Resolved> {
    const value = input.trim();
    const code = KINDS[kind].code(value);
    if (code) return { code };

    const candidates = await this.directory(kind);
    const exact = exactMatch(value, candidates);
    if (exact)
      return { code: exact.code, note: `"${value}" is ${exact.code}.` };
    const partial = partialMatch(value, candidates);
    if (partial) {
      return {
        code: partial.code,
        note: `"${value}" taken as ${partial.code} (${partial.name}).`,
      };
    }
    throw new NoMatchError(kind, value, closeMatches(value, candidates));
  }

  /**
   * Resolves every argument that was given (`undefined` stays `undefined`). Call
   * `checkEmpty()` with the result when the API then finds nothing.
   */
  async resolveAll<K extends string>(
    refs: Record<K, { kind: RefKind; input: string | undefined }>,
  ): Promise<ResolvedArgs<K>> {
    const entries = Object.entries(refs) as [
      K,
      { kind: RefKind; input: string | undefined },
    ][];
    const resolved = await Promise.all(
      entries.map(async ([arg, { kind, input }]) =>
        input === undefined
          ? undefined
          : { arg, kind, input, ...(await this.resolve(kind, input)) },
      ),
    );
    const given = resolved.filter((r) => r !== undefined);
    return {
      codes: Object.fromEntries(given.map((r) => [r.arg, r.code])) as Partial<
        Record<K, string>
      >,
      notes: given.flatMap((r) => (r.note ? [r.note] : [])),
      typed: given.filter((r) => !r.note),
    };
  }

  /**
   * A filtered list came back empty. That's a real answer ("no orders") unless one of the
   * codes the model typed doesn't exist: then this throws a NoMatchError with suggestions.
   */
  async checkEmpty(args: ResolvedArgs<string>): Promise<void> {
    for (const { kind, code, input } of args.typed) {
      await this.assertExists(kind, code, input);
    }
  }

  /** Fetches one record by code or name; a 404 becomes a NoMatchError with suggestions. */
  async fetchOne<T>(
    kind: RefKind,
    input: string,
    fetch: (code: string) => Promise<T>,
  ): Promise<{ value: T; note?: string }> {
    const { code, note } = await this.resolve(kind, input);
    try {
      return { value: await fetch(code), note };
    } catch (error) {
      if (error instanceof NorthwindApiError && error.status === 404) {
        await this.assertExists(kind, code, input);
      }
      throw error;
    }
  }

  /** Throws a NoMatchError (with suggestions) unless the code exists. */
  async assertExists(
    kind: RefKind,
    code: string,
    input: string,
  ): Promise<void> {
    const candidates = await this.directory(kind);
    if (candidates.some((c) => c.code === code)) return;
    throw new NoMatchError(kind, input.trim(), closeMatches(input, candidates));
  }

  /** Close matches for free-text searches that found nothing. */
  async suggest(kind: RefKind, input: string): Promise<Candidate[]> {
    return closeMatches(input, await this.directory(kind));
  }

  /** Every code and name of a kind (fetched once per References instance). */
  directory(kind: RefKind): Promise<Candidate[]> {
    let pending = this.directories.get(kind);
    if (!pending) {
      pending = (async () => {
        const all: Candidate[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const { items, totalPages } = await KINDS[kind].page(this.api, page);
          all.push(...items);
          if (page >= totalPages) break;
        }
        return all;
      })();
      this.directories.set(kind, pending);
    }
    return pending;
  }
}
