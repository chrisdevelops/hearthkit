import type { z } from 'zod'

/**
 * Narrowing helpers the shape gates share. Like the tree fixture, nothing here imports from src/:
 * the gates pass every contract value in, so this directory never breaks the pruning invariant.
 */

/** True for any non-null object, which is all a module namespace or a parsed JSON object needs to be before its keys are read one by one. */
export function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** True for any function value; the widest callable type, so a gate that needs a signature parses it through expectExportedFunctionOfType. */
function isCallableValue(value: unknown): value is (...functionArguments: never[]) => unknown {
  return typeof value === 'function'
}

/**
 * Imports one template module through a literal specifier and reports the path when it is missing,
 * so a template with no implementation fails one gate at a time instead of failing collection.
 */
export async function importTemplateModule(
  templateRelativePath: string,
  importModule: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  let moduleNamespace: unknown
  try {
    moduleNamespace = await importModule()
  } catch (error) {
    throw new Error(
      `gate could not import templates/app/${templateRelativePath} (not written yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (!isUnknownRecord(moduleNamespace)) {
    throw new Error(
      `gate expected templates/app/${templateRelativePath} to import as a module namespace, received ${typeof moduleNamespace}`,
    )
  }
  return moduleNamespace
}

/** One named export that must be a function, failing the gate with the file that should have exported it. */
export function expectExportedFunction(
  moduleNamespace: Record<string, unknown>,
  exportName: string,
  templateRelativePath: string,
): (...functionArguments: never[]) => unknown {
  const exportedValue = moduleNamespace[exportName]
  if (!isCallableValue(exportedValue)) {
    throw new Error(
      `gate expected templates/app/${templateRelativePath} to export ${exportName} as a function, received ${typeof exportedValue}`,
    )
  }
  return exportedValue
}

/** One named export that must be a function of the signature the passed schema names; the schema is a z.custom over that signature, and the gate that calls it checks the behaviour. */
export function expectExportedFunctionOfType<
  TFunction extends (...functionArguments: never[]) => unknown,
>(
  moduleNamespace: Record<string, unknown>,
  exportName: string,
  templateRelativePath: string,
  functionSchema: z.ZodType<TFunction>,
): TFunction {
  return functionSchema.parse(
    expectExportedFunction(moduleNamespace, exportName, templateRelativePath),
  )
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
  if (!Array.isArray(contractValue) || contractValue.length === 0) {
    throw new Error(
      `gate expected the contract to export ${contractExportName} as a non-empty array of strings, received ${JSON.stringify(contractValue)}`,
    )
  }
  const entries: readonly unknown[] = contractValue
  const stringEntries = entries.filter(
    (entry): entry is string => typeof entry === 'string' && entry !== '',
  )
  if (stringEntries.length !== entries.length) {
    throw new Error(
      `gate expected the contract to export ${contractExportName} as a non-empty array of strings, received ${JSON.stringify(contractValue)}`,
    )
  }
  return stringEntries
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
  if (!isUnknownRecord(value) || Array.isArray(value)) {
    return {}
  }
  return value
}

/** A string array read out of parsed JSON, or an empty array when the key is absent or not an array of strings. */
export function jsonStringArrayAt(jsonObject: Record<string, unknown>, key: string): string[] {
  const value = jsonObject[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}
