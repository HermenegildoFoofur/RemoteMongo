/** Instalación del servidor: como WordPress, la primera vez se pide todo.
 *
 *  La conexión a MongoDB no puede vivir dentro de MongoDB, así que se guarda en un
 *  fichero local (`state/instalacion.json`, permisos 600). Ahí van también el secreto
 *  de las sesiones y el dominio público. El resto (cuentas, datos) vive en la base.
 */

import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FICHERO = process.env.RM_INSTALACION || path.join(RAIZ, 'state', 'instalacion.json');

/** Cuota de espacio por defecto de cada cuenta: 100 MB (se cambia desde /admin). */
export const CUOTA_BASE = 100 * 1024 * 1024;

export function leerInstalacion() {
  if (process.env.RM_MONGO_URL && process.env.RM_DOMINIO && process.env.RM_ADMIN_TOKEN) {
    // modo «todo por entorno»: útil en Docker o cuando no se quiere asistente
    return {
      configurado: true,
      mongoUrl: process.env.RM_MONGO_URL,
      mongoDb: process.env.RM_MONGO_DB || 'remotemongo',
      dominio: process.env.RM_DOMINIO,
      https: String(process.env.RM_HTTPS || 'si') === 'si',
      secreto: process.env.RM_SECRETO || process.env.RM_ADMIN_TOKEN,
      puerto: Number(process.env.RM_PORT || 8790),
      cuotaBase: Number(process.env.RM_CUOTA_BASE) || CUOTA_BASE,
      origen: 'entorno',
    };
  }
  try {
    const datos = JSON.parse(readFileSync(FICHERO, 'utf8'));
    if (datos && datos.mongoUrl && datos.dominio) {
      return { ...datos, cuotaBase: Number(datos.cuotaBase) || CUOTA_BASE, configurado: true };
    }
  } catch { /* sin fichero: no instalado */ }
  return {
    configurado: false,
    puerto: Number(process.env.RM_PORT || 8790),
    https: String(process.env.RM_HTTPS || 'si') === 'si',
    mongoUrl: process.env.RM_MONGO_URL || 'mongodb://127.0.0.1:27017',
    mongoDb: process.env.RM_MONGO_DB || 'remotemongo',
    dominio: '',
    cuotaBase: Number(process.env.RM_CUOTA_BASE) || CUOTA_BASE,
  };
}

export function guardarInstalacion({ mongoUrl, mongoDb, dominio, https = true, puerto, cuotaBase }) {
  const datos = {
    configurado: true,
    mongoUrl,
    mongoDb: mongoDb || 'remotemongo',
    dominio: String(dominio).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    https: Boolean(https),
    secreto: randomBytes(32).toString('hex'),
    puerto: Number(puerto) || 8790,
    cuotaBase: Number(cuotaBase) || CUOTA_BASE,
    fecha: new Date().toISOString(),
  };
  escribirFichero(datos);
  return datos;
}

/** Cambia ajustes sueltos (cuota base, registro abierto) sin tocar el secreto. */
export function guardarAjustes(cambios = {}) {
  let datos = null;
  try { datos = JSON.parse(readFileSync(FICHERO, 'utf8')); } catch { /* sin fichero */ }
  if (!datos) return null;   // en modo entorno no hay fichero: solo vive en memoria
  const nuevos = { ...datos, ...cambios };
  escribirFichero(nuevos);
  return nuevos;
}

function escribirFichero(datos) {
  mkdirSync(path.dirname(FICHERO), { recursive: true });
  writeFileSync(FICHERO, JSON.stringify(datos, null, 2), { mode: 0o600 });
  try { chmodSync(FICHERO, 0o600); } catch { /* si no se puede, se queda como esté */ }
}

export const existeInstalacion = () => existsSync(FICHERO);
