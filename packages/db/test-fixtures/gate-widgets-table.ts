import { integer, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * A table an app would own, standing in for the Drizzle schema a consumer passes to
 * createDrizzleClient. This package never ships tables, so the gate has to bring its own.
 */
export const gateWidgetsTable = pgTable('gate_widgets', {
  id: integer('id').primaryKey(),
  label: text('label').notNull(),
})

/** The same table as raw SQL, so the gate can seed it without depending on the migration runner. */
export const gateWidgetsCreateTableSql =
  'create table gate_widgets (id integer primary key, label text not null)'

/** Two rows the typed-client gate reads back in id order. */
export const gateWidgetsSeedSql =
  "insert into gate_widgets (id, label) values (1, 'first widget'), (2, 'second widget')"
