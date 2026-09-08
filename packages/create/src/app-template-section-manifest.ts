import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'

/**
 * The template's section manifest, read at run time rather than imported at build time.
 *
 * `templates/app` is a private workspace project with no `exports` field and it is never published,
 * so it cannot be a dependency of this package. The manifest is therefore loaded by dynamic import
 * from `<templateDirectoryPath>/src/app-template-contract.ts`, which is the one file of `src/` a
 * generated project's template copy keeps, and validated here so a manifest that lost a field fails
 * with a message naming the field instead of undefined-ing its way through the copy walk.
 *
 * Only what `create` consumes is described below. Everything else the template contract declares is
 * the template's own business.
 */

/** Unique literal prefix reported when the template's section manifest cannot be imported or does not hold the fields create reads. */
export const appTemplateManifestUnreadableErrorPrefix =
  'hearthkit create app template manifest unreadable:'

/** Path of the manifest module inside a template directory; the single file of the template's src/ that a bundled copy keeps. */
export const appTemplateManifestModulePath = 'src/app-template-contract.ts'

/** One optional package's entry in the manifest, narrowed to the lists create reads while copying and rewriting. */
const appTemplateSectionSchema = z.object({
  ownedTemplatePaths: z.array(z.string().min(1)),
  blockPrunedPaths: z.array(z.string().min(1)),
  hearthkitDependencyNames: z.array(z.string().min(1)),
  devDependencyNames: z.array(z.string().min(1)),
  packageScriptNames: z.array(z.string().min(1)),
  requiredOptionalPackageNames: z.array(z.string().min(1)),
})

/** Exactly the manifest values create reads; a template that drops one of them fails at load rather than mid-copy. */
const appTemplateSectionManifestSchema = z.object({
  appTemplateNeverCopiedDirectoryNames: z.array(z.string().min(1)),
  appTemplateNeverCopiedFileNames: z.array(z.string().min(1)),
  appTemplateRepoOnlyDirectoryNames: z.array(z.string().min(1)),
  appTemplateRepoOnlyPaths: z.array(z.string().min(1)),
  appTemplateRenamedPaths: z.array(
    z.object({ templatePath: z.string().min(1), generatedProjectPath: z.string().min(1) }),
  ),
  appTemplateOptionalPackageNames: z.array(z.string().min(1)).min(1),
  appTemplateSectionsByOptionalPackage: z.record(z.string(), appTemplateSectionSchema),
  appTemplateSectionBlockBeginPrefix: z.string().min(1),
  appTemplateSectionBlockEndPrefix: z.string().min(1),
  appTemplateOptionalBlockMalformedErrorPrefix: z.string().min(1),
  appTemplateGuaranteedScriptNames: z.array(z.string().min(1)),
  appTemplateRepoOnlyScriptNames: z.array(z.string().min(1)),
  appTemplateRepoOnlyDependencyNames: z.array(z.string().min(1)),
  appTemplateWorkspaceDependencySpecifier: z.string().min(1),
})

/** The manifest values create reads; every list is the template's, never a second copy kept here. */
export type AppTemplateSectionManifest = z.infer<typeof appTemplateSectionManifestSchema>

/** Where the template lives when no templateDirectoryPath is given: the live workspace copy, else the copy prepack bundled into this package. */
export const defaultAppTemplateDirectoryPath = ((): string => {
  const workspaceTemplatePath = fileURLToPath(new URL('../../../templates/app', import.meta.url))
  const bundledTemplatePath = fileURLToPath(new URL('../app-template', import.meta.url))
  return existsSync(join(workspaceTemplatePath, ...appTemplateManifestModulePath.split('/')))
    ? workspaceTemplatePath
    : bundledTemplatePath
})()

/** Imports and validates the section manifest of one template directory; throws with the prefix above when it cannot. */
export async function loadAppTemplateSectionManifest(
  templateDirectoryPath: string,
): Promise<AppTemplateSectionManifest> {
  const manifestModulePath = join(
    templateDirectoryPath,
    ...appTemplateManifestModulePath.split('/'),
  )

  let manifestModule: unknown
  try {
    manifestModule = await import(pathToFileURL(manifestModulePath).href)
  } catch (thrownValue) {
    throw new Error(
      `${appTemplateManifestUnreadableErrorPrefix} ${manifestModulePath} could not be imported: ${thrownValue instanceof Error ? thrownValue.message : String(thrownValue)}`,
      { cause: thrownValue },
    )
  }

  const parsed = appTemplateSectionManifestSchema.safeParse(manifestModule)
  if (!parsed.success) {
    throw new Error(
      `${appTemplateManifestUnreadableErrorPrefix} ${manifestModulePath} is missing ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    )
  }
  return parsed.data
}

/**
 * The manifest of the default template, loaded once when this module is first imported.
 *
 * Top-level await so the two pure pruning functions stay synchronous, which is what their callers —
 * a directory walk and a per-file copy — need them to be.
 */
export const defaultAppTemplateSectionManifest: AppTemplateSectionManifest =
  await loadAppTemplateSectionManifest(defaultAppTemplateDirectoryPath)
