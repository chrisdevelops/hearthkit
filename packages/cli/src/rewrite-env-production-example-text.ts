/**
 * Rewrites the lines of a project's .env.production.example that the applied infrastructure decides,
 * and no other byte of it.
 *
 * Pure text in, text out, and idempotent: running it twice on its own output changes nothing. It
 * never writes STORAGE_SECRET_ACCESS_KEY, because no hearthkit command puts a secret in a file — that
 * value is printed once and pasted into Dokploy by hand.
 */

/** The variable that documents where a GlitchTip DSN comes from; the hint is written as the comment above it. */
const glitchtipDsnVariableName = 'GLITCHTIP_DSN'

/** One variable to set and the value to set it to; the caller decides which names it may touch. */
export type EnvProductionExampleAssignment = {
  variableName: string
  value: string
}

/** Rewrites the named assignments in place, appending the ones the file does not have, and sets the DSN hint comment. */
export function rewriteEnvProductionExampleText(options: {
  fileText: string
  assignments: readonly EnvProductionExampleAssignment[]
  dsnHint: string
}): string {
  const endsWithNewline = options.fileText.endsWith('\n')
  const lines = options.fileText.split('\n')
  // A trailing newline splits into a final empty element; dropping it here and restoring it at the
  // end is what keeps "every other byte unchanged" true for a file that ends the normal way.
  if (endsWithNewline) {
    lines.pop()
  }

  for (const assignment of options.assignments) {
    assignLine(lines, assignment)
  }
  applyDsnHintComment(lines, options.dsnHint)

  return `${lines.join('\n')}${endsWithNewline ? '\n' : ''}`
}

/** Replaces the first `NAME=` line with the assigned value, or appends the assignment when there is none. */
function assignLine(lines: string[], assignment: EnvProductionExampleAssignment): void {
  const assignedLine = `${assignment.variableName}=${assignment.value}`
  const lineIndex = lines.findIndex((line) => line.startsWith(`${assignment.variableName}=`))
  if (lineIndex === -1) {
    lines.push(assignedLine)
    return
  }
  lines[lineIndex] = assignedLine
}

/** Puts the hint on the comment line above the first GLITCHTIP_DSN= line, inserting the comment or both lines when needed. */
function applyDsnHintComment(lines: string[], dsnHint: string): void {
  const hintCommentLine = `# ${dsnHint}`
  const dsnLineIndex = lines.findIndex((line) => line.startsWith(`${glitchtipDsnVariableName}=`))
  if (dsnLineIndex === -1) {
    lines.push(hintCommentLine, `${glitchtipDsnVariableName}=`)
    return
  }
  const lineAbove = dsnLineIndex === 0 ? undefined : lines[dsnLineIndex - 1]
  if (lineAbove !== undefined && lineAbove.trimStart().startsWith('#')) {
    lines[dsnLineIndex - 1] = hintCommentLine
    return
  }
  lines.splice(dsnLineIndex, 0, hintCommentLine)
}
