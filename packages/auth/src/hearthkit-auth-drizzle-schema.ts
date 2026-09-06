import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { HearthkitAuthDrizzleSchema } from './auth-contract.ts'

/**
 * The seven auth tables, defined once for every project. The organizations scaffold flag decides
 * which endpoints exist, never which tables do, so `organization`, `member` and `invitation` are
 * here in user-scoped mode too: moving a project between the two modes re-homes rows, and dropping
 * the tables from one of them would make that a data migration instead.
 *
 * Every property key is Better Auth's own field name, because the Drizzle adapter resolves a column
 * as `schema[modelName][fieldName]`; the SQL column names underneath are Drizzle's business and this
 * package leaves them equal to the property keys. Every SQL table name equals the model name,
 * because verifyAuthTablesExist looks them up in information_schema.tables.
 *
 * `user` is a reserved word in Postgres. Drizzle quotes it; anything writing raw SQL must too.
 */

/** Better Auth's core account holder; email is unique, which is what makes a duplicate sign up detectable. */
export const hearthkitAuthUserTable = pgTable('user', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull(),
  image: text(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

/** One signed-in session; activeOrganizationId exists in both modes, and is null until an organization is chosen. */
export const hearthkitAuthSessionTable = pgTable('session', {
  id: text().primaryKey(),
  expiresAt: timestamp().notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => hearthkitAuthUserTable.id, { onDelete: 'cascade' }),
  activeOrganizationId: text(),
})

/** One credential or linked social account; the password hash lives here, never on the user row. */
export const hearthkitAuthAccountTable = pgTable('account', {
  id: text().primaryKey(),
  issuer: text().notNull(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => hearthkitAuthUserTable.id, { onDelete: 'cascade' }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp(),
  refreshTokenExpiresAt: timestamp(),
  scope: text(),
  password: text(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

/** Short-lived tokens; magic link stores its one-time token here rather than in a table of its own. */
export const hearthkitAuthVerificationTable = pgTable('verification', {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

/** An organization; the unique slug is what makes a second organization unable to claim the same one. */
export const hearthkitAuthOrganizationTable = pgTable('organization', {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  createdAt: timestamp().notNull(),
  metadata: text(),
})

/** One membership row joining a user to an organization with a role of owner, admin or member. */
export const hearthkitAuthMemberTable = pgTable('member', {
  id: text().primaryKey(),
  organizationId: text()
    .notNull()
    .references(() => hearthkitAuthOrganizationTable.id, { onDelete: 'cascade' }),
  userId: text()
    .notNull()
    .references(() => hearthkitAuthUserTable.id, { onDelete: 'cascade' }),
  role: text().notNull(),
  createdAt: timestamp().notNull(),
})

/** A pending invitation to join an organization; this package wraps no invitation endpoint, but the table must exist. */
export const hearthkitAuthInvitationTable = pgTable('invitation', {
  id: text().primaryKey(),
  organizationId: text()
    .notNull()
    .references(() => hearthkitAuthOrganizationTable.id, { onDelete: 'cascade' }),
  email: text().notNull(),
  role: text(),
  status: text().notNull(),
  expiresAt: timestamp().notNull(),
  createdAt: timestamp().notNull(),
  inviterId: text()
    .notNull()
    .references(() => hearthkitAuthUserTable.id, { onDelete: 'cascade' }),
})

/** The Drizzle table map this package ships; spread it into the app's schema so one drizzle-kit run covers every table. */
export const hearthkitAuthDrizzleSchema = {
  user: hearthkitAuthUserTable,
  session: hearthkitAuthSessionTable,
  account: hearthkitAuthAccountTable,
  verification: hearthkitAuthVerificationTable,
  organization: hearthkitAuthOrganizationTable,
  member: hearthkitAuthMemberTable,
  invitation: hearthkitAuthInvitationTable,
} satisfies HearthkitAuthDrizzleSchema
