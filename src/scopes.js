/** Permisos al estilo remoteStorage: «quemo:rw» = categoría quemo, lectura y escritura. */

/** Convierte un scope en {categoria, lectura, escritura, comodin}. */
export function analizarScope(scope) {
  const limpio = String(scope || '').trim();
  const m = /^([a-zA-Z0-9._-]+|\*):(r|rw|w)?$/.exec(limpio);
  if (!m) return null;
  const modo = m[2] || 'r';
  return {
    categoria: m[1],
    lectura: modo === 'r' || modo === 'rw',
    escritura: modo === 'rw' || modo === 'w',
    comodin: m[1] === '*',
  };
}

/** Lista de scopes de una petición OAuth. */
export const analizarScopes = (texto) =>
  String(texto || '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(analizarScope)
    .filter(Boolean);

/** Comprueba si unos scopes concedidos permiten leer/escribir un path concreto. */
export function permite(scopes, ruta, { escribir = false } = {}) {
  const primera = String(ruta || '').replace(/^\/+/, '').split('/')[0];
  if (!primera) return false;
  for (const s of scopes) {
    if (s.comodin || s.categoria === primera) {
      if (escribir ? s.escritura : s.lectura) return true;
    }
  }
  return false;
}

/** Texto legible para la pantalla de permiso. */
export function describirScope(scope) {
  const s = typeof scope === 'string' ? analizarScope(scope) : scope;
  if (!s) return String(scope);
  const permiso = s.lectura && s.escritura ? 'leer y escribir' : s.escritura ? 'escribir' : 'leer';
  return `${s.categoria} (${permiso})`;
}
