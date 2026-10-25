# Classic Northwind source data

Generated from Microsoft's official `instnwnd.sql` (the SQL Server 2000 era Northwind), not edited by hand.

|           |                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Source    | https://github.com/microsoft/sql-server-samples/blob/master/samples/databases/northwind-pubs/instnwnd.sql |
| Commit    | `2f85f3724ee45776a5183ed34d064488a6e1dc53` (last change to the file, 2023-04-18)                          |
| License   | MIT, © Microsoft Corporation — see [LICENSE-sql-server-samples.txt](LICENSE-sql-server-samples.txt)       |
| Converter | [`scripts/convert-instnwnd.mts`](../../scripts/convert-instnwnd.mts)                                      |

## What the conversion changes

The JSON keeps the original table and column names, one file per table. Only three things differ from the SQL:

- **Image blobs are dropped** (`Categories.Picture`, `Employees.Photo`).
- **Dates are ISO** (`7/4/1996` → `1996-07-04`; the script uses `DATEFORMAT mdy`).
- **Money and discounts are strings** holding the exact source text (`"9.8"`, `"0.15"`), so no float rounding happens.

Everything else (codes, emails, E.164 phones, ISO countries, the date shift) happens at seed time in `src/transform.ts`.

## Regenerating

```sh
curl -fsSLo /tmp/instnwnd.sql https://raw.githubusercontent.com/microsoft/sql-server-samples/2f85f3724ee45776a5183ed34d064488a6e1dc53/samples/databases/northwind-pubs/instnwnd.sql
pnpm --filter @northwind/seed convert /tmp/instnwnd.sql
```

Expected rows: categories 8, customers 91, employees 9, employee-territories 49, order-details 2155, orders 830, products 77, regions 4, shippers 3, suppliers 29, territories 53.
