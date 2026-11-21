/** Pruebas del protocolo contra el servidor real, con almacén en memoria. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearServidor } from '../src/server.js';
import { AlmacenMemoria, etagDe } from '../src/store.js';
import { analizarScopes, permite } from '../src/scopes.js';
import { analizarScope } from '../src/scopes.js';

const config = { dominio: 'datos.test', https: false, registroAbierto: true, adminToken: 'secreto' };

async function arrancar() {
  const almacen = await AlmacenMemoria.preparar();
  const servidor = crearServidor(almacen, config);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { servidor, almacen, base, cerrar: () => new Promise((r) => servidor.close(r)) };
}

async function cuenta(base, almacen, usuario = 'adela') {
  const r = await fetch(`${base}/alta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ usuario, clave: 'contrasena-larga' }),
  });
  assert.equal(r.status, 200, 'el alta debe funcionar');
  const html = await r.text();
  return { html, direccion: `${usuario}@${config.dominio}` };
}

async function token(almacen, usuario, scope) {
  const t = `tok-${Math.random().toString(36).slice(2)}`;
  await almacen.guardarToken({ token: t, usuario, scope, app: 'pruebas' });
  return t;
}

test('scopes: quemo:rw da lectura y escritura solo en quemo', () => {
  const s = analizarScopes('quemo:rw');
  assert.equal(permite(s, 'quemo/2026.json', { escribir: true }), true);
  assert.equal(permite(s, 'otro/2026.json', { escribir: true }), false);
  const r = analizarScopes('*:r');
  assert.equal(permite(r, 'lo-que-sea/x.json'), true);
  assert.equal(permite(r, 'lo-que-sea/x.json', { escribir: true }), false);
  assert.equal(analizarScope('malísimo'), null);
});

test('webfinger: dice dónde está el almacén de una cuenta', async () => {
  const { base, almacen, cerrar } = await arrancar();
  await cuenta(base, almacen);
  const r = await fetch(`${base}/.well-known/webfinger?resource=acct:adela@${config.dominio}`);
  assert.equal(r.status, 200);
  const datos = await r.json();
  const enlace = datos.links.find((l) => l.rel === 'remoteStorage');
  assert.ok(enlace, 'tiene que haber un enlace remoteStorage');
  assert.match(enlace.href, /\/storage\/adela\/$/);
  await cerrar();
});

test('webfinger: 404 si la cuenta no existe', async () => {
  const { base, cerrar } = await arrancar();
  const r = await fetch(`${base}/.well-known/webfinger?resource=acct:nadie@${config.dominio}`);
  assert.equal(r.status, 404);
  await cerrar();
});

test('almacén: escribir, leer, listar, borrar y ETags', async () => {
  const { base, almacen, cerrar } = await arrancar();
  await cuenta(base, almacen);
  const t = await token(almacen, 'adela', 'quemo:rw');
  const cab = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };

  // PUT
  let r = await fetch(`${base}/storage/adela/quemo/2026-11-19.json`, {
    method: 'PUT', headers: cab, body: JSON.stringify({ km: 6.88 }),
  });
  assert.equal(r.status, 200);
  const etag = r.headers.get('etag');
  assert.ok(etag, 'tiene que devolver ETag');

  // GET
  r = await fetch(`${base}/storage/adela/quemo/2026-11-19.json`, { headers: cab });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { km: 6.88 });
  assert.equal(r.headers.get('etag'), etag);

  // PUT con If-Match viejo → 412
  r = await fetch(`${base}/storage/adela/quemo/2026-11-19.json`, {
    method: 'PUT', headers: { ...cab, 'If-Match': '"otro"' }, body: '{}',
  });
  assert.equal(r.status, 412);

  // listado de carpeta
  r = await fetch(`${base}/storage/adela/quemo/`, { headers: cab });
  assert.equal(r.status, 200);
  const listado = await r.json();
  assert.deepEqual(Object.keys(listado.items), ['2026-11-19.json']);
  assert.equal(listado.items['2026-11-19.json'].ETag, etag);

  // DELETE
  r = await fetch(`${base}/storage/adela/quemo/2026-11-19.json`, { method: 'DELETE', headers: cab });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/storage/adela/quemo/2026-11-19.json`, { headers: cab });
  assert.equal(r.status, 404);
  await cerrar();
});

test('permisos: el token de una app no sale de su carpeta', async () => {
  const { base, almacen, cerrar } = await arrancar();
  await cuenta(base, almacen);
  const t = await token(almacen, 'adela', 'quemo:rw');
  const r = await fetch(`${base}/storage/adela/secreto/x.json`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}` }, body: 'hola',
  });
  assert.equal(r.status, 403);
  // y sin token, 401
  const sin = await fetch(`${base}/storage/adela/quemo/x.json`);
  assert.equal(sin.status, 401);
  await cerrar();
});

test('oauth PKCE: permiso → código → token que funciona', async () => {
  const { base, almacen, cerrar } = await arrancar();
  await cuenta(base, almacen);
  const verifier = 'verificador-de-prueba-1234567890';
  const { createHash } = await import('node:crypto');
  const reto = createHash('sha256').update(verifier).digest('base64url');
  const destino = 'https://app.test/callback';

  const r = await fetch(`${base}/oauth/adela`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      clave: 'contrasena-larga', scope: 'quemo:rw', redirect: destino,
      estado: 'abc', reto, metodo: 'S256', app: 'quemo',
    }),
    redirect: 'manual',
  });
  assert.equal(r.status, 302);
  const codigo = new URL(r.headers.get('location')).searchParams.get('code');
  assert.ok(codigo, 'tiene que volver un código');

  const intercambio = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: codigo, code_verifier: verifier }),
  });
  assert.equal(intercambio.status, 200);
  const { access_token: tokenFinal, scope } = await intercambio.json();
  assert.equal(scope, 'quemo:rw');

  const uso = await fetch(`${base}/storage/adela/quemo/nota.txt`, {
    method: 'PUT', headers: { Authorization: `Bearer ${tokenFinal}` }, body: 'con el token nuevo',
  });
  assert.equal(uso.status, 200);

  // el mismo código no vale dos veces
  const repetido = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: codigo, code_verifier: verifier }),
  });
  assert.equal(repetido.status, 400);
  await cerrar();
});

test('etag estable: mismo contenido, mismo ETag', () => {
  assert.equal(etagDe(Buffer.from('hola')), etagDe(Buffer.from('hola')));
  assert.notEqual(etagDe(Buffer.from('hola')), etagDe(Buffer.from('hola ')));
});
