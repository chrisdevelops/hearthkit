import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appTemplateManifestModulePath,
  loadAppTemplateSectionManifest,
} from './src/app-template-section-manifest.ts'

/**
 * `prepack`: copy `templates/app` into this package so the published tarball is self-contained.
 *
 * `templates/app` is a private workspace project that is never published, so a tarball that only
 * pointed at it would scaffold nothing. The copy is what `files` ships and what
 * `defaultAppTemplateDirectoryPath` falls back to; inside the workspace the live template always
 * wins, so this directory is git-ignored and only ever exists during a pack.
 *
 * What is left out is the same set create would prune anyway, plus the whole of the template's
 * `src/` except the section manifest — that one file is the only part of `src/` create reads, and it
 * is read by dynamic import at run time rather than bundled into this package's own source.
 */

/** Unique literal prefix of every failure this script reports; a pack that half-copied a template is worse than one that stopped. */
const bundledTemplateCopyFailedErrorPrefix = 'hearthkit create bundled template copy failed:'

/** Where the live template lives, relative to this package. */
const liveTemplateDirectoryPath = fileURLToPath(new URL('../../templates/app', import.meta.url))

/** Where the copy goes; the same directory name `files` ships and the published default resolves to. */
const bundledTemplateDirectoryPath = fileURLToPath(new URL('./app-template', import.meta.url))

/** Directories excluded on top of the manifest's own lists: the git repository and the template's gate fixtures. */
const extraExcludedDirectoryNames = ['.git', 'test-fixtures'] as const

/** Copies one template subtree, deciding every entry against the exclusion rules above. */
async function copyBundledTemplateDirectory(options: {
  relativePrefix: string
  excludedDirectoryNames: readonly string[]
  excludedFileNames: readonly string[]
}): Promise<number> {
  const sourceDirectoryPath =
    options.relativePrefix === ''
      ? liveTemplateDirectoryPath
      : join(liveTemplateDirectoryPath, ...options.relativePrefix.split('/'))

  let copiedFileCount = 0
  for (const entry of await readdir(sourceDirectoryPath, { withFileTypes: true })) {
    const relativePath =
      options.relativePrefix === '' ? entry.name : `${options.relativePrefix}/${entry.name}`

    if (entry.isDirectory()) {
      if (options.excludedDirectoryNames.includes(entry.name)) {
        continue
      }
      copiedFileCount += await copyBundledTemplateDirectory({
        ...options,
        relativePrefix: relativePath,
      })
      continue
    }
    if (!entry.isFile() || options.excludedFileNames.includes(entry.name)) {
      continue
    }
    // The template's src/ is hearthkit-only except for the section manifest, which create imports at
    // run time and therefore has to ship.
    if (relativePath.startsWith('src/') && relativePath !== appTemplateManifestModulePath) {
      continue
    }

    const destinationFilePath = join(bundledTemplateDirectoryPath, ...relativePath.split('/'))
    await mkdir(dirname(destinationFilePath), { recursive: true })
    await copyFile(join(sourceDirectoryPath, entry.name), destinationFilePath)
    copiedFileCount += 1
  }
  return copiedFileCount
}

const manifest = await loadAppTemplateSectionManifest(liveTemplateDirectoryPath)
await rm(bundledTemplateDirectoryPath, { recursive: true, force: true })
const copiedFileCount = await copyBundledTemplateDirectory({
  relativePrefix: '',
  excludedDirectoryNames: [
    ...manifest.appTemplateNeverCopiedDirectoryNames,
    ...extraExcludedDirectoryNames,
  ],
  excludedFileNames: [...manifest.appTemplateNeverCopiedFileNames],
})

if (copiedFileCount === 0) {
  process.stderr.write(
    `${bundledTemplateCopyFailedErrorPrefix} no file was copied from ${liveTemplateDirectoryPath}\n`,
  )
  process.exit(1)
}
process.stdout.write(
  `bundled ${String(copiedFileCount)} template files into ${bundledTemplateDirectoryPath}\n`,
)
