/** RemoteMongo — servidor remoteStorage sobre MongoDB.
 *
 *  Rutas:
 *    GET  /.well-known/webfinger?resource=acct:<usuario>@<dominio>   descubrimiento
 *    GET  /oauth/<usuario>                                          pantalla de permiso
 *    POST /oauth/<usuario>                                          aprobar → código o token
 *    POST /oauth/token                                              canje PKCE
 *    GET|PUT|DELETE|HEAD /storage/<usuario>/<ruta>                  almacén
 *    GET  /                        portada
 *    GET|POST /alta                crear cuenta
 *    GET  /panel?token=…           administración (usuarios, uso, tokens)
 *    GET  /respaldo/<usuario>?token=…  exportar todo en JSON
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { config as configPorDefecto } from './config.js';
import { AlmacenMongo, normal } from './store.js';
import { analizarScopes, permite } from './scopes.js';
import {
  claveCorrecta, crearSal, hashClave, nuevoToken, permisosLegibles, pkceCorrecto, usuarioValido,
} from './cuentas.js';
import { portada, alta, panel, permiso, respuesta } from './paginas.js';

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

/** Servidor listo para escuchar. `almacen` se inyecta para poder probarlo en memoria. */
export function crearServidor(almacen, config = configPorDefecto) {
  // Códigos de autorización en memoria: viven 5 minutos y solo sirven una vez.
  const codigos = new Map();

  const base = () => `${config.https ? 'https' : 'http'}://${config.dominio}`;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, base());

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CABECERAS_CORS);
      return res.end();
    }

    try {
      /* ------------------------------------------------------- descubrimiento */
      if (url.pathname === '/.well-known/webfinger') {
        const recurso = url.searchParams.get('resource') || '';
        const m = /^acct:([a-z0-9._-]+)@/i.exec(recurso);
        const usuario = m ? m[1].toLowerCase() : '';
        const existe = usuario && await almacen.usuario(usuario);
        if (!existe) return json(res, 404, { error: 'no existe esa cuenta' });
        return json(res, 200, {
          subject: `acct:${usuario}@${config.dominio}`,
          links: [
            {
              rel: 'remoteStorage',
              href: `${base()}/storage/${usuario}/`,
              properties: { 'http://remotestorage.io/spec/version': 'draft-dejong-remotestorage-22' },
            },
            { rel: 'http://tools.ietf.org/id/draft-dejong-remotestorage', href: `${base()}/oauth/${usuario}`, properties: {} },
          ],
        });
      }

      /* -------------------------------------------------------- página de permiso */
      if (url.pathname.startsWith('/oauth/') && url.pathname !== '/oauth/token') {
        const usuario = url.pathname.split('/')[2];
        const cuenta = usuario && await almacen.usuario(usuario);
        if (!cuenta) return respuesta(res, 404, 'Esa cuenta no existe.');

        if (req.method === 'GET') {
          const scope = url.searchParams.get('scope') || '';
          const permisos = permisosLegibles(scope);
          if (!permisos.length) return respuesta(res, 400, 'La aplicación no ha pedido ningún permiso válido.');
          return respuesta(res, 200, permiso({
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
            return respuesta(res, 401, 'Contraseña incorrecta. Vuelve a intentarlo.');
          }
          const scopes = analizarScopes(datos.scope);
          if (!scopes.length) return respuesta(res, 400, 'Permisos no válidos.');

          const destino = datos.redirect || '';
          const separador = destino.includes('#') ? '&' : '#';
          if (datos.reto) {
            // PKCE: se devuelve un código de un solo uso que la app canjea por el token
            const codigo = nuevoToken();
            codigos.set(codigo, {
              usuario, scope: datos.scope, reto: datos.reto, hasta: Date.now() + 5 * 60 * 1000,
            });
            const u = new URL(destino);
            u.searchParams.set('code', codigo);
            if (datos.estado) u.searchParams.set('state', datos.estado);
            res.writeHead(302, { Location: u.toString(), ...CABECERAS_CORS });
            return res.end();
          }
          // flujo clásico: el token viaja en el fragmento de la URL
          const token = nuevoToken();
          await almacen.guardarToken({
            token, usuario, scope: datos.scope, app: datos.app || 'app',
            caduca: null,
          });
          const fragmento = `access_token=${encodeURIComponent(token)}`
            + `&token_type=bearer&scope=${encodeURIComponent(datos.scope)}`
            + (datos.estado ? `&state=${encodeURIComponent(datos.estado)}` : '');
          res.writeHead(302, { Location: `${destino}${separador}${fragmento}`, ...CABECERAS_CORS });
          return res.end();
        }
      }

      /* --------------------------------------------------------------- canje PKCE */
      if (url.pathname === '/oauth/token' && req.method === 'POST') {
        const datos = form(await leerCuerpo(req));
        if (datos.grant_type !== 'authorization_code') {
          return json(res, 400, { error: 'unsupported_grant_type' });
        }
        const guardado = codigos.get(datos.code);
        if (!guardado || guardado.hasta < Date.now()) {
          return json(res, 400, { error: 'invalid_grant' });
        }
        if (!pkceCorrecto(datos.code_verifier, guardado.reto)) {
          return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE no cuadra' });
        }
        codigos.delete(datos.code);
        const token = nuevoToken();
        await almacen.guardarToken({
          token, usuario: guardado.usuario, scope: guardado.scope,
          app: datos.client_id || 'app', caduca: null,
        });
        return json(res, 200, {
          access_token: token, token_type: 'bearer', scope: guardado.scope,
        });
      }

      /* ----------------------------------------------------------------- almacén */
      if (url.pathname.startsWith('/storage/')) {
        const resto = url.pathname.slice('/storage/'.length);
        const barra = resto.indexOf('/');
        const usuario = decodeURIComponent(barra === -1 ? resto : resto.slice(0, barra)).toLowerCase();
        const ruta = normal(barra === -1 ? '' : resto.slice(barra + 1), url.pathname.endsWith('/'));

        const autorizacion = req.headers.authorization || '';
        const token = /^Bearer\s+(.+)$/i.exec(autorizacion)?.[1];
        const datosToken = token ? await almacen.token(token) : null;
        if (!datosToken) return json(res, 401, { error: 'falta el token' });
        if (datosToken.usuario !== usuario) return json(res, 403, { error: 'el token no es de esa cuenta' });

        const scopes = analizarScopes(datosToken.scope);
        const escribir = req.method === 'PUT' || req.method === 'DELETE';
        if (req.method !== 'HEAD' && !permite(scopes, ruta, { escribir })) {
          return json(res, 403, { error: 'el permiso no alcanza a esa carpeta' });
        }

        const esCarpeta = url.pathname.endsWith('/') || ruta === '';

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
            ...CABECERAS_CORS,
            'Content-Type': doc.tipo,
            ETag: doc.etag,
            'Content-Length': doc.cuerpo.length,
          });
          return res.end(req.method === 'HEAD' ? undefined : doc.cuerpo);
        }

        if (req.method === 'PUT') {
          if (esCarpeta) return json(res, 400, { error: 'no se puede escribir en una carpeta sin nombre' });
          const cuerpo = await leerCuerpo(req);
          const r = await almacen.escribir(usuario, ruta, cuerpo, req.headers['content-type'], {
            ifMatch: req.headers['if-match'],
            ifNoneMatch: req.headers['if-none-match'],
          });
          if (r.conflicto === 'existe') return json(res, 412, { error: 'ya existe' });
          if (r.conflicto === 'etag') return json(res, 412, { error: 'el ETag no cuadra' });
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

      /* ------------------------------------------------------------- estáticos */
      if (url.pathname === '/bootstrap.min.css') {
        const { readFileSync } = await import('node:fs');
        try {
          const css = readFileSync(new URL('../web/bootstrap.min.css', import.meta.url));
          res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
          return res.end(css);
        } catch {
          res.writeHead(404, CABECERAS_CORS);
          return res.end();
        }
      }

      /* ------------------------------------------------------------- cuentas y web */
      if (url.pathname === '/') return respuesta(res, 200, portada(config));

      if (url.pathname === '/alta') {
        if (req.method === 'GET') {
          return respuesta(res, 200, alta({ abierto: config.registroAbierto }));
        }
        if (!config.registroAbierto) return respuesta(res, 403, 'El registro está cerrado en este servidor.');
        const datos = form(await leerCuerpo(req));
        const nombre = String(datos.usuario || '').toLowerCase().trim();
        if (!usuarioValido(nombre)) {
          return respuesta(res, 400, 'Usuario no válido: de 2 a 32 caracteres, minúsculas, números, punto, guion o guion bajo.');
        }
        if (!datos.clave || String(datos.clave).length < 8) {
          return respuesta(res, 400, 'La contraseña debe tener al menos 8 caracteres.');
        }
        if (await almacen.usuario(nombre)) return respuesta(res, 409, 'Ese usuario ya existe.');
        const sal = crearSal();
        await almacen.crearUsuario({ usuario: nombre, hash: hashClave(datos.clave, sal), sal });
        return respuesta(res, 200, alta({
          abierto: false,
          creada: { usuario: nombre, direccion: `${nombre}@${config.dominio}`, endpoint: `${base()}/storage/${nombre}/` },
        }));
      }

      if (url.pathname === '/panel') {
        if (!config.adminToken || url.searchParams.get('token') !== config.adminToken) {
          return respuesta(res, 401, 'Hace falta el token de administración.');
        }
        if (req.method === 'POST') {
          const datos = form(await leerCuerpo(req));
          if (datos.accion === 'revocar') {
            await almacen.revocarToken(datos.usuario, datos.token);
          }
          res.writeHead(302, { Location: `/panel?token=${encodeURIComponent(config.adminToken)}`, ...CABECERAS_CORS });
          return res.end();
        }
        const usuarios = [];
        for (const u of await almacen.usuariosTodos?.() || []) usuarios.push(u);
        return respuesta(res, 200, panel({ usuarios, config }));
      }

      if (url.pathname.startsWith('/respaldo/')) {
        const usuario = url.pathname.split('/')[2];
        if (!config.adminToken || url.searchParams.get('token') !== config.adminToken) {
          return json(res, 401, { error: 'hace falta el token de administración' });
        }
        const volcado = await almacen.todoDe?.(usuario);
        if (!volcado) return json(res, 404, { error: 'sin datos' });
        return json(res, 200, { usuario, documentos: volcado }, {
          'Content-Disposition': `attachment; filename="remotemongo-${usuario}.json"`,
        });
      }

      return json(res, 404, { error: 'ruta desconocida' });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  });
}

/* Arranque real (el servidor de pruebas usa crearServidor con memoria). */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { MongoClient } = await import('mongodb');
  const cliente = new MongoClient(configPorDefecto.mongoUrl);
  await cliente.connect();
  const almacen = await AlmacenMongo.preparar(cliente.db(configPorDefecto.mongoDb));
  const servidor = crearServidor(almacen, configPorDefecto);
  servidor.listen(configPorDefecto.puerto, '0.0.0.0', () => {
    console.log(`remotemongo: escuchando en :${configPorDefecto.puerto} (${configPorDefecto.dominio})`);
  });
  for (const senal of ['SIGTERM', 'SIGINT']) {
    process.on(senal, () => servidor.close(() => cliente.close().then(() => process.exit(0))));
  }
}

export { randomBytes };
