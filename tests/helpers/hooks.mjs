/** Resolve `./foo` como `./foo.js` (ver loader.mjs). */
const EXTENSIONS = ['.js', '.mjs', '.json'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const relative = specifier.startsWith('.') || specifier.startsWith('/');
    if (relative && !/\.[a-z0-9]+$/i.test(specifier)) {
      for (const extension of EXTENSIONS) {
        try {
          return await nextResolve(specifier + extension, context);
        } catch { /* tenta a próxima */ }
      }
    }
    throw error;
  }
}
