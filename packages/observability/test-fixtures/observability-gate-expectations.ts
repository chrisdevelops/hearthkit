/** Narrows any contract result to one variant, failing the gate with the whole result when it took another branch. */
export function expectObservabilityResultKind<
  TResult extends { kind: string },
  TKind extends TResult['kind'],
>(result: TResult, expectedKind: TKind): Extract<TResult, { kind: TKind }> {
  if (result.kind !== expectedKind) {
    throw new Error(`gate expected ${expectedKind}, received ${JSON.stringify(result)}`)
  }
  return result as unknown as Extract<TResult, { kind: TKind }>
}

/** The message of a value that must have been thrown; fails the gate when nothing was thrown or it was not an Error. */
export function expectThrownErrorMessage(thrown: unknown): string {
  if (!(thrown instanceof Error)) {
    throw new Error(`gate expected an Error to be thrown, received ${JSON.stringify(thrown)}`)
  }
  return thrown.message
}
