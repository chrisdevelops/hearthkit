import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Joins clsx-style class inputs and drops earlier Tailwind classes a later one conflicts with; shadcn calls this helper `cn`. */
export function mergeTailwindClasses(...classInputs: ClassValue[]): string {
  return twMerge(clsx(classInputs))
}
