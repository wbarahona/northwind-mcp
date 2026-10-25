import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type NorthwindClient, unwrap } from '@northwind/api-client';
import { z } from 'zod';
import { References } from '../lookup/references';
import {
  type Breakdown,
  BREAKDOWNS,
  BreakdownRow,
  breakdownRows,
  PeriodRow,
  presentPeriod,
  presentShipperPerformance,
  rank,
  RangeView,
  SalesTotals,
  ShipperRow,
  totals,
  withShares,
} from '../presenters/analytics';
import { compact } from '../presenters/common';
import { toCents } from '../presenters/money';
import { describeRange, type Period, PERIODS, periodRange } from '../periods';
import { dateArg, enumArg, intArg, optional, textArg } from './args';
import { guarded, present, READ_ONLY } from './result';

const sentence = (...parts: (string | undefined | false)[]) =>
  parts.filter(Boolean).join(' ');

/** A request the tool can't answer as asked; the message (shown to the model) says how to ask instead. */
class UsageError extends Error {}

/** More periods than this is more data than a model can use; ask for coarser steps. */
const MAX_PERIODS = 120;

/**
 * Ranked lists ask the API for one row more than wanted: if it comes back, the list was cut
 * off. (At the API's maximum of 100 there's no room to ask, so 100 rows count as incomplete.)
 */
const probeLimit = (limit: number) => Math.min(limit + 1, 100);

const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;

const rangeArgs = {
  period: optional(
    enumArg(
      PERIODS,
      'A named period, measured from today: this_month, last_month, this_quarter, ' +
        'last_quarter, this_year, last_year or last_30_days. Use instead of from/to.',
    ),
  ),
  from: optional(dateArg('Orders placed on or after this date, YYYY-MM-DD')),
  to: optional(
    dateArg('Orders placed before this date (exclusive), YYYY-MM-DD'),
  ),
};

const statusArg = optional(
  enumArg(
    ['pending', 'shipped'],
    'Only pending (not yet shipped) or only shipped orders; omit for both',
  ),
);

interface RangeArgs {
  period?: Period;
  from?: string;
  to?: string;
  status?: 'pending' | 'shipped';
}

/** The dates a report covers: a named period, or from/to as given (or everything). */
function resolveRange(args: RangeArgs, now: Date): RangeView {
  if (args.period && (args.from || args.to)) {
    throw new UsageError(
      'Give either period or from/to, not both. For example period="last_quarter", ' +
        'or from="2026-07-01" and to="2026-10-01".',
    );
  }
  const dates = args.period ? periodRange(args.period, now) : args;
  return compact({
    period: args.period,
    from: dates.from,
    to: dates.to,
    status: args.status,
  });
}

/** "orders placed 2026-07-01 to 2026-09-30 (last_quarter), shipped only" */
function rangeText(range: RangeView): string {
  return (
    describeRange(range) +
    (range.period ? ` (${range.period})` : '') +
    (range.status ? `, ${range.status} only` : '')
  );
}

const rangeQuery = (range: RangeView) => ({
  from: range.from,
  to: range.to,
  status: range.status,
});

export function registerAnalyticsTools(
  server: McpServer,
  api: NorthwindClient,
  apiUrl: string,
  now: () => Date,
): void {
  server.registerTool(
    'sales_over_time',
    {
      title: 'Sales over time',
      description:
        'Revenue and order count per day, week, month (default), quarter or year, with totals ' +
        'and the best period. Revenue is net sales: after line discounts, before freight. ' +
        'Periods without orders are listed with zeros. Use period (e.g. "this_year") or ' +
        `from/to to choose the range; at most ${MAX_PERIODS} periods per call.`,
      inputSchema: {
        granularity: optional(
          enumArg(GRANULARITIES, 'Size of each period (default month)'),
        ),
        ...rangeArgs,
        status: statusArg,
      },
      outputSchema: {
        range: RangeView,
        granularity: z.enum(GRANULARITIES),
        periods: z.array(PeriodRow),
        totals: SalesTotals,
        best: PeriodRow.optional().describe('The period with the most revenue'),
      },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async (args) => {
      const range = resolveRange(args, now());
      const granularity = args.granularity ?? 'month';
      const result = await unwrap(
        api.GET('/v1/analytics/sales-over-time', {
          params: { query: { granularity, ...rangeQuery(range) } },
        }),
      );
      if (result.data.length > MAX_PERIODS) {
        throw new UsageError(
          `That is ${result.data.length} ${granularity} periods, more than the ${MAX_PERIODS} ` +
            'this tool returns. Use a coarser granularity or a shorter range.',
        );
      }
      const periods = result.data.map(presentPeriod);
      const sum = totals(periods);
      const best = periods.reduce<(typeof periods)[number] | undefined>(
        (top, p) =>
          toCents(p.revenue) > (top ? toCents(top.revenue) : 0n) ? p : top,
        undefined,
      );
      return present(
        sentence(
          `Revenue per ${granularity} for ${rangeText(range)}: ${periods.length} ` +
            `period${periods.length === 1 ? '' : 's'}, total ${sum.revenue} from ${sum.orders} orders` +
            ` (average order ${sum.averageOrderValue}).`,
          best && `Best ${granularity}: ${best.label} with ${best.revenue}.`,
        ),
        { range, granularity, periods, totals: sum, ...(best && { best }) },
      );
    }),
  );

  server.registerTool(
    'sales_breakdown',
    {
      title: 'Sales breakdown',
      description:
        'Revenue ranked by category, product, customer, employee (sales staff) or country ' +
        '(ship-to), best first, with orders and, where it applies, units, share of total, ' +
        'average order value and customer count. Revenue is net sales: after discounts, before ' +
        'freight. Use period (e.g. "last_quarter") or from/to for the range. by=product can be ' +
        'narrowed to a category and ranked by units; by=customer can be narrowed to a country.',
      inputSchema: {
        by: enumArg(BREAKDOWNS, 'What to rank'),
        ...rangeArgs,
        status: statusArg,
        limit: optional(
          intArg(
            1,
            100,
            'How many to return (default: 10 products/customers, all others)',
          ),
        ),
        category: optional(
          textArg(
            'by=product only: category code (CAT-04) or name, e.g. "Dairy Products"',
          ),
        ),
        country: optional(
          textArg('by=customer only: customer country, name or ISO code'),
        ),
        rankBy: optional(
          enumArg(
            ['revenue', 'units'],
            'by=product only: rank by revenue (default) or units sold',
          ),
        ),
      },
      outputSchema: {
        by: z.enum(BREAKDOWNS),
        range: RangeView,
        rows: z.array(BreakdownRow),
        complete: z
          .boolean()
          .describe(
            'true when every row is listed (then shares and totals cover everything)',
          ),
        totals: SalesTotals.optional().describe('Over all rows, when complete'),
      },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async (args) => {
      const by: Breakdown = args.by;
      const misplaced = [
        args.category !== undefined &&
          by !== 'product' &&
          'category (by=product only)',
        args.rankBy !== undefined &&
          by !== 'product' &&
          'rankBy (by=product only)',
        args.country !== undefined &&
          by !== 'customer' &&
          'country (by=customer only)',
      ].filter(Boolean);
      if (misplaced.length) {
        throw new UsageError(
          `These arguments don't apply to by=${by}: ${misplaced.join(', ')}. Leave them out, ` +
            'or change "by".',
        );
      }

      const range = resolveRange(args, now());
      const query = rangeQuery(range);
      const refs = new References(api);
      const notes: string[] = [];
      let rows: Omit<BreakdownRow, 'rank'>[];
      let complete: boolean;

      switch (by) {
        case 'category': {
          const r = await unwrap(
            api.GET('/v1/analytics/sales-by-category', { params: { query } }),
          );
          rows = r.data.map(breakdownRows.category);
          complete = true;
          break;
        }
        case 'employee': {
          const r = await unwrap(
            api.GET('/v1/analytics/sales-by-employee', { params: { query } }),
          );
          rows = withShares(r.data.map(breakdownRows.employee));
          complete = true;
          break;
        }
        case 'country': {
          const r = await unwrap(
            api.GET('/v1/analytics/sales-by-country', { params: { query } }),
          );
          rows = r.data.map(breakdownRows.country);
          complete = true;
          break;
        }
        case 'product': {
          const category = args.category
            ? await refs.resolve('category', args.category)
            : undefined;
          if (category?.note) notes.push(category.note);
          const limit = args.limit ?? 10;
          const r = await unwrap(
            api.GET('/v1/analytics/sales-by-product', {
              params: {
                query: {
                  ...query,
                  categoryId: category?.code,
                  sortBy: args.rankBy,
                  limit: probeLimit(limit),
                },
              },
            }),
          );
          if (r.data.length === 0 && category && !category.note) {
            await refs.assertExists('category', category.code, args.category!);
          }
          rows = r.data.slice(0, limit).map(breakdownRows.product);
          complete = r.data.length < probeLimit(limit);
          break;
        }
        case 'customer': {
          const limit = args.limit ?? 10;
          const r = await unwrap(
            api.GET('/v1/analytics/top-customers', {
              params: {
                query: {
                  ...query,
                  country: args.country,
                  limit: probeLimit(limit),
                },
              },
            }),
          );
          rows = r.data.slice(0, limit).map(breakdownRows.customer);
          complete = r.data.length < probeLimit(limit);
          break;
        }
      }

      const all = rows;
      const shown = args.limit !== undefined ? all.slice(0, args.limit) : all;
      complete = complete && shown.length === all.length;
      const ranked = rank(shown);
      const sum = complete ? totals(all) : undefined;
      const top = ranked[0];

      const what =
        by === 'product' && args.rankBy === 'units'
          ? 'Units sold by product'
          : `Revenue by ${by}`;
      return present(
        sentence(
          ...notes,
          `${what} for ${rangeText(range)}${args.country ? ` in ${args.country}` : ''}:`,
          ranked.length === 0
            ? 'no sales.'
            : complete
              ? `${ranked.length} ${ranked.length === 1 ? 'row' : 'rows'}, total ${sum!.revenue}.`
              : `top ${ranked.length}${all.length > shown.length ? ` of ${all.length}` : ''}.`,
          top &&
            `#1 ${top.name} (${top.code}): ${by === 'product' && args.rankBy === 'units' ? `${top.units} units, ` : ''}` +
              `${top.revenue} from ${top.orders} orders.`,
        ),
        { by, range, rows: ranked, complete, ...(sum && { totals: sum }) },
      );
    }),
  );

  server.registerTool(
    'shipping_performance',
    {
      title: 'Shipping performance',
      description:
        'Per shipper (carrier): shipped orders, average days from order to shipment, late ' +
        'shipments (after the required date), on-time percentage and freight charged (total and ' +
        'average). Use period or from/to to choose which orders (by order date).',
      inputSchema: { ...rangeArgs },
      outputSchema: { range: RangeView, shippers: z.array(ShipperRow) },
      annotations: READ_ONLY,
    },
    guarded(apiUrl, async (args) => {
      const range = resolveRange(args, now());
      const r = await unwrap(
        api.GET('/v1/analytics/shipping-performance', {
          params: { query: { from: range.from, to: range.to } },
        }),
      );
      const shippers = r.data.map(presentShipperPerformance);
      const fastest = [...shippers].sort(
        (a, b) => a.averageDaysToShip - b.averageDaysToShip,
      )[0];
      const punctual = [...shippers].sort(
        (a, b) => b.onTimePercent - a.onTimePercent,
      )[0];
      return present(
        sentence(
          `Shipping for ${rangeText(range)}: ${shippers.length} shippers,` +
            ` ${shippers.reduce((n, s) => n + s.shippedOrders, 0)} shipped orders.`,
          fastest &&
            `Fastest: ${fastest.shipper.name} (${fastest.averageDaysToShip} days on average).`,
          punctual &&
            `Most on time: ${punctual.shipper.name} (${punctual.onTimePercent}%).`,
        ),
        { range, shippers },
      );
    }),
  );
}
