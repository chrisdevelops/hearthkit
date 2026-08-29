/**
 * Narrowing helpers the shape gates share. Like the tree fixture, nothing here imports from src/:
 * the gates pass every contract value in, so this directory never breaks the pruning invariant.
 */

/**
 * Imports one template module through a literal specifier and reports the path when it is missing,
 * so a template with no implementation fails one gate at a time instead of failing collection.
 */
export async function importTemplateModule(
  templateRelativePath: string,
  importModule: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    return (await importModule()) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not import templates/app/${templateRelativePath} (not written yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** One named export that must be a function, failing the gate with the file that should have exported it. */
export function expectExportedFunction(
  moduleNamespace: Record<string, unknown>,
  exportName: string,
  templateRelativePath: string,
): (...functionArguments: never[]) => unknown {
  const exportedValue = moduleNamespace[exportName]
  if (typeof exportedValue !== 'function') {
    throw new Error(
      `gate expected templates/app/${templateRelativePath} to export ${exportName} as a function, received ${typeof exportedValue}`,
    )
  }
  return exportedValue as (...functionArguments: never[]) => unknown
}

/**
 * A contract list a gate's own logic depends on, checked before it is trusted.
 *
 * A renamed or deleted contract export resolves to `undefined` through Vite's module runner rather
 * than throwing, and the template has no package.json yet, so no `tsc` run catches it either. When
 * such a value feeds a skip predicate or a template string, the gate would keep passing while
 * checking nothing. This turns that into a named failure.
 */
export function expectNonEmptyStringList(
  contractValue: unknown,
  contractExportName: string,
): readonly string[] {
  if (
    !Array.isArray(contractValue) ||
    contractValue.length === 0 ||
    contractValue.some((entry) => typeof entry !== 'string' || entry === '')
  ) {
    throw new Error(
      `gate expected the contract to export ${contractExportName} as a non-empty array of strings, received ${JSON.stringify(contractValue)}`,
    )
  }
  return contractValue as readonly string[]
}

/** The message of a value that must have been thrown; fails the gate when nothing was thrown or it was not an Error. */
export function expectThrownErrorMessage(thrown: unknown): string {
  if (!(thrown instanceof Error)) {
    throw new Error(`gate expected an Error to be thrown, received ${JSON.stringify(thrown)}`)
  }
  return thrown.message
}

/** Runs a function that must throw and returns the thrown message, so a gate never passes on a silent success. */
export function messageOfThrownFrom(runFunction: () => unknown): string {
  let thrown: unknown
  try {
    runFunction()
  } catch (error) {
    thrown = error
  }
  return expectThrownErrorMessage(thrown)
}

/** A nested record read out of parsed JSON, or an empty record when the key is absent or not an object. */
export function jsonObjectAt(
  jsonObject: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = jsonObject[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

/** A string array read out of parsed JSON, or an empty array when the key is absent or not an array of strings. */
export function jsonStringArrayAt(jsonObject: Record<string, unknown>, key: string): string[] {
  const value = jsonObject[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}
