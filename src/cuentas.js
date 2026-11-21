/** Cuentas, tokens y OAuth del servidor remoteStorage.
 *
 *  El flujo es el del protocolo: la app manda a la persona a /oauth/<usuario>?scope=…&redirect_uri=…
 *  el usuario aprueba, y la app recibe un token limitado a esa categoría. Con PKCE cuando
 *  el cliente lo pide (los clientes modernos), y con el flujo implícito clásico si no.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { analizarScopes, describirScope } from './scopes.js';

export const crearSal = () => randomBytes(16).toString('hex');

export function hashClave(clave, sal) {
  return scryptSync(String(clave), sal, 32).toString('hex');
}

export function claveCorrecta(clave, usuario) {
  if (!usuario) return false;
  const a = Buffer.from(hashClave(clave, usuario.sal), 'hex');
  const b = Buffer.from(usuario.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Valida un usuario nuevo: minúsculas, sin espacios y sin cosas raras en la URL. */
export function usuarioValido(nombre) {
  return /^[a-z0-9][a-z0-9._-]{1,31}$/.test(String(nombre || '').toLowerCase());
}

export const nuevoToken = () => randomBytes(32).toString('base64url');

/** PKCE: S256(verifier) tiene que cuadrar con el challenge que mandó la app. */
export function pkceCorrecto(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const calculado = createHash('sha256').update(verifier).digest('base64url');
  return calculado === challenge;
}

/** Lo que se le enseña al usuario en la pantalla de permiso. */
export const permisosLegibles = (scope) => analizarScopes(scope).map(describirScope);
