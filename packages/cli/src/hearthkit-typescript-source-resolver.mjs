/**
 * Resolver hook for the hearthkit bin. Every package here ships TypeScript source and writes its
 * relative imports with the .js extension NodeNext requires, but Node's own type stripping resolves
 * specifiers literally and never maps .js onto .ts. This retries such a specifier against the .ts
 * file that actually shipped, and leaves every other specifier to the default resolver untouched.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const isRelativeJavaScriptSpecifier =
      (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && isRelativeJavaScriptSpecifier) {
      return nextResolve(`${specifier.slice(0, -'.js'.length)}.ts`, context)
    }
    throw error
  }
}
