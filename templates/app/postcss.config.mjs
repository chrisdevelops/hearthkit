/**
 * PostCSS configuration. Tailwind v4 needs exactly one plugin, and this app owns `tailwindcss` and
 * `@tailwindcss/postcss`; `@hearthkit/ui` depends on neither. The package ships tokens and class
 * strings, this app generates the utilities.
 */
const postcssConfig = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default postcssConfig
