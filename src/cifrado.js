/** Cifrado en reposo de los cuerpos de documento (AES-256-GCM).
 *
 *  La clave vive en `state/instalacion.json` (permisos 600), **no** en MongoDB: con un
 *  dump o un backup de la base no se lee nada, porque falta la clave. El formato que se
 *  guarda es binario y autodescriptivo:
 *
 *      [0x01 versión][12 bytes IV][16 bytes etiqueta GCM][texto cifrado]
 *
 *  El IV es nuevo en cada escritura (GCM no se puede reutilizar) y la etiqueta detecta
 *  cualquier manipulación del fichero guardado. Un cuerpo que no empieza por la versión
 *  se devuelve tal cual: así lo que se hubiera guardado antes de cifrar se sigue leyendo
 *  y se cifra en la siguiente escritura, sin script de migración.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const ALG = 'aes-256-gcm';
const LARGO_IV = 12;
const LARGO_ETIQUETA = 16;
const CABECERA = 1 + LARGO_IV + LARGO_ETIQUETA;

/** Clave nueva en base64 (32 bytes). */
export const nuevaClave = () => randomBytes(32).toString('base64');

/** Cifrador. Sin clave, es un pasa-páginas (activar `false`). */
export function crearCifrador(claveBase64 = null) {
  const clave = claveBase64 ? Buffer.from(String(claveBase64), 'base64') : null;
  if (clave && clave.length !== 32) {
    throw new Error('la clave de cifrado tiene que ser de 32 bytes en base64');
  }
  return {
    activo: Boolean(clave),

    cifrar(entrada) {
      const datos = Buffer.isBuffer(entrada) ? entrada : Buffer.from(entrada);
      if (!clave) return datos;
      const iv = randomBytes(LARGO_IV);
      const c = createCipheriv(ALG, clave, iv);
      const cifrado = Buffer.concat([c.update(datos), c.final()]);
      return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), cifrado]);
    },

    descifrar(guardado) {
      const datos = Buffer.isBuffer(guardado) ? guardado : Buffer.from(guardado);
      if (!clave) return datos;
      if (datos.length < CABECERA || datos[0] !== VERSION) return datos;   // guardado sin cifrar
      const iv = datos.subarray(1, 1 + LARGO_IV);
      const etiqueta = datos.subarray(1 + LARGO_IV, CABECERA);
      const cuerpo = datos.subarray(CABECERA);
      const d = createDecipheriv(ALG, clave, iv);
      d.setAuthTag(etiqueta);
      return Buffer.concat([d.update(cuerpo), d.final()]);
    },
  };
}
