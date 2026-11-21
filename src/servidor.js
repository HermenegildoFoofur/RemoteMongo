/** RemoteMongo — servidor remoteStorage sobre MongoDB.
 *
 *  Primera vez: asistente de instalación (como WordPress) para la ruta de Mongo, el dominio
 *  y la cuenta de administración. Después: entrar / crear cuenta / panel de usuario, y un
 *  panel de administración que solo ve metadatos (apps y espacio), nunca el contenido.
 */

import http from 'node:http';
import { AlmacenMongo, AlmacenMemoria, normal } from './store.js';
import { analizarScopes, permite } from './scopes.js';
import {
  claveCorrecta, crearSal, espacioValido, hashClave, nuevoToken, partirDireccion,
  permisosLegibles, pkceCorrecto, usuarioValido,
} from './cuentas.js';
import { cookieDe, crearSesion, leerSesion } from './sesiones.js';
import {
  guardarAjustes, guardarInstalacion, leerInstalacion, claveDeCifrado, normalizarRutaBase, CUOTA_BASE,
} from './instalacion.js';
import { crearCifrador, nuevaClave } from './cifrado.js';
import {
  alta, avisoPagina, entrar, instalar, panelAdmin, panelUsuario, permiso, redirigir, respuesta,
} from './paginas.js';

const CABECERAS_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match, Origin, X-Requested-With',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(res, codigo, datos, extra = {}) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, {
    ...CABECERAS_CORS, 'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo), ...extra,
  });
  res.end(cuerpo);
}

async function leerCuerpo(req, limite = 8 * 1024 * 1024) {
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > limite) throw new Error('demasiado grande');
    trozos.push(t);
  }
  return Buffer.concat(trozos);
}

const form = (cuerpo) => Object.fromEntries(new URLSearchParams(cuerpo.toString('utf8')));

/** Ruta de instalación del formulario, saneada: «remotemongo/» → «/remotemongo». */
function rutaValida(valor) {
  const v = String(valor ?? '').trim();
  if (!v || v === '/') return '';
  return normalizarRutaBase(`/${v.replace(/^\/+/, '').replace(/\/+$/, '')}`);
}

/**
 * @param {object} opciones
 * @param {object} opciones.almacen            almacén listo (memoria en las pruebas)
 * @param {object} opciones.config             {configurado, dominio, https, registroAbierto, secreto, mongoUrl, mongoDb}
 * @param {function} [opciones.conectarMongo]  async (url, db) => almacén (solo para la instalación)
 */
export function crearServidor({ almacen, config, conectarMongo = null }) {
  const codigos = new Map();
  const ajustes = {
    ...config,
    dominio: config.dominio || `localhost:${config.puerto || 8790}`,
    cuotaBase: Number(config.cuotaBase) || CUOTA_BASE,
    rutaBase: normalizarRutaBase(config.rutaBase),
  };
  const base = () => `${ajustes.https ? 'https' : 'http'}://${ajustes.dominio}`;
  /** Ruta de instalación normalizada: '' (raíz) o algo como '/remotemongo'. */
  const raiz = () => normalizarRutaBase(ajustes.rutaBase);
  /** URL interna con la ruta de instalación delante. */
  const con = (ruta) => `${raiz()}${ruta}`;

  /** Cuota que se le aplica a una cuenta: la suya si la tiene, si no la base del servidor. */
  const cuotaDe = async (usuario) => {
    const cuenta = await almacen.usuario(usuario);
    return cuenta && cuenta.cuota != null ? Number(cuenta.cuota) : ajustes.cuotaBase;
  };

  /** Datos del panel: la cuenta con todos sus almacenes y lo que ocupa cada uno. */
  async function panelDeCuenta(cuenta) {
    const nombres = ['', ...(cuenta.espacios || [])];
    const espacios = [];
    for (const e of nombres) {
      const dir = e ? `${cuenta.usuario}+${e}` : cuenta.usuario;
      const m = await almacen.resumenMetadatos(dir);
      espacios.push({
        espacio: e,
        direccion: `${dir}@${ajustes.dominio}`,
        endpoint: `${base()}${con(`/storage/${dir}/`)}`,
        apps: m.apps,
        categorias: m.categorias,
        usado: m.totalBytes,
      });
    }
    return {
      usuario: cuenta.usuario,
      rol: cuenta.rol || 'usuario',
      dominio: ajustes.dominio,
      cuota: cuenta.cuota != null ? Number(cuenta.cuota) : ajustes.cuotaBase,
      usado: espacios.reduce((s, e) => s + e.usado, 0),
      espacios,
    };
  }

  /** Usuario de la sesión, comprobado contra la base (y que siga activo). */
  async function sesionDe(req) {
    const s = leerSesion(ajustes.secreto || '', req.headers.cookie);
    if (!s) return null;
    const cuenta = await almacen.usuario(s.usuario);
    if (!cuenta || cuenta.activo === false) return null;
    return cuenta;
  }

  const soloAdmin = (u) => Boolean(u && u.rol === 'admin');
  const conCookie = (valor, extra = {}) => ({ 'Set-Cookie': valor, ...CABECERAS_CORS, ...extra });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, base());

    // La ruta de instalación se acepta con prefijo o sin él: así también funciona
    // detrás de un proxy que la quita (tailscale serve --set-path, nginx, etc.).
    const pre = raiz();
    let camino = url.pathname;
    if (pre && camino.startsWith(`${pre}/`)) camino = camino.slice(pre.length);
    else if (pre && camino === pre) camino = '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CABECERAS_CORS);
      return res.end();
    }

    try {
      /* ------------------------------------------------------------- estático */
      if (camino === '/bootstrap.min.css' || camino === '/vue.global.prod.js') {
        const { readFileSync } = await import('node:fs');
        const fichero = camino === '/bootstrap.min.css' ? 'bootstrap.min.css' : 'vue.global.prod.js';
        const tipo = camino.endsWith('.css') ? 'text/css' : 'text/javascript';
        try {
          const contenido = readFileSync(new URL(`../web/${fichero}`, import.meta.url));
          res.writeHead(200, { 'Content-Type': `${tipo}; charset=utf-8`, 'Cache-Control': 'public, max-age=86400' });
          return res.end(contenido);
        } catch {
          res.writeHead(404);
          return res.end();
        }
      }

      /* -------------------------------------------------- instalación inicial */
      if (!ajustes.configurado) {
        if (camino === '/instalar' && req.method === 'GET') {
          return respuesta(res, 200, instalar({ raiz: raiz(),
            valores: {
              mongoUrl: ajustes.mongoUrl, mongoDb: ajustes.mongoDb,
              dominio: ajustes.dominio, https: ajustes.https, rutaBase: ajustes.rutaBase,
            },
          }));
        }
        if (camino === '/instalar' && req.method === 'POST') {
          const datos = form(await leerCuerpo(req));
          const volver = (error) => respuesta(res, 400, instalar({ raiz: raiz(),
            error, valores: { ...datos, rutaBase: datos.rutaBase, https: datos.https === 'on' },
          }));
          if (!datos.mongoUrl || !datos.dominio) return volver('Faltan la ruta de MongoDB o el dominio.');
          if (!usuarioValido(datos.admin)) return volver('Usuario de administración no válido (minúsculas, 2-32 caracteres).');
          if (!datos.clave || String(datos.clave).length < 8) return volver('La contraseña debe tener al menos 8 caracteres.');
          const rutaMal = datos.rutaBase && !/^\/?[a-z0-9][a-z0-9._-]*$/i.test(String(datos.rutaBase).trim().replace(/\/$/, ''));
          if (rutaMal) return volver('La ruta de instalación solo puede llevar letras, números, guiones y puntos (por ejemplo /remotemongo).');
          if (datos.clave !== datos.clave2) return volver('Las dos contraseñas no coinciden.');
          if (!conectarMongo) return volver('Este servidor no puede conectar con MongoDB.');

          let nuevo;
          const clave = nuevaClave();
          try {
            nuevo = await conectarMongo(datos.mongoUrl, datos.mongoDb || 'remotemongo', crearCifrador(clave));
          } catch (err) {
            return volver(`No pude conectar con MongoDB: ${err.message}`);
          }
          const instalacion = guardarInstalacion({
            mongoUrl: datos.mongoUrl,
            mongoDb: datos.mongoDb || 'remotemongo',
            dominio: datos.dominio,
            https: datos.https === 'on',
            puerto: ajustes.puerto,
            claveCifrado: clave,
            rutaBase: rutaValida(datos.rutaBase),
          });
          Object.assign(ajustes, {
            configurado: true, dominio: instalacion.dominio, https: instalacion.https,
            secreto: instalacion.secreto, mongoUrl: datos.mongoUrl, mongoDb: instalacion.mongoDb,
            cifrado: true, rutaBase: instalacion.rutaBase,
          });
          almacen = nuevo;   // desde aquí todo (datos y cuentas) va contra Mongo
          const sal = crearSal();
          await almacen.crearUsuario({
            usuario: String(datos.admin).toLowerCase(), hash: hashClave(datos.clave, sal), sal, rol: 'admin',
          });
          return respuesta(res, 200, instalar({ raiz: raiz(), paso: 'hecho' }));
        }
        // sin instalar la ruta aún no se conoce: redirección relativa, que funciona
        // igual en la raíz del dominio que detrás de un montaje con prefijo
        return redirigir(res, ajustes.rutaBase ? con('/instalar') : 'instalar');
      }

      /* ------------------------------------------------------ descubrimiento */
      if (camino === '/.well-known/webfinger') {
        const recurso = url.searchParams.get('resource') || '';
        const m = /^acct:([a-z0-9._+\-\s]+)@/i.exec(recurso);
        // en la cadena de consulta un «+» sin codificar llega como espacio: se recupera
        const usuario = m ? m[1].trim().toLowerCase().replace(/\s+/g, '+') : '';
        const existe = usuario && await almacen.usuario(usuario);
        if (!existe) return json(res, 404, { error: 'no existe esa cuenta' });
        const { espacio } = partirDireccion(usuario);
        if (espacio && !(await almacen.espaciosDe(usuario)).includes(espacio)) {
          return json(res, 404, { error: 'esa cuenta no tiene ese almacén' });
        }
        return json(res, 200, {
          subject: `acct:${usuario}@${ajustes.dominio}`,
          links: [
            {
              rel: 'remoteStorage',
              href: `${base()}${con(`/storage/${usuario}/`)}`,
              properties: { 'http://remotestorage.io/spec/version': 'draft-dejong-remotestorage-22' },
            },
            { rel: 'http://tools.ietf.org/id/draft-dejong-remotestorage', href: `${base()}${con(`/oauth/${usuario}`)}`, properties: {} },
          ],
        });
      }

      /* --------------------------------------------------- permiso de una app */
      if (camino.startsWith('/oauth/') && camino !== '/oauth/token') {
        const usuario = camino.split('/')[2];
        const cuenta = usuario && await almacen.usuario(usuario);
        const { espacio: espacioPedido } = partirDireccion(usuario || '');
        const almacenOk = !espacioPedido || (await almacen.espaciosDe(usuario)).includes(espacioPedido);
        if (!cuenta || !almacenOk) {
          return respuesta(res, 404, avisoPagina({ raiz: raiz(),
            titulo: 'Esa cuenta no existe',
            texto: 'Revisa la dirección que has puesto en la app.',
            enlace: '/', boton: 'Inicio',
          }));
        }

        if (req.method === 'GET') {
          const scope = url.searchParams.get('scope') || '';
          const permisos = permisosLegibles(scope);
          if (!permisos.length) {
            return respuesta(res, 400, avisoPagina({ raiz: raiz(),
              titulo: 'Permisos no válidos',
              texto: 'La aplicación no ha pedido ningún permiso válido.',
              enlace: '/', boton: 'Inicio',
            }));
          }
          return respuesta(res, 200, permiso({ raiz: raiz(),
            usuario, scope, permisos,
            app: url.searchParams.get('client_id') || 'una aplicación',
            redirect: url.searchParams.get('redirect_uri') || '',
            estado: url.searchParams.get('state') || '',
            reto: url.searchParams.get('code_challenge') || '',
            metodo: url.searchParams.get('code_challenge_method') || '',
          }));
        }

        if (req.method === 'POST') {
          const datos = form(await leerCuerpo(req));
          if (!claveCorrecta(datos.clave || '', cuenta)) {
            return respuesta(res, 401, avisoPagina({ raiz: raiz(),
              titulo: 'Contraseña incorrecta',
              texto: 'No se ha concedido el permiso.',
              enlace: '/entrar', boton: 'Entrar',
            }));
          }
          const scopes = analizarScopes(datos.scope);
          if (!scopes.length) {
            return respuesta(res, 400, avisoPagina({ raiz: raiz(),
              titulo: 'Permisos no válidos', texto: 'No se ha concedido nada.',
              enlace: '/', boton: 'Inicio',
            }));
          }

          const destino = datos.redirect || '';
          const separador = destino.includes('#') ? '&' : '#';
          if (datos.reto) {
            const codigo = nuevoToken();
            codigos.set(codigo, { usuario, scope: datos.scope, reto: datos.reto, hasta: Date.now() + 5 * 60 * 1000 });
            const u = new URL(destino);
            u.searchParams.set('code', codigo);
            if (datos.estado) u.searchParams.set('state', datos.estado);
            return redirigir(res, u.toString());
          }
          const token = nuevoToken();
          await almacen.guardarToken({ token, usuario, scope: datos.scope, app: datos.app || 'app', caduca: null });
          const fragmento = `access_token=${encodeURIComponent(token)}`
            + `&token_type=bearer&scope=${encodeURIComponent(datos.scope)}`
            + (datos.estado ? `&state=${encodeURIComponent(datos.estado)}` : '');
          return redirigir(res, `${destino}${separador}${fragmento}`);
        }
      }

      if (camino === '/oauth/token' && req.method === 'POST') {
        const datos = form(await leerCuerpo(req));
        if (datos.grant_type !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' });
        const guardado = codigos.get(datos.code);
        if (!guardado || guardado.hasta < Date.now()) return json(res, 400, { error: 'invalid_grant' });
        if (!pkceCorrecto(datos.code_verifier, guardado.reto)) {
          return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE no cuadra' });
        }
        codigos.delete(datos.code);
        const token = nuevoToken();
        await almacen.guardarToken({
          token, usuario: guardado.usuario, scope: guardado.scope,
          app: datos.client_id || 'app', caduca: null,
        });
        return json(res, 200, { access_token: token, token_type: 'bearer', scope: guardado.scope });
      }

      /* --------------------------------------------------------------- almacén */
      if (camino.startsWith('/storage/')) {
        const resto = camino.slice('/storage/'.length);
        const barra = resto.indexOf('/');
        const usuario = decodeURIComponent(barra === -1 ? resto : resto.slice(0, barra)).toLowerCase();
        const ruta = normal(barra === -1 ? '' : resto.slice(barra + 1), camino.endsWith('/'));

        const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
        const datosToken = token ? await almacen.token(token) : null;
        if (!datosToken) return json(res, 401, { error: 'falta el token' });
        if (datosToken.usuario !== usuario) return json(res, 403, { error: 'el token no es de esa cuenta' });

        const scopes = analizarScopes(datosToken.scope);
        const escribir = req.method === 'PUT' || req.method === 'DELETE';
        if (req.method !== 'HEAD' && !permite(scopes, ruta, { escribir })) {
          return json(res, 403, { error: 'el permiso no alcanza a esa carpeta' });
        }

        const esCarpeta = camino.endsWith('/') || ruta === '';

        if (req.method === 'GET' || req.method === 'HEAD') {
          if (esCarpeta) {
            const listado = await almacen.listar(usuario, ruta);
            if (!listado) return json(res, 404, { error: 'no existe' });
            const cuerpo = {
              '@context': 'http://remotestorage.io/spec/folder-description',
              items: listado.items,
              ...(Object.keys(listado.carpetas).length ? { folders: listado.carpetas } : {}),
            };
            return json(res, 200, cuerpo, { ETag: `"${Object.keys(listado.items).length}"` });
          }
          const doc = await almacen.leer(usuario, ruta);
          if (!doc) return json(res, 404, { error: 'no existe' });
          res.writeHead(200, {
            ...CABECERAS_CORS, 'Content-Type': doc.tipo, ETag: doc.etag, 'Content-Length': doc.cuerpo.length,
          });
          return res.end(req.method === 'HEAD' ? undefined : doc.cuerpo);
        }

        if (req.method === 'PUT') {
          if (esCarpeta) return json(res, 400, { error: 'no se puede escribir en una carpeta sin nombre' });
          const cuerpo = await leerCuerpo(req);
          const cuotaMax = await cuotaDe(usuario);
          const r = await almacen.escribir(usuario, ruta, cuerpo, req.headers['content-type'], {
            ifMatch: req.headers['if-match'],
            ifNoneMatch: req.headers['if-none-match'],
            cuotaMax,
          });
          if (r.conflicto === 'existe') return json(res, 412, { error: 'ya existe' });
          if (r.conflicto === 'etag') return json(res, 412, { error: 'el ETag no cuadra' });
          if (r.conflicto === 'cuota') {
            return json(res, 413, {
              error: 'cuota de espacio superada',
              usado: r.usado, cuota: r.cuota,
              detalle: `Ocupas ${r.usado} B de ${r.cuota} B. Borra algo o pide más espacio.`,
            });
          }
          if (r.sinCambios) {
            res.writeHead(304, { ...CABECERAS_CORS, ETag: r.etag });
            return res.end();
          }
          res.writeHead(200, { ...CABECERAS_CORS, ETag: r.etag, 'Content-Length': 0 });
          return res.end();
        }

        if (req.method === 'DELETE') {
          const r = await almacen.borrar(usuario, ruta, { ifMatch: req.headers['if-match'] });
          if (r.falta) return json(res, 404, { error: 'no existe' });
          if (r.conflicto) return json(res, 412, { error: 'el ETag no cuadra' });
          res.writeHead(200, CABECERAS_CORS);
          return res.end();
        }

        return json(res, 405, { error: 'método no permitido' });
      }

      /* ----------------------------------------------------------- entrar / salir */
      if (camino === '/entrar') {
        if (req.method === 'GET') {
          return respuesta(res, 200, entrar({ raiz: raiz(),
            abierto: ajustes.registroAbierto, aviso: url.searchParams.get('aviso') || '',
          }));
        }
        const datos = form(await leerCuerpo(req));
        const cuenta = await almacen.usuario(String(datos.usuario || '').toLowerCase());
        if (!cuenta || !claveCorrecta(datos.clave || '', cuenta)) {
          return respuesta(res, 401, entrar({ raiz: raiz(), abierto: ajustes.registroAbierto, error: 'Usuario o contraseña incorrectos.' }));
        }
        if (cuenta.activo === false) {
          return respuesta(res, 403, entrar({ raiz: raiz(), abierto: ajustes.registroAbierto, error: 'Esa cuenta está desactivada.' }));
        }
        const sesion = crearSesion(ajustes.secreto, cuenta.usuario, cuenta.rol || 'usuario');
        res.writeHead(302, conCookie(cookieDe(sesion, { seguro: ajustes.https }), {
          Location: cuenta.rol === 'admin' ? con('/admin') : con('/panel'),
        }));
        return res.end();
      }

      if (camino === '/salir') {
        res.writeHead(302, conCookie(cookieDe('', { seguro: ajustes.https, borrar: true }), { Location: '/entrar' }));
        return res.end();
      }

      /* ------------------------------------------------------------ alta de cuenta */
      if (camino === '/alta') {
        if (req.method === 'GET') return respuesta(res, 200, alta({ raiz: raiz(), abierto: ajustes.registroAbierto }));
        if (!ajustes.registroAbierto) return respuesta(res, 403, alta({ raiz: raiz(), abierto: false }));
        const datos = form(await leerCuerpo(req));
        const nombre = String(datos.usuario || '').toLowerCase().trim();
        if (!usuarioValido(nombre)) return respuesta(res, 400, alta({ raiz: raiz(), abierto: true, error: 'Usuario no válido.' }));
        if (!datos.clave || String(datos.clave).length < 8) {
          return respuesta(res, 400, alta({ raiz: raiz(), abierto: true, error: 'La contraseña debe tener al menos 8 caracteres.' }));
        }
        if (await almacen.usuario(nombre)) return respuesta(res, 409, alta({ raiz: raiz(), abierto: true, error: 'Ese usuario ya existe.' }));
        const sal = crearSal();
        await almacen.crearUsuario({ usuario: nombre, hash: hashClave(datos.clave, sal), sal, rol: 'usuario' });
        const sesion = crearSesion(ajustes.secreto, nombre, 'usuario');
        res.writeHead(200, conCookie(cookieDe(sesion, { seguro: ajustes.https })));
        return res.end(alta({ raiz: raiz(),
          creada: { direccion: `${nombre}@${ajustes.dominio}`, endpoint: `${base()}${con(`/storage/${nombre}/`)}` },
        }));
      }

      /* -------------------------------------------------- datos de los paneles */
      if (camino === '/api/panel') {
        const cuenta = await sesionDe(req);
        if (!cuenta) return json(res, 401, { error: 'sin sesión' });
        return json(res, 200, await panelDeCuenta(cuenta));
      }

      if (camino === '/api/admin') {
        const cuenta = await sesionDe(req);
        if (!soloAdmin(cuenta)) return json(res, 403, { error: 'solo administración' });
        const lista = await almacen.listarUsuarios();
        const usuarios = [];
        for (const u of lista) {
          const nombres = ['', ...(u.espacios || [])];
          const espacios = [];
          let total = 0;
          const apps = [];
          for (const e of nombres) {
            const dir = e ? `${u.usuario}+${e}` : u.usuario;
            const m = await almacen.resumenMetadatos(dir);
            total += m.totalBytes;
            apps.push(...m.apps.map((a) => ({ ...a, espacio: e })));
            espacios.push({ espacio: e, usado: m.totalBytes, apps: m.apps.length });
          }
          usuarios.push({
            usuario: u.usuario, rol: u.rol, activo: u.activo,
            apps, totalBytes: total, espacios,
            cuota: u.cuota != null ? Number(u.cuota) : ajustes.cuotaBase,
            cuotaPropia: u.cuota != null,
          });
        }
        return json(res, 200, {
          usuarios,
          config: {
            registroAbierto: ajustes.registroAbierto,
            cuotaBase: ajustes.cuotaBase,
            cifrado: Boolean(ajustes.cifrado),
          },
        });
      }

      /* -------------------------------------------------------- panel de usuario */
      if (camino === '/panel') {
        const cuenta = await sesionDe(req);
        if (!cuenta) return redirigir(res, con('/entrar'));
        return respuesta(res, 200, panelUsuario({ raiz: raiz(), rol: cuenta.rol || 'usuario' }));
      }

      if (camino === '/panel/revocar' && req.method === 'POST') {
        const cuenta = await sesionDe(req);
        if (!cuenta) return redirigir(res, con('/entrar'));
        const datos = form(await leerCuerpo(req));
        await almacen.revocarToken(cuenta.usuario, datos.id || datos.token);
        return redirigir(res, con('/panel'));
      }

      if (camino === '/panel/espacio' && req.method === 'POST') {
        const cuenta = await sesionDe(req);
        if (!cuenta) return redirigir(res, con('/entrar'));
        const datos = form(await leerCuerpo(req));
        if (datos.accion === 'borrar') {
          const esp = String(datos.espacio || '').toLowerCase();
          if (esp && (cuenta.espacios || []).includes(esp)) await almacen.borrarEspacio(cuenta.usuario, esp);
          return redirigir(res, con('/panel'));
        }
        const nombre = String(datos.espacio || '').toLowerCase().trim();
        if (!espacioValido(nombre)) return redirigir(res, con('/panel?error=espacio'));
        await almacen.crearEspacio(cuenta.usuario, nombre);
        return redirigir(res, con('/panel'));
      }

      if (camino === '/panel/respaldo') {
        const cuenta = await sesionDe(req);
        if (!cuenta) return redirigir(res, con('/entrar'));
        const esp = String(url.searchParams.get('espacio') || '').toLowerCase();
        const dir = esp ? `${cuenta.usuario}+${esp}` : cuenta.usuario;
        if (esp && !(cuenta.espacios || []).includes(esp)) return json(res, 404, { error: 'no existe ese almacén' });
        const documentos = (await almacen.todoDe?.(dir)) || [];
        return json(res, 200, { usuario: dir, fecha: new Date().toISOString(), documentos }, {
          'Content-Disposition': `attachment; filename="remotemongo-${dir}.json"`,
        });
      }

      /* ----------------------------------------------------------- administración */
      if (camino.startsWith('/admin')) {
        const cuenta = await sesionDe(req);
        if (!soloAdmin(cuenta)) {
          return respuesta(res, 403, avisoPagina({ raiz: raiz(),
            titulo: 'Solo administración',
            texto: 'Esta zona es solo para la cuenta de administración.',
            enlace: '/panel', boton: 'Mi panel',
          }));
        }
        if (req.method === 'POST') {
          const datos = form(await leerCuerpo(req));
          if (camino === '/admin/revocar') {
            await almacen.revocarToken(datos.usuario, datos.id || datos.token);
            return redirigir(res, con('/admin'));
          }
          if (camino === '/admin/estado') {
            await almacen.cambiarEstado(datos.usuario, datos.activo === '1');
            return redirigir(res, con('/admin'));
          }
          if (camino === '/admin/registro') {
            ajustes.registroAbierto = datos.abierto === '1';
            guardarAjustes({ registroAbierto: ajustes.registroAbierto });
            return redirigir(res, con('/admin'));
          }
          if (camino === '/admin/cuota') {
            // En MB. Vacío o «base» = quitar la cuota propia y usar la del servidor.
            const valor = String(datos.mb || '').trim().replace(',', '.');
            if (!valor || valor.toLowerCase() === 'base') {
              await almacen.cambiarCuota(datos.usuario, null);
              return redirigir(res, con('/admin'));
            }
            const mb = Number(valor);
            if (!Number.isFinite(mb) || mb <= 0) return redirigir(res, con('/admin?error=cuota'));
            await almacen.cambiarCuota(datos.usuario, Math.round(mb * 1024 * 1024));
            return redirigir(res, con('/admin'));
          }
          if (camino === '/admin/cuota-base') {
            const mb = Number(String(datos.mb || '').trim().replace(',', '.'));
            if (!Number.isFinite(mb) || mb <= 0) return redirigir(res, con('/admin?error=cuota'));
            ajustes.cuotaBase = Math.round(mb * 1024 * 1024);
            guardarAjustes({ cuotaBase: ajustes.cuotaBase });
            return redirigir(res, con('/admin'));
          }
        }
        const lista = await almacen.listarUsuarios();
        const usuarios = [];
        for (const u of lista) {
          const m = await almacen.resumenMetadatos(u.usuario);
          usuarios.push({
            usuario: u.usuario, rol: u.rol, activo: u.activo,
            apps: m.apps, totalBytes: m.totalBytes,
            cuota: u.cuota != null ? Number(u.cuota) : ajustes.cuotaBase,
            cuotaPropia: u.cuota != null,
          });
        }
        return respuesta(res, 200, panelAdmin({ raiz: raiz(),
          error: url.searchParams.get('error') === 'cuota'
            ? 'Esa cuota no vale: pon un número de MB mayor que cero.' : '',
        }));
      }

      /* ---------------------------------------------------------------- portada */
      if (camino === '/') {
        const cuenta = await sesionDe(req);
        if (!cuenta) return redirigir(res, con('/entrar'));
        return redirigir(res, cuenta.rol === 'admin' ? con('/admin') : con('/panel'));
      }

      return json(res, 404, { error: 'ruta desconocida' });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  });
}

/* -------------------------------------------------------------- arranque real */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { MongoClient } = await import('mongodb');
  const instalacion = leerInstalacion();

  // La clave de cifrado vive en instalacion.json, nunca en MongoDB.
  const cifrador = crearCifrador(instalacion.configurado ? claveDeCifrado(instalacion) : null);

  const conectarMongo = async (url, db, propio = cifrador) => {
    const cliente = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
    await cliente.connect();
    await cliente.db(db).command({ ping: 1 });
    return AlmacenMongo.preparar(cliente.db(db), propio);
  };

  const almacen = instalacion.configurado
    ? await conectarMongo(instalacion.mongoUrl, instalacion.mongoDb)
    : await AlmacenMemoria.preparar(cifrador);

  const config = {
    configurado: instalacion.configurado,
    dominio: instalacion.dominio || `localhost:${instalacion.puerto}`,
    https: instalacion.https,
    registroAbierto: String(process.env.RM_REGISTRO || 'si') === 'si',
    secreto: instalacion.secreto || 'sin-instalar',
    mongoUrl: instalacion.mongoUrl,
    mongoDb: instalacion.mongoDb,
    puerto: instalacion.puerto,
    cuotaBase: instalacion.cuotaBase,
    cifrado: cifrador.activo,
  };

  const servidor = crearServidor({ almacen, config, conectarMongo });
  servidor.listen(config.puerto, '0.0.0.0', () => {
    console.log(`remotemongo: :${config.puerto} · ${config.configurado ? config.dominio : 'SIN INSTALAR (/instalar)'}`
      + ` · cifrado ${cifrador.activo ? 'activo' : 'INACTIVO'}`);
  });
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.on(senal, () => servidor.close(() => process.exit(0)));
  }
}
