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
import { nuevaClave } from './cifrado.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Ruta del fichero de instalación (se lee en cada uso, para poder aislarla en pruebas). */
const ruta = () => process.env.RM_INSTALACION || path.join(RAIZ, 'state', 'instalacion.json');
export const FICHERO = ruta();

/** «/remotemongo/» → «/remotemongo»; «/» o vacío → «» (raíz). */
export function normalizarRutaBase(valor) {
  let v = String(valor ?? '').trim();
  if (!v || v === '/') return '';
  if (!v.startsWith('/')) v = `/${v}`;
  return v.replace(/\/+$/, '');
}

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
      rutaBase: normalizarRutaBase(process.env.RM_RUTA_BASE),
      claveCifrado: process.env.RM_CLAVE_CIFRADO || null,
      origen: 'entorno',
    };
  }
  try {
    const datos = JSON.parse(readFileSync(ruta(), 'utf8'));
    if (datos && datos.mongoUrl && datos.dominio) {
      return {
        ...datos,
        cuotaBase: Number(datos.cuotaBase) || CUOTA_BASE,
        rutaBase: normalizarRutaBase(datos.rutaBase),
        claveCifrado: datos.claveCifrado || null,
        configurado: true,
      };
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
    rutaBase: normalizarRutaBase(process.env.RM_RUTA_BASE),
  };
}

export function guardarInstalacion({ mongoUrl, mongoDb, dominio, https = true, puerto, cuotaBase, claveCifrado, rutaBase }) {
  const datos = {
    configurado: true,
    mongoUrl,
    mongoDb: mongoDb || 'remotemongo',
    dominio: String(dominio).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    https: Boolean(https),
    secreto: randomBytes(32).toString('hex'),
    claveCifrado: claveCifrado || nuevaClave(),
    puerto: Number(puerto) || 8790,
    cuotaBase: Number(cuotaBase) || CUOTA_BASE,
    rutaBase: normalizarRutaBase(rutaBase),
    fecha: new Date().toISOString(),
  };
  escribirFichero(datos);
  return datos;
}

/** Clave de cifrado en reposo: la del fichero, o una nueva que se guarda al momento.
 *
 *  Vive fuera de MongoDB a propósito: con un dump de la base no hay nada que leer.
 */
export function claveDeCifrado(datos = null) {
  if (datos && datos.claveCifrado) return datos.claveCifrado;
  const nueva = nuevaClave();
  guardarAjustes({ claveCifrado: nueva });
  return nueva;
}

/** Cambia ajustes sueltos (cuota base, registro abierto) sin tocar el secreto. */
export function guardarAjustes(cambios = {}) {
  let datos = null;
  try { datos = JSON.parse(readFileSync(ruta(), 'utf8')); } catch { /* sin fichero */ }
  if (!datos) return null;   // en modo entorno no hay fichero: solo vive en memoria
  const nuevos = { ...datos, ...cambios };
  escribirFichero(nuevos);
  return nuevos;
}

function escribirFichero(datos) {
  mkdirSync(path.dirname(ruta()), { recursive: true });
  writeFileSync(ruta(), JSON.stringify(datos, null, 2), { mode: 0o600 });
  try { chmodSync(ruta(), 0o600); } catch { /* si no se puede, se queda como esté */ }
}

export const existeInstalacion = () => existsSync(ruta());