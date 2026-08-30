import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

export const fromRoot = (...parts) => path.join(repoRoot, ...parts);

export const readJson = (...parts) => JSON.parse(readFileSync(fromRoot(...parts), 'utf8'));

export const readText = (...parts) => readFileSync(fromRoot(...parts), 'utf8');

export const exists = (...parts) => existsSync(fromRoot(...parts));

/**
 * Onde está o site construído. `SITE_DIR` permite apontar para um build
 * de CI em diretório temporário; o padrão é o ./public de sempre.
 */
export const siteDir = () => (process.env.SITE_DIR
  ? path.resolve(process.env.SITE_DIR)
  : fromRoot('public'));
