/** Configuración de RemoteMongo. Sale del entorno o de un `.env` al lado del proyecto. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function leerEnv(fichero) {
  const salida = {};
  try {
    for (const linea of readFileSync(fichero, 'utf8').split('\n')) {
      const limpia = linea.trim();
      if (!limpia || limpia.startsWith('#') || !limpia.includes('=')) continue;
      const i = limpia.indexOf('=');
      salida[limpia.slice(0, i).trim()] = limpia.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* sin .env: valores por defecto */ }
  return salida;
}

const env = { ...leerEnv(path.join(RAIZ, '.env')), ...process.env };

export const config = {
  puerto: Number(env.RM_PORT || 8790),
  /** Dominio público: es lo que va detrás de la @ de cada usuario. */
  dominio: env.RM_DOMINIO || 'localhost:8790',
  /** true cuando va detrás de un proxy con TLS. */
  https: String(env.RM_HTTPS || 'si') === 'si',
  mongoUrl: env.RM_MONGO_URL || 'mongodb://127.0.0.1:27017',
  mongoDb: env.RM_MONGO_DB || 'remotemongo',
  /** Permite abrir cuenta desde la web. Se puede cerrar cuando ya no quieras más. */
  registroAbierto: String(env.RM_REGISTRO || 'si') === 'si',
  /** Clave para la ruta de administración (listar usuarios y tokens). */
  adminToken: env.RM_ADMIN_TOKEN || '',
};
