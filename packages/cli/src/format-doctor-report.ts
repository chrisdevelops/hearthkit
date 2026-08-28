import {
  doctorCheckNameSchema,
  doctorJsonReportSchema,
  type DoctorCheckResult,
  type DoctorJsonReport,
} from './cli-contract.ts'

/** Width of the name column in the human table; the longest check name plus breathing room. */
const doctorCheckNameColumnWidth =
  Math.max(...doctorCheckNameSchema.options.map((checkName) => checkName.length)) + 2

/** The exact JSON envelope doctor --json prints, validated on the way out so the printed text always matches the schema. */
export function formatDoctorJsonReport(report: DoctorJsonReport): string {
  return JSON.stringify(doctorJsonReportSchema.parse(report))
}

/** The human table doctor prints without --json: one line per check, status first so failures are scannable. */
export function formatDoctorCheckTable(checks: readonly DoctorCheckResult[]): string {
  return checks
    .map(
      (check) =>
        `${check.status.padEnd(4)}  ${check.checkName.padEnd(doctorCheckNameColumnWidth)}${check.detail}`,
    )
    .join('\n')
}
