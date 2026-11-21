/** Cuotas de espacio: la base del servidor y la propia de cada cuenta. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearServidor } from '../src/servidor.js';
import { AlmacenMemoria } from '../src/store.js';
import { crearSal, hashClave } from '../src/cuentas.js';

const CUOTA = 100;   // 100 bytes, para no escribir ficheros grandes en las pruebas
const configBase = {
  configurado: true, dominio: 'datos.test', https: false, registroAbierto: true,
  secreto: 'secreto-de-pruebas', cuotaBase: CUOTA,
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

async function cuentaConToken(base, almacen, usuario = 'adela', scope = '*:rw') {
  await fetch(`${base}/alta`, formulario({ usuario, clave: 'contrasena-larga' }));
  const token = `tok-${usuario}`;
  await almacen.guardarToken({ token, usuario, scope, app: 'pruebas' });
  return token;
}

const poner = (base, token, ruta, cuerpo) => fetch(`${base}/storage/adela/${ruta}`, {
  method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: cuerpo,
});

async function admin(base, almacen) {
  const sal = crearSal();
  await almacen.crearUsuario({ usuario: 'jefa', hash: hashClave('clave-de-jefa', sal), sal, rol: 'admin' });
  const r = await fetch(`${base}/entrar`, { ...formulario({ usuario: 'jefa', clave: 'clave-de-jefa' }), redirect: 'manual' });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

test('cuota base: se puede llenar hasta el límite y no más', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const token = await cuentaConToken(base, almacen);

  assert.equal((await poner(base, token, 'quemo/a.json', 'x'.repeat(60))).status, 200);
  assert.equal((await poner(base, token, 'quemo/b.json', 'x'.repeat(40))).status, 200, '60 + 40 = 100, justo en el tope');

  const pasada = await poner(base, token, 'quemo/c.json', 'x'.repeat(1));
  assert.equal(pasada.status, 413, 'un byte más no cabe');
  const aviso = await pasada.json();
  assert.equal(aviso.error, 'cuota de espacio superada');
  assert.equal(aviso.usado, 100);
  assert.equal(aviso.cuota, CUOTA);
  assert.match(aviso.detalle, /100 B de 100 B/);
  await cerrar();
});

test('cuota: reescribir un documento no cuenta doble, y borrar libera', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const token = await cuentaConToken(base, almacen);

  assert.equal((await poner(base, token, 'quemo/a.json', 'x'.repeat(80))).status, 200);
  // mismo documento, mismo tamaño → sigue cabiendo
  assert.equal((await poner(base, token, 'quemo/a.json', 'y'.repeat(80))).status, 200);
  // encogerlo libera sitio para otro
  assert.equal((await poner(base, token, 'quemo/a.json', 'y'.repeat(30))).status, 200);
  assert.equal((await poner(base, token, 'quemo/b.json', 'x'.repeat(60))).status, 200);

  await fetch(`${base}/storage/adela/quemo/b.json`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await poner(base, token, 'quemo/c.json', 'x'.repeat(90))).status, 413, 'a.json sigue ocupando 30');
  assert.equal((await poner(base, token, 'quemo/c.json', 'x'.repeat(60))).status, 200, 'tras borrar b hay sitio');
  await cerrar();
});

test('cuota propia: la pone el admin en MB y el usuario ve su tope', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const token = await cuentaConToken(base, almacen);
  const cookie = await admin(base, almacen);

  // con la cuota base de 100 B, el panel del usuario ya la enseña
  const { cookie: cookieAdela } = await (async () => {
    const r = await fetch(`${base}/entrar`, { ...formulario({ usuario: 'adela', clave: 'contrasena-larga' }), redirect: 'manual' });
    return { cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  })();
  let panel = await (await fetch(`${base}/panel`, { headers: { cookie: cookieAdela } })).text();
  assert.match(panel, /de <strong>100 B<\/strong>/);
  assert.match(panel, /Te quedan/);

  // el admin le da 2 MB
  const r = await fetch(`${base}/admin/cuota`, {
    ...formulario({ usuario: 'adela', mb: '2' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    redirect: 'manual',
  });
  assert.equal(r.status, 302);
  assert.equal((await almacen.usuario('adela')).cuota, 2 * 1024 * 1024);

  // ya cabe lo que antes no cabía
  assert.equal((await poner(base, token, 'quemo/grande.json', 'x'.repeat(5000))).status, 200);

  panel = await (await fetch(`${base}/panel`, { headers: { cookie: cookieAdela } })).text();
  assert.match(panel, /de <strong>2\.00 MB<\/strong>/);

  // y el admin ve el reparto
  const adminHtml = await (await fetch(`${base}/admin`, { headers: { cookie } })).text();
  assert.match(adminHtml, /cuota propia/);
  assert.match(adminHtml, /4\.9 kB de 2\.00 MB/);
  await cerrar();
});

test('cuota: vaciar el campo devuelve la cuenta a la cuota del servidor', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const token = await cuentaConToken(base, almacen);
  const cookie = await admin(base, almacen);
  const cabeceras = { 'Content-Type': 'application/x-www-form-urlencoded', cookie };

  await fetch(`${base}/admin/cuota`, { ...formulario({ usuario: 'adela', mb: '5' }), headers: cabeceras, redirect: 'manual' });
  assert.equal((await almacen.usuario('adela')).cuota, 5 * 1024 * 1024);
  assert.equal((await poner(base, token, 'quemo/a.json', 'x'.repeat(90))).status, 200);

  await fetch(`${base}/admin/cuota`, { ...formulario({ usuario: 'adela', mb: '' }), headers: cabeceras, redirect: 'manual' });
  assert.equal((await almacen.usuario('adela')).cuota, undefined, 'vuelve a la base');
  const r = await poner(base, token, 'quemo/b.json', 'x'.repeat(20));
  assert.equal(r.status, 413, 'con 100 B de base, 90 + 20 no cabe');
  await cerrar();
});

test('cuota: la cuota base se cambia desde /admin y no borra nada', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const token = await cuentaConToken(base, almacen);
  const cookie = await admin(base, almacen);
  const cabeceras = { 'Content-Type': 'application/x-www-form-urlencoded', cookie };

  assert.equal((await poner(base, token, 'quemo/a.json', 'x'.repeat(90))).status, 200);
  await fetch(`${base}/admin/cuota-base`, { ...formulario({ mb: '0.0001' }), headers: cabeceras, redirect: 'manual' });
  // 0.0001 MB ≈ 104 B: 90 B siguen ahí y caben 14 más, pero no 20
  assert.equal((await poner(base, token, 'quemo/b.json', 'x'.repeat(5))).status, 200);
  assert.equal((await poner(base, token, 'quemo/c.json', 'x'.repeat(50))).status, 413);
  // lo guardado sigue guardado
  const leido = await fetch(`${base}/storage/adela/quemo/a.json`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(leido.status, 200);
  await cerrar();
});

test('cuota: un valor absurdo no se acepta', async () => {
  const { base, almacen, cerrar } = await arrancar();
  await cuentaConToken(base, almacen);
  const cookie = await admin(base, almacen);
  const cabeceras = { 'Content-Type': 'application/x-www-form-urlencoded', cookie };

  const r = await fetch(`${base}/admin/cuota-base`, { ...formulario({ mb: '-3' }), headers: cabeceras, redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/admin?error=cuota');
  const html = await (await fetch(`${base}/admin?error=cuota`, { headers: { cookie } })).text();
  assert.match(html, /Esa cuota no vale/);
  await cerrar();
});
