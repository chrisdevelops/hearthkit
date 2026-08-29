import { describe, expect, it } from 'vitest'
import { expectNonEmptyStringList } from '../test-fixtures/app-template-gate-expectations.ts'
import { readTemplateFileText } from '../test-fixtures/app-template-tree-files.ts'
import {
  appTemplateCiWorkflowRequiredContent,
  appTemplateDeployWorkflowRequiredContent,
  appTemplateFailureSchema,
  appWorkflowContentMissingErrorPrefix,
} from './app-template-contract.ts'

const ciWorkflowPath = '.github/workflows/ci.yml'
const deployWorkflowPath = '.github/workflows/deploy.yml'

/**
 * Required literals a workflow is missing, each reported with the contract's own prefix so a failing
 * run reads like the app-workflow-content-missing failure it models. The required list is read
 * through expectNonEmptyStringList: an empty or renamed contract export would otherwise make this
 * gate pass while checking nothing.
 */
function missingWorkflowContent(
  workflowPath: string,
  requiredContent: unknown,
  contractExportName: string,
): string[] {
  const workflowText = readTemplateFileText(workflowPath)

  return expectNonEmptyStringList(requiredContent, contractExportName)
    .filter((requiredLine) => !workflowText.includes(requiredLine))
    .map((missingLine) => `${appWorkflowContentMissingErrorPrefix} ${workflowPath}: ${missingLine}`)
}

describe('the workflows every generated project gets', () => {
  it('runs install, lint, typecheck and the Playwright smoke on a pull request in ci.yml', () => {
    expect(
      missingWorkflowContent(
        ciWorkflowPath,
        appTemplateCiWorkflowRequiredContent,
        'appTemplateCiWorkflowRequiredContent',
      ),
    ).toEqual([])

    const workflowContentFailure = appTemplateFailureSchema.parse({
      kind: 'app-workflow-content-missing',
      workflowPath: ciWorkflowPath,
      missingLine: 'pnpm test:e2e',
      message: `${appWorkflowContentMissingErrorPrefix} ${ciWorkflowPath}: pnpm test:e2e`,
    })
    expect(workflowContentFailure.kind).toBe('app-workflow-content-missing')
  })

  it('builds, pushes to the registry and guards the Dokploy webhook on a secret in deploy.yml', () => {
    // The required list holds both halves of the webhook guard. GitHub does not expose the secrets
    // context in any if key, so the step maps the secret into env and conditions on env.<name> !=
    // ''. Losing either half would either break the workflow or fire the webhook with an empty URL,
    // and would take with it the property that build-and-push works on a throwaway repository with
    // no Dokploy instance at all.
    expect(
      missingWorkflowContent(
        deployWorkflowPath,
        appTemplateDeployWorkflowRequiredContent,
        'appTemplateDeployWorkflowRequiredContent',
      ),
    ).toEqual([])
  })
})
