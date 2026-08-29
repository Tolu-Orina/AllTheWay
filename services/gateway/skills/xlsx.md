# Spreadsheet skill

Use this when they asked for a spreadsheet, Excel, or .xlsx.

- `title` — workbook title.
- `headers` — column names. Money columns named Amount, Cost, Budget, Price, Total.
- `rows` — list of lists. Prefer numbers, not quoted numeric strings.
- Include a Total row for budgets and tables of amounts.
- Named `sheets` when more than one tab is needed.

The renderer freezes the header, paints it navy, and writes SUM formulas.
