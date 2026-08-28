import type { ReactNode } from 'react'

import { mergeTailwindClasses } from './merge-tailwind-classes.ts'

/** Props of PageContainer; className is merged with the container classes, it does not replace them. */
type PageContainerProps = {
  children?: ReactNode
  className?: string
}

/** Centred max-width page shell with responsive padding; wrap every page body in exactly one. */
export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div
      data-slot="page-container"
      className={mergeTailwindClasses(
        'mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8',
        className,
      )}
    >
      {children}
    </div>
  )
}
