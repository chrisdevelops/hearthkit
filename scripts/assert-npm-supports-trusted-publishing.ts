import { execFileSync } from 'node:child_process'

/**
 * Release workflow guard: fails when the runner's npm CLI predates trusted publishing.
 *
 * npm exchanges the GitHub OIDC token for a publish credential inside the CLI, and only npm 11.5.1
 * or later knows how (https://docs.npmjs.com/trusted-publishers). pnpm 10 delegates `pnpm publish`
 * to that CLI, so it is npm's version that decides whether the publish step can authenticate at
 * all, and an older npm fails late with a misleading "need auth" error instead of this one.
 */

/** Unique literal prefix of the one failure this script reports. */
const npmTooOldForTrustedPublishingErrorPrefix =
  'hearthkit release npm too old for trusted publishing:'

/** The first npm CLI release with OIDC trusted publishing. */
const minimumNpmVersionForTrustedPublishing = [11, 5, 1] as const

const npmVersionText = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
const npmVersionParts = npmVersionText.split('.').map((part) => Number.parseInt(part, 10))

const isAtLeastMinimum = ((): boolean => {
  for (let index = 0; index < minimumNpmVersionForTrustedPublishing.length; index += 1) {
    const actual = npmVersionParts[index] ?? 0
    const required = minimumNpmVersionForTrustedPublishing[index] ?? 0
    if (actual > required) {
      return true
    }
    if (actual < required) {
      return false
    }
  }
  return true
})()

if (npmVersionParts.length < 3 || npmVersionParts.some((part) => Number.isNaN(part))) {
  process.stderr.write(
    `${npmTooOldForTrustedPublishingErrorPrefix} could not parse "npm --version" output "${npmVersionText}"\n`,
  )
  process.exit(1)
}
if (!isAtLeastMinimum) {
  process.stderr.write(
    `${npmTooOldForTrustedPublishingErrorPrefix} npm ${npmVersionText} is older than ${minimumNpmVersionForTrustedPublishing.join('.')}\n`,
  )
  process.exit(1)
}
process.stdout.write(`npm ${npmVersionText} supports trusted publishing\n`)
