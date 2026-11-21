/** El asistente de instalación deja el servidor funcionando contra el almacén nuevo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crearServidor } from '../src/servidor.js';

const formulario = (campos) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(campos),
});

test('instalar: pasa al almacén de Mongo y sigue funcionando después', async () => {
  const directorio = mkdtempSync(path.join(tmpdir(), 'rm-inst-'));
  const fichero = path.join(directorio, 'instalacion.json');
  process.env.RM_INSTALACION = fichero;

  // el servidor arranca sin configurar y con el almacén en memoria
  const { AlmacenMemoria } = await import('../src/store.js');
  const memoriaInicial = await AlmacenMemoria.preparar();

  // «Mongo» de juguete: otro almacén aparte, como si fuera otra base
  const mongoFalso = await AlmacenMemoria.preparar();
  let pedido = null;
  const conectarMongo = async (url, db, cifrador) => {
    pedido = { url, db, cifrado: Boolean(cifrador?.activo) };
    return mongoFalso;
  };

  const servidor = crearServidor({
    almacen: memoriaInicial,
    config: { configurado: false, dominio: '', https: false, registroAbierto: true, secreto: 'x' },
    conectarMongo,
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  const r = await fetch(`${base}/instalar`, formulario({
    mongoUrl: 'mongodb://127.0.0.1:27017', mongoDb: 'prueba', dominio: 'datos.test',
    https: 'on', admin: 'jefa', clave: 'clave-de-jefa', clave2: 'clave-de-jefa',
  }));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Ya está instalado/);
  assert.deepEqual({ url: pedido.url, db: pedido.db, cifrado: pedido.cifrado },
    { url: 'mongodb://127.0.0.1:27017', db: 'prueba', cifrado: true });

  // la cuenta de administración tiene que estar en el almacén NUEVO, no en el de memoria
  assert.ok(await mongoFalso.usuario('jefa'), 'el admin se crea en Mongo');
  assert.equal(await memoriaInicial.usuario('jefa'), null, 'el almacén viejo queda atrás');

  // y el fichero de instalación guarda la clave de cifrado
  const guardado = JSON.parse(readFileSync(fichero, 'utf8'));
  assert.equal(Buffer.from(guardado.claveCifrado, 'base64').length, 32);
  assert.equal(guardado.dominio, 'datos.test');

  // entrar y trabajar: token en el almacén nuevo, escribe y lee
  await mongoFalso.guardarToken({ token: 'tok-nuevo', usuario: 'jefa', scope: 'quemo:rw', app: 'quemo' });
  const puesto = await fetch(`${base}/storage/jefa/quemo/a.json`, {
    method: 'PUT', headers: { Authorization: 'Bearer tok-nuevo' }, body: 'hola tras instalar',
  });
  assert.equal(puesto.status, 200, 'la escritura va contra el almacén nuevo');

  const leido = await fetch(`${base}/storage/jefa/quemo/a.json`, { headers: { Authorization: 'Bearer tok-nuevo' } });
  assert.equal(await leido.text(), 'hola tras instalar');

  const entrada = await fetch(`${base}/entrar`, {
    ...formulario({ usuario: 'jefa', clave: 'clave-de-jefa' }), redirect: 'manual',
  });
  assert.equal(entrada.status, 302, 'el admin puede entrar después de instalar');

  await new Promise((r) => servidor.close(r));
  delete process.env.RM_INSTALACION;
  rmSync(directorio, { recursive: true, force: true });
});
