import type { ComponentType } from 'react'

/** The loaded public entry of @hearthkit/ui; values stay unknown until a gate narrows one by name. */
export type HearthkitUiEntry = Readonly<Record<string, unknown>>

/** Any component a gate renders; props stay opaque because gates assert DOM output, not prop types. */
export type UiGateComponent = ComponentType<Record<string, unknown>>

/** Any function a gate calls off the entry, such as useThemeMode or mergeTailwindClasses. */
export type UiGateFunction = (...functionArguments: unknown[]) => unknown

/**
 * Loads @hearthkit/ui through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function loadHearthkitUiEntry(): Promise<HearthkitUiEntry> {
  try {
    return (await import('@hearthkit/ui')) as HearthkitUiEntry
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/ui (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** True for anything React can render as a component: a function, or a forwardRef/memo object. */
function isRenderableUiComponent(candidate: unknown): boolean {
  return typeof candidate === 'function' || (typeof candidate === 'object' && candidate !== null)
}

/** Picks named components off the entry, failing the gate with every missing name at once. */
export function uiComponentsFromEntry<const TExportNames extends readonly string[]>(
  entry: HearthkitUiEntry,
  exportNames: TExportNames,
): Record<TExportNames[number], UiGateComponent> {
  const missingNames = exportNames.filter(
    (exportName) => !isRenderableUiComponent(entry[exportName]),
  )
  if (missingNames.length > 0) {
    throw new Error(
      `gate expected @hearthkit/ui to export React components named ${missingNames.join(', ')}`,
    )
  }

  const picked: Record<string, UiGateComponent> = {}
  for (const exportName of exportNames) {
    picked[exportName] = entry[exportName] as UiGateComponent
  }
  return picked as Record<TExportNames[number], UiGateComponent>
}

/** Picks one named function off the entry, failing the gate when it is absent or not callable. */
export function uiFunctionFromEntry(entry: HearthkitUiEntry, exportName: string): UiGateFunction {
  const candidate = entry[exportName]
  if (typeof candidate !== 'function') {
    throw new Error(`gate expected @hearthkit/ui to export a function named ${exportName}`)
  }
  return candidate as UiGateFunction
}
