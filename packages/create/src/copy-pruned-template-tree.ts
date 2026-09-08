import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppTemplateSectionManifest } from './app-template-section-manifest.ts'
import { decideTemplatePathPrune } from './decide-template-path-prune.ts'
import { pruneOptionalSectionBlocks } from './prune-optional-section-blocks.ts'
import { rewriteOrganizationsFlagLiteral } from './rewrite-organizations-flag-literal.ts'

/**
 * Walks the template and writes the project, deciding every entry with the two pruning functions.
 *
 * A directory is never created for its own sake: the first file written into it creates it, so a
 * section whose files were all dropped leaves no empty directory behind. A file that needs no
 * transformation is copied byte for byte rather than round-tripped through a string, so nothing here
 * can corrupt a file the template later adds that is not UTF-8 text.
 */

/** What the copy wrote, as generated-project relative POSIX paths in the order the walk visited them. */
export type CopiedTemplateTree = {
  writtenProjectPaths: string[]
}

/** Everything one copy needs; the selection is explicit, because an absent one means the template itself and never a project. */
export type CopyPrunedTemplateTreeOptions = {
  templateDirectoryPath: string
  projectDirectoryPath: string
  selectedSectionPackageNames: readonly string[]
  organizationsEnabled: boolean
  templateSectionManifest: AppTemplateSectionManifest
}

/** The name a template file is written under in a generated project; only the ignore file changes. */
function generatedProjectPathOf(
  templateSectionManifest: AppTemplateSectionManifest,
  templateRelativePath: string,
): string {
  return (
    templateSectionManifest.appTemplateRenamedPaths.find(
      (rename) => rename.templatePath === templateRelativePath,
    )?.generatedProjectPath ?? templateRelativePath
  )
}

/** Applies every text transformation this copy owes one file, or reports that the bytes are unchanged. */
function transformTemplateFileText(
  fileText: string,
  options: CopyPrunedTemplateTreeOptions,
): string {
  const { templateSectionManifest } = options
  const carriesMarker =
    fileText.includes(templateSectionManifest.appTemplateSectionBlockBeginPrefix) ||
    fileText.includes(templateSectionManifest.appTemplateSectionBlockEndPrefix)

  const blockPrunedText = carriesMarker
    ? pruneOptionalSectionBlocks({
        fileText,
        selectedOptionalPackageNames: options.selectedSectionPackageNames,
        templateSectionManifest,
      })
    : fileText

  return options.organizationsEnabled
    ? rewriteOrganizationsFlagLiteral(blockPrunedText)
    : blockPrunedText
}

/** Copies one file, writing it back only when a transformation actually changed its bytes. */
async function copyTemplateFile(options: {
  sourceFilePath: string
  destinationFilePath: string
  copyOptions: CopyPrunedTemplateTreeOptions
}): Promise<void> {
  await mkdir(dirname(options.destinationFilePath), { recursive: true })

  const fileText = await readFile(options.sourceFilePath, 'utf8')
  const transformedText = transformTemplateFileText(fileText, options.copyOptions)
  if (transformedText === fileText) {
    await copyFile(options.sourceFilePath, options.destinationFilePath)
    return
  }
  await writeFile(options.destinationFilePath, transformedText, 'utf8')
}

/** Copies the template tree into the project directory and answers the generated-project paths it wrote. */
export async function copyPrunedTemplateTree(
  options: CopyPrunedTemplateTreeOptions,
): Promise<CopiedTemplateTree> {
  const writtenProjectPaths: string[] = []

  const walkTemplateDirectory = async (relativePrefix: string): Promise<void> => {
    const sourceDirectoryPath =
      relativePrefix === ''
        ? options.templateDirectoryPath
        : join(options.templateDirectoryPath, ...relativePrefix.split('/'))

    for (const entry of await readdir(sourceDirectoryPath, { withFileTypes: true })) {
      const templateRelativePath =
        relativePrefix === '' ? entry.name : `${relativePrefix}/${entry.name}`
      if (
        decideTemplatePathPrune({
          templateRelativePath,
          selectedOptionalPackageNames: options.selectedSectionPackageNames,
          templateSectionManifest: options.templateSectionManifest,
        }).kind !== 'template-path-copied'
      ) {
        continue
      }

      if (entry.isDirectory()) {
        await walkTemplateDirectory(templateRelativePath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }

      const projectRelativePath = generatedProjectPathOf(
        options.templateSectionManifest,
        templateRelativePath,
      )
      await copyTemplateFile({
        sourceFilePath: join(sourceDirectoryPath, entry.name),
        destinationFilePath: join(options.projectDirectoryPath, ...projectRelativePath.split('/')),
        copyOptions: options,
      })
      writtenProjectPaths.push(projectRelativePath)
    }
  }

  await walkTemplateDirectory('')
  return { writtenProjectPaths }
}
