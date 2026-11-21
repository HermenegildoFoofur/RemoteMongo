/** Cifrado en reposo y tokens sin guardar en claro. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearCifrador, nuevaClave } from '../src/cifrado.js';
import { AlmacenMemoria } from '../src/store.js';
import { crearServidor } from '../src/servidor.js';
import { crearSal, hashClave } from '../src/cuentas.js';

const config = {
  configurado: true, dominio: 'datos.test', https: false, registroAbierto: true,
  secreto: 'secreto-de-pruebas', cifrado: true,
};

const formulario = (campos) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(campos),
});

const SECRETO = 'RECORRIDO-PRIVADO-DE-ADELA';

test('cifrador: ida y vuelta, y lo guardado no lleva el texto dentro', () => {
  const c = crearCifrador(nuevaClave());
  assert.equal(c.activo, true);
  const guardado = c.cifrar(Buffer.from(SECRETO));
  assert.ok(!guardado.toString('latin1').includes(SECRETO), 'el texto no puede aparecer en claro');
  assert.equal(guardado[0], 1, 'versión del formato');
  assert.equal(c.descifrar(guardado).toString(), SECRETO);
  assert.equal(c.descifrar(Buffer.from(SECRETO)).toString(), SECRETO, 'lo no cifrado se devuelve tal cual');
});

test('cifrador: dos escrituras iguales dan bytes distintos (IV nuevo)', () => {
  const c = crearCifrador(nuevaClave());
  const a = c.cifrar(Buffer.from(SECRETO));
  const b = c.cifrar(Buffer.from(SECRETO));
  assert.notEqual(a.toString('base64'), b.toString('base64'));
  assert.equal(c.descifrar(a).toString(), c.descifrar(b).toString());
});

test('cifrador: manipular el guardado se detecta', () => {
  const c = crearCifrador(nuevaClave());
  const guardado = c.cifrar(Buffer.from(SECRETO));
  guardado[guardado.length - 1] ^= 0xff;
  assert.throws(() => c.descifrar(guardado));
});

test('cifrador: otra clave no descifra', () => {
  const a = crearCifrador(nuevaClave());
  const b = crearCifrador(nuevaClave());
  assert.throws(() => b.descifrar(a.cifrar(Buffer.from(SECRETO))));
});

test('cifrador: clave de tamaño equivocado se rechaza al arrancar', () => {
  assert.throws(() => crearCifrador(Buffer.alloc(16).toString('base64')), /32 bytes/);
});

test('almacén: lo guardado está cifrado y se lee en claro (también el respaldo)', async () => {
  const almacen = await AlmacenMemoria.preparar(crearCifrador(nuevaClave()));
  await almacen.escribir('adela', 'quemo/a.json', Buffer.from(SECRETO), 'application/json');

  const guardado = [...almacen.docs.values()][0].cuerpo;
  assert.ok(!guardado.toString('latin1').includes(SECRETO), 'en el almacén no puede estar el texto');
  assert.equal(guardado[0], 1);

  const leido = await almacen.leer('adela', 'quemo/a.json');
  assert.equal(leido.cuerpo.toString(), SECRETO);

  const copia = await almacen.todoDe('adela');
  assert.equal(Buffer.from(copia[0].contenido, 'base64').toString(), SECRETO, 'el respaldo va en claro');
});

test('tokens: solo se guarda la huella, nunca el token', async () => {
  const almacen = await AlmacenMemoria.preparar();
  const id = await almacen.guardarToken({ token: 'token-de-la-app', usuario: 'adela', scope: 'quemo:rw', app: 'quemo' });

  const guardado = [...almacen.tokens.values()][0];
  assert.equal(guardado.token, undefined, 'el token en claro no se guarda');
  assert.match(guardado.huella, /^[0-9a-f]{64}$/);

  assert.ok(await almacen.token('token-de-la-app'), 'el token sigue sirviendo para entrar');

  const lista = await almacen.listarTokens('adela');
  assert.equal(lista[0].token, undefined);
  assert.equal(lista[0].id, id);

  assert.equal(await almacen.revocarToken('adela', id), true);
  assert.equal(await almacen.token('token-de-la-app'), null);
});

test('web con cifrado: escribir, leer y descargar la copia', async () => {
  const almacen = await AlmacenMemoria.preparar(crearCifrador(nuevaClave()));
  const servidor = crearServidor({ almacen, config });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const alta = await fetch(`${base}/alta`, formulario({ usuario: 'adela', clave: 'contrasena-larga' }));
  const cookie = (alta.headers.get('set-cookie') || '').split(';')[0];

  await almacen.guardarToken({ token: 'tok1', usuario: 'adela', scope: 'quemo:rw', app: 'quemo' });

  const puesto = await fetch(`${base}/storage/adela/quemo/a.json`, {
    method: 'PUT', headers: { Authorization: 'Bearer tok1' }, body: SECRETO,
  });
  assert.equal(puesto.status, 200);

  const leido = await fetch(`${base}/storage/adela/quemo/a.json`, { headers: { Authorization: 'Bearer tok1' } });
  assert.equal(await leido.text(), SECRETO);

  const copia = await (await fetch(`${base}/panel/respaldo`, { headers: { cookie } })).json();
  assert.equal(Buffer.from(copia.documentos[0].contenido, 'base64').toString(), SECRETO);

  await new Promise((r) => servidor.close(r));
});

test('el panel de administración dice si el cifrado está activo', async () => {
  const almacen = await AlmacenMemoria.preparar(crearCifrador(nuevaClave()));
  const servidor = crearServidor({ almacen, config });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const sal = crearSal();
  await almacen.crearUsuario({ usuario: 'jefa', hash: hashClave('clave-de-jefa', sal), sal, rol: 'admin' });
  const entrada = await fetch(`${base}/entrar`, { ...formulario({ usuario: 'jefa', clave: 'clave-de-jefa' }), redirect: 'manual' });
  const cookie = (entrada.headers.get('set-cookie') || '').split(';')[0];

  const html = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
  assert.match(html, /Cifrado en reposo/);
  assert.match(html, /AES-256-GCM/);
  assert.match(html, /fuera de la base/);
  const api = await (await fetch(`${base}/api/admin`, { headers: { cookie } })).json();
  assert.equal(api.config.cifrado, true, 'la API dice que el cifrado está activo');

  await new Promise((r) => servidor.close(r));
});