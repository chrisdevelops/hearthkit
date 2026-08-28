import type { ReactNode } from 'react'

import { mergeTailwindClasses } from './merge-tailwind-classes.ts'

/** Props of PageHeader; children are page actions and sit to the right of the title block. */
type PageHeaderProps = {
  pageTitle: string
  pageDescription?: string
  children?: ReactNode
  className?: string
}

/** Page title block; pageTitle renders as the page's h1, so use one PageHeader per page. */
export function PageHeader({ pageTitle, pageDescription, children, className }: PageHeaderProps) {
  return (
    <div
      data-slot="page-header"
      className={mergeTailwindClasses(
        'flex flex-col gap-4 pb-8 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">{pageTitle}</h1>
        {pageDescription !== undefined && (
          <p className="text-sm text-muted-foreground">{pageDescription}</p>
        )}
      </div>
      {children !== undefined && (
        <div className="flex items-center gap-2 sm:ml-auto">{children}</div>
      )}
    </div>
  )
}
