'use client'

import { authApiBasePath } from '@hearthkit/auth/auth-contract'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageContainer,
  PageHeader,
} from '@hearthkit/ui'
import { useCallback, useState, type ChangeEvent } from 'react'

/**
 * The `@hearthkit/auth` section: create an account with a password, or ask for a one-time sign-in link.
 *
 * Every request here goes to the catch-all route at `/api/auth`, which is where `@hearthkit/auth`
 * mounts Better Auth. The browser talks to it over plain `fetch` rather than through
 * `createAuthBrowserClient`, deliberately: this file is a Client Component, and importing the
 * `@hearthkit/auth` entry point into one would pull the Drizzle client and the Postgres driver into
 * the browser bundle. `@hearthkit/auth/auth-contract` is the JSX-free, dependency-free half, so the
 * one value this page needs — the API base path — still comes from the package rather than from a
 * literal typed twice.
 *
 * Reach for `createAuthBrowserClient` when you want `useSession` in a component that is not on this
 * critical path; it is the same endpoints with hooks around them.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

/** Where a completed sign-in lands, and what the emailed link is told to open. */
const signedInRoutePath = '/account'

export default function SignInSectionPage() {
  const [displayName, setDisplayName] = useState('')
  const [emailAddress, setEmailAddress] = useState('')
  const [password, setPassword] = useState('')
  const [sectionMessage, setSectionMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const postToAuthApi = useCallback(
    async (endpointPath: string, requestBody: Record<string, string>): Promise<boolean> => {
      const response = await fetch(`${authApiBasePath}${endpointPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      if (!response.ok) {
        setSectionMessage(await response.text())
        return false
      }
      return true
    },
    [],
  )

  const runAuthAction = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true)
    setSectionMessage('')
    try {
      await action()
    } finally {
      setIsBusy(false)
    }
  }, [])

  const createAccount = useCallback(async (): Promise<void> => {
    if (
      await postToAuthApi('/sign-up/email', { name: displayName, email: emailAddress, password })
    ) {
      window.location.assign(signedInRoutePath)
    }
  }, [displayName, emailAddress, password, postToAuthApi])

  const signInWithPassword = useCallback(async (): Promise<void> => {
    if (await postToAuthApi('/sign-in/email', { email: emailAddress, password })) {
      window.location.assign(signedInRoutePath)
    }
  }, [emailAddress, password, postToAuthApi])

  const requestMagicLink = useCallback(async (): Promise<void> => {
    if (
      await postToAuthApi('/sign-in/magic-link', {
        email: emailAddress,
        callbackURL: signedInRoutePath,
      })
    ) {
      setSectionMessage(`A sign-in link is on its way to ${emailAddress}.`)
    }
  }, [emailAddress, postToAuthApi])

  return (
    <PageContainer>
      <PageHeader
        pageTitle="Sign in"
        pageDescription="Accounts, sessions and one-time sign-in links, all served by the catch-all route at /api/auth."
      />

      <Card>
        <CardHeader>
          <CardTitle>With a password</CardTitle>
          <CardDescription>
            Creating an account signs you straight in, which is what `@hearthkit/auth` pins.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-name">Name</Label>
            <Input
              id="auth-name"
              data-testid="auth-name-input"
              autoComplete="name"
              value={displayName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setDisplayName(event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              data-testid="auth-email-input"
              autoComplete="email"
              value={emailAddress}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setEmailAddress(event.target.value)
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              data-testid="auth-password-input"
              autoComplete="current-password"
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setPassword(event.target.value)
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={isBusy}
              onClick={() => {
                void runAuthAction(createAccount)
              }}
            >
              Create account
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={() => {
                void runAuthAction(signInWithPassword)
              }}
            >
              Sign in
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>With a link</CardTitle>
          <CardDescription>
            The link is emailed through `@hearthkit/email` and can only be used once.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            onClick={() => {
              void runAuthAction(requestMagicLink)
            }}
          >
            Email me a sign-in link
          </Button>
          <p data-testid="auth-message" className="text-sm break-all text-muted-foreground">
            {sectionMessage}
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
