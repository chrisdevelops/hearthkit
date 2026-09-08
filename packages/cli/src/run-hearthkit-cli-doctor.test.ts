import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectCliFailure,
  expectCliSuccess,
  runHearthkitCliGate,
} from '../test-fixtures/cli-run-expectations.ts'
import {
  createGateDirectory,
  gateEnvironment,
  removeGateDirectory,
} from '../test-fixtures/gate-project-directories.ts'
import { unreachableAdminDatabaseUrl } from '../test-fixtures/postgres-gate-psql.ts'
import {
  adminDatabaseUrlEnvVariableName,
  cliDoctorFailedErrorPrefix,
  doctorCheckNameSchema,
  doctorJsonReportSchema,
} from './cli-contract.ts'

let workingDirectoryPath: string

beforeAll(async () => {
  workingDirectoryPath = await createGateDirectory('doctor')
})

afterAll(async () => {
  await removeGateDirectory(workingDirectoryPath)
})

describe('hearthkit doctor', () => {
  it('reports every check passing and prints the json report when --json is given', async () => {
    // No CLI variable is set, so the reachability check uses the default local admin url and the
    // env variable check passes on both variables being unset.
    const run = await runHearthkitCliGate({
      argv: ['doctor', '--json'],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const success = expectCliSuccess(run, 'doctor-report', 0)
    expect(success.allDoctorChecksPassed).toBe(true)
    expect([...success.checks].map((check) => check.checkName).toSorted()).toEqual(
      [...doctorCheckNameSchema.options].toSorted(),
    )
    expect(success.checks.filter((check) => check.status !== 'pass')).toEqual([])
    expect(success.checks.every((check) => check.detail.length > 0)).toBe(true)

    const printedReport = doctorJsonReportSchema.parse(JSON.parse(run.standardOutput))
    expect(printedReport.allDoctorChecksPassed).toBe(true)
    expect(printedReport.checks).toEqual(success.checks)
  })

  it('exits 1 and names the failed check when the admin database url is unreachable', async () => {
    const run = await runHearthkitCliGate({
      argv: ['doctor'],
      cwd: workingDirectoryPath,
      env: gateEnvironment({
        [adminDatabaseUrlEnvVariableName]: unreachableAdminDatabaseUrl,
      }),
    })

    const failure = expectCliFailure(run, 'doctor-checks-failed', 1)
    expect(failure.failedCheckNames).toContain('admin-database-reachable')
    expect([...failure.checks].map((check) => check.checkName).toSorted()).toEqual(
      [...doctorCheckNameSchema.options].toSorted(),
    )
    expect(
      failure.checks.find((check) => check.checkName === 'admin-database-reachable')?.status,
    ).toBe('fail')
    expect(failure.message.startsWith(cliDoctorFailedErrorPrefix)).toBe(true)
    // The report still prints even though the command failed.
    expect(run.standardOutput).toContain('admin-database-reachable')
    expect(run.standardError).toContain(failure.message)
  })
})
