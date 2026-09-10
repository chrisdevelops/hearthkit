import { readFile } from 'node:fs/promises'
import { tofuInputVariableNameSchema, type TofuInputVariableName } from './cli-contract.ts'

/**
 * Reads the five operator inputs out of a project's infra/tofu.tfvars.
 *
 * It reads only the five names the provider contract defines and only simple `name = "value"`
 * assignments, because that is the shape @hearthkit/create writes and the shape an operator fills in
 * by hand. Anything else — a missing file, a commented-out line, a blank value — is reported as an
 * incomplete input rather than parsed cleverly, so the operator is told the name to fix.
 */

/** Every input filled, or every name that is blank or absent; a missing file reports all five. */
export type TofuInputVariablesRead =
  | {
      kind: 'tofu-input-variables-read'
      variableValues: Record<TofuInputVariableName, string>
    }
  | {
      kind: 'tofu-input-variables-incomplete'
      incompleteVariableNames: TofuInputVariableName[]
    }

/** Reads and checks the tfvars file at an absolute path; never throws for a missing or unreadable file. */
export async function readTofuInputVariablesFile(
  tfvarsPath: string,
): Promise<TofuInputVariablesRead> {
  const fileText = await readFile(tfvarsPath, 'utf8').catch(() => undefined)
  const assignedValues =
    fileText === undefined ? new Map<string, string>() : readTfvarsAssignments(fileText)

  const incompleteVariableNames = tofuInputVariableNameSchema.options.filter(
    (variableName) => (assignedValues.get(variableName) ?? '') === '',
  )
  if (incompleteVariableNames.length > 0) {
    return { kind: 'tofu-input-variables-incomplete', incompleteVariableNames }
  }

  return {
    kind: 'tofu-input-variables-read',
    variableValues: {
      project_name: assignedValues.get('project_name') ?? '',
      zone_name: assignedValues.get('zone_name') ?? '',
      zone_id: assignedValues.get('zone_id') ?? '',
      account_id: assignedValues.get('account_id') ?? '',
      host_ip: assignedValues.get('host_ip') ?? '',
    },
  }
}

/** Every `name = "value"` assignment in a tfvars file, with comment lines skipped and quotes removed. */
function readTfvarsAssignments(fileText: string): Map<string, string> {
  const assignedValues = new Map<string, string>()
  for (const line of fileText.split('\n')) {
    const trimmedLine = line.trim()
    if (trimmedLine === '' || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
      continue
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*)$/.exec(trimmedLine)
    if (assignment === null) {
      continue
    }
    const [, variableName = '', rawValue = ''] = assignment
    assignedValues.set(variableName, unquoteTfvarsValue(rawValue))
  }
  return assignedValues
}

/** The value of one assignment: a double-quoted string without its quotes, or the bare word as written. */
function unquoteTfvarsValue(rawValue: string): string {
  const trimmedValue = rawValue.trim()
  const quoted = /^"(.*)"$/.exec(trimmedValue)
  return (quoted?.[1] ?? trimmedValue).trim()
}
