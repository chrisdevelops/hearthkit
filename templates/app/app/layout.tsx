import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ThemeModeProvider } from '@hearthkit/ui'
import './globals.css'

/** Document metadata for every page; override it per route with a page-level `metadata` export. */
export const metadata: Metadata = {
  title: 'hearthkit app',
  description: 'A new project scaffolded from the hearthkit app template',
}

/**
 * Root layout of the app.
 *
 * `ThemeModeProvider` has to sit above anything that calls `useThemeMode` or renders
 * `ThemeModeToggle`, and `suppressHydrationWarning` on the root html element is required because
 * the theme script writes the `dark` class onto that element before React hydrates.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <ThemeModeProvider>{children}</ThemeModeProvider>
      </body>
    </html>
  )
}
