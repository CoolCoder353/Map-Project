/**
 * Parses a SQL string with PostgreSQL-style `$N` placeholders into the
 * literal segments between placeholders and the values in textual order.
 *
 * Handles repeated indexes (e.g. `$2` appearing twice) by duplicating the
 * value at each occurrence, so adapters that target positional `?`-style
 * binders or tagged-template SQL builders stay consistent with what
 * postgres would have produced from the original `$N` form.
 */
export declare function parsePlaceholders(text: string, values?: readonly unknown[]): {
    parts: string[];
    reordered: unknown[];
};
export declare const ARRAY_CAST: RegExp;
/**
 * Rewrites `$N` placeholders into a fresh sequential list, expanding any array-cast parameter
 * into an inline `ARRAY[...]` constructor of scalar parameters.
 *
 * Postgres wants an array bound whole, and node-postgres, postgres-js and PGlite all encode one.
 * Bun's SQL client cannot: it stringifies the array, so `= ANY($N::uuid[])` reaches the server as
 * `a,b` and fails with `malformed array literal` (oven-sh/bun#18775). `ARRAY[$2,$3]` is valid
 * everywhere a single array parameter was, and every element stays a bind parameter, so no value
 * is ever escaped into SQL text.
 */
export declare function expandArrayParams(text: string, values?: readonly unknown[]): {
    text: string;
    values: unknown[];
};
//# sourceMappingURL=placeholders.d.ts.map