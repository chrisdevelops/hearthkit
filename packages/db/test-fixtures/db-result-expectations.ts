import { dbFailureSchema, type DbFailure } from '../src/db-contract.js'

/** Narrows any contract result to one variant, failing the gate with the whole result when it took another branch. */
export function expectResultKind<TResult extends { kind: string }, TKind extends TResult['kind']>(
  result: TResult,
  expectedKind: TKind,
): Extract<TResult, { kind: TKind }> {
  if (result.kind !== expectedKind) {
    throw new Error(`gate expected ${expectedKind}, received ${JSON.stringify(result)}`)
  }
  return result as unknown as Extract<TResult, { kind: TKind }>
}

/**
 * Validates a returned failure against the contract union, which also checks the message prefix,
 * then narrows it to the expected kind. Failures are returned as values, never thrown.
 */
export function expectDbFailure<TKind extends DbFailure['kind']>(
  result: unknown,
  expectedKind: TKind,
): Extract<DbFailure, { kind: TKind }> {
  const parsed = dbFailureSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error(
      `gate expected a ${expectedKind} failure matching dbFailureSchema, received ${JSON.stringify(result)}`,
    )
  }
  return expectResultKind(parsed.data, expectedKind)
}
