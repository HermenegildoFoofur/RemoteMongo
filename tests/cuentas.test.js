/** Instalación, entrada, panel de usuario y administración (sin ver datos ajenos). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearServidor } from '../src/servidor.js';
import { AlmacenMemoria } from '../src/store.js';
import { crearSal, hashClave } from '../src/cuentas.js';

const configBase = {
  configurado: true, dominio: 'datos.test', https: false, registroAbierto: true, secreto: 'secreto-de-pruebas',
};

async function arrancar(config = configBase) {
  const almacen = await AlmacenMemoria.preparar();
  const servidor = crearServidor({ almacen, config: { ...config } });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { base, almacen, cerrar: () => new Promise((r) => servidor.close(r)) };
}

const formulario = (campos) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(campos),
});

async function crearCuenta(base, usuario, clave = 'contrasena-larga', rol = 'usuario') {
  const r = await fetch(`${base}/alta`, formulario({ usuario, clave }));
  const cookie = r.headers.get('set-cookie') || '';
  return { r, cookie: cookie.split(';')[0] };
}

async function entrar(base, usuario, clave = 'contrasena-larga') {
  const r = await fetch(`${base}/entrar`, { ...formulario({ usuario, clave }), redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { r, cookie };
}

test('sin instalar, todo lleva al asistente', async () => {
  const { base, cerrar } = await arrancar({ ...configBase, configurado: false });
  const raiz = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(raiz.status, 302);
  assert.equal(raiz.headers.get('location'), '/instalar');
  const asistente = await fetch(`${base}/instalar`);
  const html = await asistente.text();
  assert.match(html, /Primera configuración/);
  assert.match(html, /mongoUrl/);
  assert.match(html, /admin/);
  await cerrar();
});

test('alta + entrar: la sesión lleva al panel con su dirección', async () => {
  const { base, cerrar } = await arrancar();
  const { r, cookie } = await crearCuenta(base, 'adela');
  assert.equal(r.status, 200);
  const altaHtml = await r.text();
  assert.match(altaHtml, /adela@datos\.test/);
  assert.match(altaHtml, /\/storage\/adela\//);

  const panel = await fetch(`${base}/panel`, { headers: { cookie } });
  assert.equal(panel.status, 200);
  const html = await panel.text();
  assert.match(html, /Hola, adela/);
  assert.match(html, /adela@datos\.test/);

  const sinSesion = await fetch(`${base}/panel`, { redirect: 'manual' });
  assert.equal(sinSesion.status, 302);
  await cerrar();
});

test('contraseña mala no entra', async () => {
  const { base, cerrar } = await arrancar();
  await crearCuenta(base, 'adela');
  const { r } = await entrar(base, 'adela', 'otra-cosa-larga');
  assert.equal(r.status, 401);
  await cerrar();
});

test('el panel de admin ve apps y espacio, pero NO el contenido', async () => {
  const { base, almacen, cerrar } = await arrancar();

  // una cuenta normal (por la web) y un admin creado a mano
  await crearCuenta(base, 'adela', 'contrasena-larga');
  const sal = crearSal();
  await almacen.crearUsuario({ usuario: 'jefa', hash: hashClave('clave-de-jefa', sal), sal, rol: 'admin' });

  // adela guarda algo con un token de su app
  const token = 'token-de-la-app';
  await almacen.guardarToken({ token, usuario: 'adela', scope: 'quemo:rw', app: 'quemo' });
  const puesto = await fetch(`${base}/storage/adela/quemo/recorrido.json`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: 'SECRETO-QUE-NO-DEBE-VERSE',
  });
  assert.equal(puesto.status, 200);

  const { cookie } = await entrar(base, 'jefa', 'clave-de-jefa');
  const panel = await fetch(`${base}/admin`, { headers: { cookie } });
  assert.equal(panel.status, 200);
  const html = await panel.text();

  // metadatos sí
  assert.match(html, /adela/);
  assert.match(html, /quemo/);
  assert.match(html, /kB|B</, 'tiene que enseñar el espacio ocupado');
  // contenido no
  assert.doesNotMatch(html, /SECRETO-QUE-NO-DEBE-VERSE/);
  // y no hay ruta para leer datos ajenos
  const intento = await fetch(`${base}/storage/adela/quemo/recorrido.json`, { headers: { cookie } });
  assert.equal(intento.status, 401, 'la sesión de la web no sirve para leer el almacén');

  await cerrar();
});

test('el admin puede desconectar una app de otra cuenta', async () => {
  const { base, almacen, cerrar } = await arrancar();
  await crearCuenta(base, 'adela', 'contrasena-larga');
  const sal = crearSal();
  await almacen.crearUsuario({ usuario: 'jefa', hash: hashClave('clave-de-jefa', sal), sal, rol: 'admin' });
  await almacen.guardarToken({ token: 'tok1', usuario: 'adela', scope: 'quemo:rw', app: 'quemo' });
  const [{ id }] = await almacen.listarTokens('adela');

  const { cookie } = await entrar(base, 'jefa', 'clave-de-jefa');
  const r = await fetch(`${base}/admin/revocar`, {
    ...formulario({ usuario: 'adela', id }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    redirect: 'manual',
  });
  assert.equal(r.status, 302);
  assert.equal(await almacen.token('tok1'), null, 'el token tiene que quedar revocado');

  // y sin token, el almacén ya no responde
  const lectura = await fetch(`${base}/storage/adela/quemo/x.json`, { headers: { Authorization: 'Bearer tok1' } });
  assert.equal(lectura.status, 401);
  await cerrar();
});

test('un usuario normal no entra en /admin', async () => {
  const { base, cerrar } = await arrancar();
  const { cookie } = await crearCuenta(base, 'adela');
  const r = await fetch(`${base}/admin`, { headers: { cookie } });
  assert.equal(r.status, 403);
  await cerrar();
});

test('respaldo: cada uno se descarga solo lo suyo', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const { cookie } = await crearCuenta(base, 'adela');
  const token = 'tok-adela';
  await almacen.guardarToken({ token, usuario: 'adela', scope: 'quemo:rw', app: 'quemo' });
  await fetch(`${base}/storage/adela/quemo/a.json`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: '{"km":1}',
  });

  const r = await fetch(`${base}/panel/respaldo`, { headers: { cookie } });
  assert.equal(r.status, 200);
  const datos = await r.json();
  assert.equal(datos.usuario, 'adela');
  assert.equal(datos.documentos.length, 1);
  assert.equal(datos.documentos[0].path, 'quemo/a.json');
  assert.equal(Buffer.from(datos.documentos[0].contenido, 'base64').toString(), '{"km":1}');
  await cerrar();
});
