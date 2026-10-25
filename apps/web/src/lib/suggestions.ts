/**
 * Nine questions people ask about Northwind, worded for the shifted dates ("last year" instead
 * of 1997). They are also the questions of the benchmark (scripts/bench/questions.mjs).
 */
export const SUGGESTIONS: Record<string, string[]> = {
  'One lookup': [
    "What's in order 10248?",
    'Which products are low on stock?',
    'Show me the contact for customer ALFKI',
  ],
  'Filter or report': [
    'Who were the top 5 customers last year?',
    'List the customers in Germany',
    'How much does Chai cost and how many are in stock?',
  ],
  'Multi-step': [
    'What did Alfreds Futterkiste order most recently?',
    'Which supplier makes the products that are low on stock?',
    'Which employee sold the most this year, and what is their title?',
  ],
};
