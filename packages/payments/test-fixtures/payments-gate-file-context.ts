/**
 * One value a gate file builds once and every gate in it shares: the loaded entry point, a scratch
 * database, a payments client, a synced catalog.
 *
 * It is built on first read rather than in beforeAll on purpose. A beforeAll that throws makes Vitest
 * report every test in the file as SKIPPED, and a skipped gate is not a failing gate: against an
 * empty implementation the run would say "16 files failed, 45 skipped" instead of naming each gate
 * that cannot pass yet. Reading it inside each test makes the same missing export fail every gate by
 * name, which is what makes a pre-implementation run readable evidence. Recorded in docs/STATUS.md
 * as the mistake the auth gate-writer's first draft made.
 */

/** A value built at most once per file, with a release that does nothing when it was never built. */
export type GateFileContext<TValue> = {
  read: () => Promise<TValue>
  releaseIfCreated: (release: (value: TValue) => Promise<void>) => Promise<void>
}

/** Memoises the build, failures included, so every gate in the file reports the same first cause. */
export function defineGateFileContext<TValue>(
  buildGateFileContext: () => Promise<TValue>,
): GateFileContext<TValue> {
  let pendingValue: Promise<TValue> | undefined

  return {
    read: () => {
      pendingValue ??= buildGateFileContext()
      return pendingValue
    },
    releaseIfCreated: async (release) => {
      if (pendingValue === undefined) {
        return
      }
      // A build that failed has nothing to release, and its error already failed every gate in the
      // file; rethrowing it from afterAll would replace those messages with this one.
      const settled = await pendingValue.then(
        (built) => ({ built: true as const, value: built }),
        () => ({ built: false as const, value: undefined }),
      )
      if (settled.built) {
        await release(settled.value)
      }
    },
  }
}
