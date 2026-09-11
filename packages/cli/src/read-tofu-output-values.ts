import { z } from 'zod'

/**
 * Reads `tofu output -json` and answers with the six module outputs as plain strings.
 *
 * An output the module did not produce is a module defect rather than an operator mistake, so the
 * reader names the missing output and lets the command report it as a failed `tofu output` run. The
 * secret output arrives here in the clear; it is returned and printed once and is written to no file.
 */

/** The six outputs infra/tofu/PROVIDER-CONTRACT.md requires of every provider module. */
const requiredTofuOutputNames = [
  'hostname',
  'storage_endpoint',
  'storage_bucket',
  'storage_access_key_id',
  'storage_secret_access_key',
  'dsn_hint',
] as const

/** The six module outputs as strings; the secret among them is returned to be printed once, never written. */
export type CloudflareModuleOutputs = Record<(typeof requiredTofuOutputNames)[number], string>

/** The shape of one entry in `tofu output -json`; only the value is read, and only as a string. */
const tofuOutputEntrySchema = z.object({ value: z.unknown() })

/** The whole document `tofu output -json` prints: one entry per output, keyed by output name. */
const tofuOutputDocumentSchema = z.record(z.string(), tofuOutputEntrySchema)

/** Every required output as a string, or the reason the document could not be used. */
export type TofuOutputValuesRead =
  | { kind: 'tofu-output-values-read'; moduleOutputs: CloudflareModuleOutputs }
  | { kind: 'tofu-output-values-unusable'; detail: string }

/** Parses one `tofu output -json` document; never throws, because unparseable JSON is a reported failure. */
export function readTofuOutputValues(outputJsonText: string): TofuOutputValuesRead {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(outputJsonText)
  } catch (error) {
    return {
      kind: 'tofu-output-values-unusable',
      detail: `tofu output -json did not print JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const parsedDocument = tofuOutputDocumentSchema.safeParse(parsedJson)
  if (!parsedDocument.success) {
    return {
      kind: 'tofu-output-values-unusable',
      detail: 'tofu output -json printed a document that is not a map of output names to values',
    }
  }

  const readValues = new Map<string, string>()
  const unusableOutputNames: string[] = []
  for (const outputName of requiredTofuOutputNames) {
    const value = parsedDocument.data[outputName]?.value
    if (typeof value !== 'string' || value === '') {
      unusableOutputNames.push(outputName)
      continue
    }
    readValues.set(outputName, value)
  }

  if (unusableOutputNames.length > 0) {
    return {
      kind: 'tofu-output-values-unusable',
      detail: `tofu output -json is missing ${unusableOutputNames.join(', ')}; the provider module must produce every output infra/tofu/PROVIDER-CONTRACT.md lists`,
    }
  }
  return {
    kind: 'tofu-output-values-read',
    moduleOutputs: {
      hostname: readValues.get('hostname') ?? '',
      storage_endpoint: readValues.get('storage_endpoint') ?? '',
      storage_bucket: readValues.get('storage_bucket') ?? '',
      storage_access_key_id: readValues.get('storage_access_key_id') ?? '',
      storage_secret_access_key: readValues.get('storage_secret_access_key') ?? '',
      dsn_hint: readValues.get('dsn_hint') ?? '',
    },
  }
}
