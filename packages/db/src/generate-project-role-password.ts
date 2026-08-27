import { randomBytes } from 'node:crypto'

/** Bytes of entropy behind each generated project role password. */
const projectRolePasswordByteCount = 32

/** Random password in base64url, so it can sit in a connection string with no percent-encoding and no quoting surprises in DDL. */
export function generateProjectRolePassword(): string {
  return randomBytes(projectRolePasswordByteCount).toString('base64url')
}
