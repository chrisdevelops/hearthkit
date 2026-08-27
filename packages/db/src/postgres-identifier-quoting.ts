/** Wraps a Postgres identifier in double quotes and doubles any embedded quote, so an interpolated name can never close the identifier early. */
export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/** Wraps a Postgres string literal in single quotes and doubles any embedded quote, for the DDL statements that cannot take bound parameters. */
export function quotePostgresStringLiteral(literal: string): string {
  return `'${literal.replaceAll("'", "''")}'`
}
