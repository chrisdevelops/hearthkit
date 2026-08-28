import * as React from 'react'

import { mergeTailwindClasses } from '../../merge-tailwind-classes.ts'

/**
 * shadcn `card` component family, generated from the new-york-v4 registry and kept faithful to it so
 * a later `shadcn add --overwrite` is a small diff. Only the class-merge import differs from upstream.
 */

/** Card surface; the sub-parts below are plain layout slots that expect to sit inside one. */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={mergeTailwindClasses(
        'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

/** Header row of a Card; grows a second column when it contains a CardAction. */
function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={mergeTailwindClasses(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  )
}

/** Card heading text; a div, not a heading element, so a page picks its own heading level. */
function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={mergeTailwindClasses('leading-none font-semibold', className)}
      {...props}
    />
  )
}

/** Muted supporting line under a CardTitle. */
function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={mergeTailwindClasses('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

/** Action slot pinned to the top right of a CardHeader; only positions correctly inside one. */
function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={mergeTailwindClasses(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

/** Main body slot of a Card. */
function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={mergeTailwindClasses('px-6', className)} {...props} />
  )
}

/** Footer slot of a Card; gains top padding when it also carries a border-t class. */
function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={mergeTailwindClasses('flex items-center px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
