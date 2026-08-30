/**
 * Registrado via `node --import ./tests/helpers/loader.mjs`.
 *
 * O código de assets/scripts é compilado pelo esbuild embutido no Hugo
 * (`js.Build`), que resolve `import x from './spendingLimits'` sem
 * extensão. O ESM do Node não resolve — e é só por isso que esses
 * módulos não eram testáveis. O hook abaixo repõe exatamente essa
 * resolução, nada mais: nenhum bundler, nenhuma transpilação, nenhum
 * risco de o teste passar num código diferente do que vai para o ar.
 */
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
