/**
 * Copied references: the id and code of another record plus its display name, embedded so
 * reads need no extra lookups. Follow `id` or `code` to the referenced resource.
 */
export class NamedRefDto {
  /** @example 6955b9007f176b5b1a33c31c */
  id: string;
  /** @example CAT-01 */
  code: string;
  /** @example Beverages */
  name: string;
}

export class CompanyRefDto {
  /** @example 6955b9007f176b5b1a33c31c */
  id: string;
  /** @example VINET */
  code: string;
  /** Company name at the time it was copied (kept current for open records). @example "Vins et alcools Chevalier" */
  companyName: string;
}
