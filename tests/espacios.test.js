/** Varios almacenes por cuenta: «adela+trabajo@dominio» es otro mundo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { crearServidor } from '../src/servidor.js';
import { AlmacenMemoria } from '../src/store.js';
import { crearSal, hashClave } from '../src/cuentas.js';

const config = {
  configurado: true, dominio: 'datos.test', https: false, registroAbierto: true,
  secreto: 'secreto-de-pruebas', cuotaBase: 1000,
};

const formulario = (campos) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(campos),
});

async function arrancar() {
  const almacen = await AlmacenMemoria.preparar();
  const servidor = crearServidor({ almacen, config: { ...config } });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return { base, almacen, cerrar: () => new Promise((r) => servidor.close(r)) };
}

async function alta(base, usuario = 'adela') {
  const r = await fetch(`${base}/alta`, formulario({ usuario, clave: 'contrasena-larga' }));
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

const tok = (almacen, usuario, scope = 'quemo:rw') =>
  almacen.guardarToken({ token: `tok-${usuario}-${scope}`, usuario, scope, app: 'quemo' })
    .then(() => `tok-${usuario}-${scope}`);

test('webfinger: el «+» entrega otro almacén y solo si existe', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const cookie = await alta(base);

  // sin crear nada: el almacén por defecto responde y «trabajo» no
  let wf = await (await fetch(`${base}/.well-known/webfinger?resource=acct:adela@datos.test`)).json();
  assert.match(wf.links.find((l) => l.rel === 'remoteStorage').href, /\/storage\/adela\/$/);
  let no = await fetch(`${base}/.well-known/webfinger?resource=acct:adela%2Btrabajo@datos.test`);
  assert.equal(no.status, 404);

  // se crea desde el panel
  const r = await fetch(`${base}/panel/espacio`, {
    ...formulario({ espacio: 'trabajo' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    redirect: 'manual',
  });
  assert.equal(r.status, 302);

  wf = await (await fetch(`${base}/.well-known/webfinger?resource=acct:adela%2Btrabajo@datos.test`)).json();
  assert.match(wf.links.find((l) => l.rel === 'remoteStorage').href, /\/storage\/adela\+trabajo\/$/);
  assert.equal(wf.subject, 'acct:adela+trabajo@datos.test');

  // y el panel los lista
  const panel = await (await fetch(`${base}/api/panel`, { headers: { cookie } })).json();
  assert.deepEqual(panel.espacios.map((e) => e.espacio), ['', 'trabajo']);
  await cerrar();
});

test('almacenes: misma ruta, documentos distintos y tokens que no se cruzan', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const cookie = await alta(base);
  await almacen.crearEspacio('adela', 'trabajo');

  const tCasa = await tok(almacen, 'adela');
  const tTrabajo = await tok(almacen, 'adela+trabajo');

  const put = (dir, t, ruta, cuerpo) => fetch(`${base}/storage/${dir}/${ruta}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}` }, body: cuerpo,
  });

  assert.equal((await put('adela', tCasa, 'quemo/a.json', 'CASA')).status, 200);
  assert.equal((await put('adela+trabajo', tTrabajo, 'quemo/a.json', 'TRABAJO')).status, 200);

  const leer = async (dir, t) => (await fetch(`${base}/storage/${dir}/quemo/a.json`, {
    headers: { Authorization: `Bearer ${t}` },
  })).text();

  assert.equal(await leer('adela', tCasa), 'CASA');
  assert.equal(await leer('adela+trabajo', tTrabajo), 'TRABAJO');

  // el token de un almacén no sirve en el otro (ni con scope comodín)
  const cruzado = await fetch(`${base}/storage/adela/quemo/a.json`, { headers: { Authorization: `Bearer ${tTrabajo}` } });
  assert.equal(cruzado.status, 403);
  const comodin = await tok(almacen, 'adela+trabajo', '*:rw');
  const intento = await fetch(`${base}/storage/adela/quemo/a.json`, { headers: { Authorization: `Bearer ${comodin}` } });
  assert.equal(intento.status, 403, 'el comodín solo alcanza a su almacén');

  // el listado de cada almacén solo ve lo suyo
  const lista = await (await fetch(`${base}/storage/adela+trabajo/quemo/`, { headers: { Authorization: `Bearer ${tTrabajo}` } })).json();
  assert.deepEqual(Object.keys(lista.items), ['a.json']);

  // y el respaldo de cada almacén va por separado
  const copia = await (await fetch(`${base}/panel/respaldo?espacio=trabajo`, { headers: { cookie } })).json();
  assert.equal(copia.usuario, 'adela+trabajo');
  assert.equal(Buffer.from(copia.documentos[0].contenido, 'base64').toString(), 'TRABAJO');
  await cerrar();
});

test('almacenes: la cuota es de la cuenta y suma todos los almacenes', async () => {
  const { base, almacen, cerrar } = await arrancar();
  await alta(base);
  await almacen.crearEspacio('adela', 'trabajo');
  const tCasa = await tok(almacen, 'adela', '*:rw');
  const tTrabajo = await tok(almacen, 'adela+trabajo', '*:rw');

  // 1000 B de cuota en total: 600 en casa, 300 en trabajo y no caben 200 más
  await fetch(`${base}/storage/adela/quemo/a.json`, { method: 'PUT', headers: { Authorization: `Bearer ${tCasa}` }, body: 'x'.repeat(600) });
  await fetch(`${base}/storage/adela+trabajo/quemo/b.json`, { method: 'PUT', headers: { Authorization: `Bearer ${tTrabajo}` }, body: 'x'.repeat(300) });

  const noCabe = await fetch(`${base}/storage/adela+trabajo/quemo/c.json`, {
    method: 'PUT', headers: { Authorization: `Bearer ${tTrabajo}` }, body: 'x'.repeat(200),
  });
  assert.equal(noCabe.status, 413);
  const aviso = await noCabe.json();
  assert.equal(aviso.usado, 900, 'cuenta lo de los dos almacenes');

  const cabe = await fetch(`${base}/storage/adela+trabajo/quemo/c.json`, {
    method: 'PUT', headers: { Authorization: `Bearer ${tTrabajo}` }, body: 'x'.repeat(50),
  });
  assert.equal(cabe.status, 200);
  await cerrar();
});

test('almacenes: borrar uno se lleva sus datos y sus tokens', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const cookie = await alta(base);
  await almacen.crearEspacio('adela', 'trabajo');
  const tTrabajo = await tok(almacen, 'adela+trabajo');

  await fetch(`${base}/storage/adela+trabajo/quemo/a.json`, {
    method: 'PUT', headers: { Authorization: `Bearer ${tTrabajo}` }, body: 'DENTRO',
  });
  assert.equal(await almacen.totalUsado('adela+trabajo'), 6);

  await fetch(`${base}/panel/espacio`, {
    ...formulario({ accion: 'borrar', espacio: 'trabajo' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie }, redirect: 'manual',
  });

  assert.equal(await almacen.totalUsado('adela+trabajo'), 0);
  assert.equal(await almacen.token(tTrabajo), null, 'el token de ese almacén se revoca');
  const leer = await fetch(`${base}/storage/adela+trabajo/quemo/a.json`, { headers: { Authorization: `Bearer ${tTrabajo}` } });
  assert.equal(leer.status, 401);
  const wf = await fetch(`${base}/.well-known/webfinger?resource=acct:adela%2Btrabajo@datos.test`);
  assert.equal(wf.status, 404);
  await cerrar();
});

test('almacenes: nombre inválido no se crea y el suyo no se puede borrar', async () => {
  const { base, almacen, cerrar } = await arrancar();
  const cookie = await alta(base);
  const cabeceras = { 'Content-Type': 'application/x-www-form-urlencoded', cookie };

  const malo = await fetch(`${base}/panel/espacio`, {
    ...formulario({ espacio: 'con espacio' }), headers: cabeceras, redirect: 'manual',
  });
  assert.equal(malo.headers.get('location'), '/panel?error=espacio');
  assert.deepEqual(await almacen.espaciosDe('adela'), []);

  // intentar borrar el almacén por defecto no hace nada
  await fetch(`${base}/panel/espacio`, {
    ...formulario({ accion: 'borrar', espacio: '' }), headers: cabeceras, redirect: 'manual',
  });
  assert.ok(await almacen.usuario('adela'), 'la cuenta sigue viva');
  await cerrar();
});
