'use client'

import { authApiBasePath } from '@hearthkit/auth/auth-contract'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageContainer,
  PageHeader,
} from '@hearthkit/ui'
import { useCallback, useEffect, useState } from 'react'

/**
 * Who is signed in, read back from the session endpoint the catch-all route serves.
 *
 * A missing or expired cookie is a normal answer here, not an error: the endpoint answers with an
 * empty session and this page shows the sign-in prompt instead.
 *
 * Like the sign-in page this is a Client Component talking to `/api/auth` over `fetch`, so nothing
 * server-side reaches the browser bundle. For a server-rendered session read, call `readAuthSession`
 * from `@hearthkit/auth` in a Server Component with `headers()` instead.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

/** What the session endpoint answers with; only the fields this page renders are named. */
type AuthSessionSnapshotBody = {
  user?: { id?: string; name?: string; email?: string } | null
} | null

export default function AccountSectionPage() {
  const [signedInUser, setSignedInUser] = useState<{
    id: string
    name: string
    email: string
  } | null>(null)
  const [hasReadSession, setHasReadSession] = useState(false)

  const readSession = useCallback(async (): Promise<void> => {
    const response = await fetch(`${authApiBasePath}/get-session`, { cache: 'no-store' })
    const bodyText = await response.text()
    setHasReadSession(true)

    if (!response.ok || bodyText.trim() === '') {
      setSignedInUser(null)
      return
    }

    const snapshot = JSON.parse(bodyText) as AuthSessionSnapshotBody
    const user = snapshot?.user
    if (user === undefined || user === null || typeof user.email !== 'string') {
      setSignedInUser(null)
      return
    }
    setSignedInUser({ id: user.id ?? '', name: user.name ?? '', email: user.email })
  }, [])

  const signOut = useCallback(async (): Promise<void> => {
    await fetch(`${authApiBasePath}/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    setSignedInUser(null)
  }, [])

  useEffect(() => {
    void readSession()
  }, [readSession])

  return (
    <PageContainer>
      <PageHeader
        pageTitle="Account"
        pageDescription="The session this browser is holding, read from /api/auth/get-session."
      />

      <Card>
        <CardHeader>
          <CardTitle>{signedInUser === null ? 'Nobody is signed in' : signedInUser.name}</CardTitle>
          <CardDescription>
            {signedInUser === null
              ? 'Sign in from /sign-in with a password or a one-time link.'
              : 'This is the session every server-side read sees for this request.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {signedInUser !== null && (
            <dl className="grid gap-1 text-sm">
              <dt className="text-muted-foreground">Email</dt>
              <dd data-testid="account-session-email">{signedInUser.email}</dd>
              <dt className="mt-2 text-muted-foreground">User id</dt>
              <dd data-testid="account-session-user-id" className="break-all">
                {signedInUser.id}
              </dd>
            </dl>
          )}
          {signedInUser !== null && (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void signOut()
                }}
              >
                Sign out
              </Button>
            </div>
          )}
          {signedInUser === null && hasReadSession && (
            <p data-testid="account-signed-out" className="text-sm text-muted-foreground">
              No session cookie was sent with this request.
            </p>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  )
}
