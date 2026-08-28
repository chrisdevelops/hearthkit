'use client'

import * as React from 'react'
import { Label as LabelPrimitive } from 'radix-ui'

import { mergeTailwindClasses } from '../../merge-tailwind-classes.ts'

/**
 * shadcn `label` component, generated from the new-york-v4 registry and kept faithful to it so a
 * later `shadcn add --overwrite` is a small diff. Only the class-merge import differs from upstream.
 */

/** Form label; give it `htmlFor` matching a control id so screen readers name the control. */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={mergeTailwindClasses(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
