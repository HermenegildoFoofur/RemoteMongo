/** Sesiones por cookie firmada: HMAC-SHA256 con el secreto de la instalación.
 *
 *  No se guarda nada en el servidor: la cookie lleva el usuario y la caducidad, y la
 *  firma impide que nadie se invente otra.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'rm_sesion';
const DURACION = 30 * 24 * 3600; // 30 días

const base64url = (b) => Buffer.from(b).toString('base64url');

function firmar(secreto, datos) {
  return createHmac('sha256', secreto).update(datos).digest('base64url');
}

export function crearSesion(secreto, usuario, rol = 'usuario') {
  const carga = base64url(JSON.stringify({ u: usuario, r: rol, e: Math.floor(Date.now() / 1000) + DURACION }));
  return `${carga}.${firmar(secreto, carga)}`;
}

export function leerSesion(secreto, cookie) {
  if (!cookie) return null;
  const valor = cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`));
  if (!valor) return null;
  const [carga, firma] = valor.slice(COOKIE.length + 1).split('.');
  if (!carga || !firma) return null;
  const esperada = firmar(secreto, carga);
  if (firma.length !== esperada.length) return null;
  if (!timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const datos = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8'));
    if (!datos.u || datos.e * 1000 < Date.now()) return null;
    return { usuario: datos.u, rol: datos.r || 'usuario' };
  } catch {
    return null;
  }
}

export const cookieDe = (valor, { seguro = true, borrar = false } = {}) => {
  const partes = [
    `${COOKIE}=${borrar ? '' : valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${borrar ? 0 : DURACION}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
};
