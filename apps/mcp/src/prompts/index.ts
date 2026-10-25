import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { NorthwindClient } from '@northwind/api-client';
import { z } from 'zod';
import { References } from '../lookup/references';
import {
  lastDay,
  parseQuarter,
  previousQuarter,
  recentQuarters,
  today,
} from '../periods';

/*
 * Prompts are templates the user picks (e.g. a slash command in Claude Code). They only
 * contain instructions: the model still gets every figure from the tools. Dates are worked
 * out here, so the model never has to do calendar arithmetic.
 */

const userMessage = (text: string): GetPromptResult => ({
  messages: [{ role: 'user', content: { type: 'text', text } }],
});

const ONLY_FROM_TOOLS =
  'Use only figures and facts returned by the tools; if something is missing, say so ' +
  'rather than estimating it.';

export function registerPrompts(
  server: McpServer,
  api: NorthwindClient,
  now: () => Date,
): void {
  server.registerPrompt(
    'quarterly_review',
    {
      title: 'Quarterly review',
      description:
        'A business review of one quarter against the one before: revenue, top customers, ' +
        'categories, sales staff, shipping and overdue orders.',
      argsSchema: {
        quarter: completable(
          z
            .string()
            .optional()
            .describe(
              'Quarter as YYYY-Qn, e.g. 2026-Q3 (default: the last complete quarter)',
            ),
          (value) =>
            recentQuarters(now(), 8)
              .map((q) => q.label)
              .filter((label) => label.startsWith((value ?? '').toUpperCase())),
        ),
      },
    },
    ({ quarter }) => {
      const q = quarter ? parseQuarter(quarter) : recentQuarters(now(), 1)[0];
      if (!q) {
        throw new Error(`"${quarter}" is not a quarter; use the form 2026-Q3.`);
      }
      const prev = previousQuarter(q);
      const range = `from "${q.from}", to "${q.to}"`;
      const inProgress = q.to > today(now());

      return userMessage(
        [
          `Prepare a quarterly business review of Northwind Traders for ${q.label} ` +
            `(orders placed ${q.from} to ${lastDay(q.to)}), compared with ${prev.label} ` +
            `(${prev.from} to ${lastDay(prev.to)}).` +
            (inProgress
              ? ` ${q.label} is still in progress, so its figures run only to today (${today(now())}).`
              : ''),
          '',
          'Gather the data with these tool calls; the dates are already worked out, use them as given:',
          `1. sales_over_time with granularity "quarter", from "${prev.from}", to "${q.to}": revenue and orders for both quarters.`,
          `2. sales_breakdown with by "customer", ${range}, limit 5: the top customers.`,
          `3. sales_breakdown with by "category", ${range}: the category mix and shares.`,
          `4. sales_breakdown with by "employee", ${range}: the sales staff ranking.`,
          `5. shipping_performance with ${range}: speed and late shipments per shipper.`,
          '6. find_overdue_orders: orders still open past their required date.',
          '',
          'Then write the review with these sections:',
          `- Headline: ${q.label} revenue and order count, and the change from ${prev.label} in amount and percent.`,
          '- Top 5 customers, with revenue.',
          '- Categories: the top three by revenue, with their shares.',
          '- Sales staff: the best and the weakest by revenue.',
          '- Shipping: on-time percentage and late shipments per shipper.',
          '- Open overdue orders, if there are any.',
          '',
          ONLY_FROM_TOOLS,
        ].join('\n'),
      );
    },
  );

  server.registerPrompt(
    'chase_overdue_orders',
    {
      title: 'Chase overdue orders',
      description:
        'Open orders past their required date, grouped by customer with the contact to call, ' +
        'and a short follow-up message for each customer.',
      argsSchema: {
        asOf: z
          .string()
          .optional()
          .describe(
            'Measure lateness as of this date, YYYY-MM-DD (default today)',
          ),
      },
    },
    ({ asOf }) => {
      const date = asOf?.trim() || today(now());
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
        throw new Error(`"${asOf}" is not a date; use the form YYYY-MM-DD.`);
      }
      return userMessage(
        [
          `List the Northwind orders that are overdue as of ${date} and prepare follow-ups with the customers.`,
          '',
          `1. Call find_overdue_orders with kind "open" and asOf "${date}". If the result says there are more pages, fetch them too.`,
          '2. If you want to mention what was ordered, call get_order for that order.',
          '',
          'Then, grouped by customer, most overdue first:',
          '- the customer (name and code) and the contact to call: name, title, phone and email;',
          '- each overdue order: code, order date, required date, days late, total, and the sales employee who took it;',
          '- a short, polite message to the contact (2 to 4 sentences): apologise that the order is late, ' +
            'give its status, and ask whether they still need it as ordered.',
          '',
          'If nothing is overdue, say so in one sentence.',
          'Do not change or ship any orders: this is a review only.',
          ONLY_FROM_TOOLS,
        ].join('\n'),
      );
    },
  );

  server.registerPrompt(
    'customer_brief',
    {
      title: 'Customer brief',
      description:
        "A one-page brief on a customer: contact, relationship so far, what they buy, and what's open.",
      argsSchema: {
        customer: completable(
          z.string().describe('Customer code (ALFKI) or company name'),
          async (value) => {
            const wanted = (value ?? '').trim().toLowerCase();
            const all = await new References(api).directory('customer');
            return all
              .filter(
                (c) =>
                  c.code.toLowerCase().startsWith(wanted) ||
                  c.name.toLowerCase().startsWith(wanted),
              )
              .slice(0, 20)
              .map((c) => c.code);
          },
        ),
      },
    },
    ({ customer }) =>
      userMessage(
        [
          `Write a one-page brief about the Northwind customer "${customer}".`,
          '',
          `1. Call get_customer with customer "${customer}": contact, address and order statistics ` +
            '(orders, pending, lifetime revenue, first and last order). Use the code it returns in the next calls.',
          '2. Call find_orders with that customer code, includeLines true and limit 5: their recent orders and products.',
          '3. Call find_orders with that customer code and status "pending": anything not shipped yet.',
          '4. Call find_overdue_orders and note any of their orders on it.',
          '',
          'The brief:',
          '- Who they are: company, city and country, and the contact (name, title, phone, email).',
          '- The relationship: customer since, number of orders, lifetime revenue (from get_customer, ' +
            'do not add it up yourself), and the last order.',
          '- What they buy: the products that come up most in their recent orders.',
          '- Open items: pending and overdue orders.',
          '- One practical suggestion for their account manager.',
          '',
          ONLY_FROM_TOOLS,
        ].join('\n'),
      ),
  );
}
