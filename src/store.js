/** Almacén de documentos sobre MongoDB.
 *
 *  remoteStorage habla de ficheros, no de colecciones consultables: la clave es el path
 *  («quemo/2026-11-19.json») y lo que se guarda es su contenido con un ETag. Mongo hace
 *  de almacén de claves con un índice único por (usuario, path), y de ahí salen también
 *  los listados de carpeta.
 */

import { createHash, randomBytes } from 'node:crypto';
import { crearCifrador } from './cifrado.js';

export const COLECCIONES = { documentos: 'documentos', usuarios: 'usuarios', tokens: 'tokens' };

/** Hash corto y estable: es el ETag del documento. */
export const etagDe = (cuerpo) => `"${createHash('sha256').update(cuerpo).digest('base64url').slice(0, 22)}"`;

/** Los tokens no se guardan: solo su huella. Un dump de Mongo no sirve para entrar. */
const huellaToken = (valor) => createHash('sha256').update(String(valor)).digest('hex');
const idToken = () => randomBytes(12).toString('hex');

export class AlmacenMongo {
  constructor(db, cifrador = null) {
    this.db = db;
    this.cifrador = cifrador || crearCifrador(null);
    this.docs = db.collection(COLECCIONES.documentos);
    this.usuarios = db.collection(COLECCIONES.usuarios);
    this.tokens = db.collection(COLECCIONES.tokens);
  }

  /** Índices: el path es único por usuario y los listados van por prefijo. */
  static async preparar(db, cifrador = null) {
    const docs = db.collection(COLECCIONES.documentos);
    await docs.createIndex({ usuario: 1, path: 1 }, { unique: true });
    await docs.createIndex({ usuario: 1, path: 1, carpeta: 1 });
    await db.collection(COLECCIONES.usuarios).createIndex({ usuario: 1 }, { unique: true });
    await db.collection(COLECCIONES.tokens).createIndex({ huella: 1 }, { unique: true });
    await db.collection(COLECCIONES.tokens).createIndex({ id: 1 }, { unique: true });
    return new AlmacenMongo(db, cifrador);
  }

  /* ------------------------------------------------------------- documentos */
  async leer(usuario, ruta) {
    const doc = await this.docs.findOne({ usuario, path: normal(ruta), carpeta: false });
    if (!doc) return null;
    return {
      cuerpo: this.cifrador.descifrar(Buffer.from(doc.cuerpo.buffer ?? doc.cuerpo)),
      tipo: doc.tipo,
      etag: doc.etag,
      fecha: doc.fecha,
    };
  }

  async escribir(usuario, ruta, cuerpo, tipo, { ifMatch, ifNoneMatch, cuotaMax } = {}) {
    const path = normal(ruta);
    const buffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo);
    const etag = etagDe(buffer);
    const actual = await this.docs.findOne({ usuario, path, carpeta: false });

    if (ifNoneMatch === '*' && actual) return { conflicto: 'existe' };
    if (ifMatch && (!actual || actual.etag !== ifMatch)) return { conflicto: 'etag' };
    if (actual && actual.etag === etag) return { sinCambios: true, etag };

    if (cuotaMax != null) {
      const usado = await this.totalUsado(usuario);
      const quedaria = usado - (actual ? actual.tamano : 0) + buffer.length;
      if (quedaria > cuotaMax) return { conflicto: 'cuota', usado, cuota: cuotaMax, quedaria };
    }

    await this.docs.updateOne(
      { usuario, path },
      {
        $set: {
          usuario, path, carpeta: false, tipo: tipo || 'application/octet-stream',
          etag, tamano: buffer.length, fecha: new Date().toISOString(),
          cuerpo: this.cifrador.cifrar(buffer), cifrado: this.cifrador.activo,
        },
      },
      { upsert: true },
    );
    return { etag, tamano: buffer.length };
  }

  async borrar(usuario, ruta, { ifMatch } = {}) {
    const path = normal(ruta);
    const actual = await this.docs.findOne({ usuario, path, carpeta: false });
    if (!actual) return { falta: true };
    if (ifMatch && actual.etag !== ifMatch) return { conflicto: 'etag' };
    await this.docs.deleteOne({ _id: actual._id });
    return { borrado: true };
  }

  /** Listado de carpeta tal y como lo pide el protocolo (JSON-LD). */
  async listar(usuario, ruta) {
    const carpeta = normal(ruta, true);
    const prefijo = carpeta ? `${carpeta}/` : '';
    const hijos = await this.docs
      .find({ usuario, path: { $regex: `^${escaparRegex(prefijo)}` }, carpeta: false })
      .project({ path: 1, etag: 1, tipo: 1, tamano: 1 })
      .toArray();
    if (!hijos.length) {
      // ¿es una carpeta que existe porque tiene subcarpetas?
      const sub = await this.docs.countDocuments({ usuario, path: { $regex: `^${escaparRegex(prefijo)}` }, carpeta: true });
      return sub ? { items: {}, carpetas: {} } : null;
    }
    const items = {};
    const carpetas = {};
    for (const h of hijos) {
      const resto = h.path.slice(prefijo.length);
      const [primero, ...demas] = resto.split('/');
      if (demas.length) {
        carpetas[primero] = '';
      } else {
        items[primero] = { ETag: h.etag, 'Content-Type': h.tipo, 'Content-Length': h.tamano };
      }
    }
    return { items, carpetas };
  }

  /* --------------------------------------------------------------- usuarios */
  async crearUsuario({ usuario, hash, sal, rol = 'usuario', cuota = null }) {
    await this.usuarios.insertOne({
      usuario, hash, sal, rol, creado: new Date().toISOString(), activo: true,
      ...(cuota != null ? { cuota } : {}),
    });
    return { usuario, rol };
  }

  /** Cuota propia de la cuenta, o null para que mande la cuota base del servidor. */
  async cambiarCuota(usuario, cuota) {
    const cambio = cuota == null ? { $unset: { cuota: '' } } : { $set: { cuota: Number(cuota) } };
    const r = await this.usuarios.updateOne({ usuario: String(usuario).toLowerCase() }, cambio);
    return r.matchedCount > 0;
  }

  /** Bytes ocupados por una cuenta (suma de sus documentos, sin contar carpetas). */
  async totalUsado(usuario) {
    const r = await this.docs.aggregate([
      { $match: { usuario, carpeta: false } },
      { $group: { _id: null, bytes: { $sum: '$tamano' } } },
    ]).toArray();
    return r[0]?.bytes || 0;
  }

  /** Lista de cuentas para el panel: sin hash ni sal (el admin no ve credenciales). */
  async listarUsuarios() {
    return this.usuarios
      .find({}, { projection: { hash: 0, sal: 0 } })
      .sort({ creado: 1 })
      .toArray();
  }

  async cambiarEstado(usuario, activo) {
    const r = await this.usuarios.updateOne({ usuario }, { $set: { activo: Boolean(activo) } });
    return r.modifiedCount > 0;
  }

  /** Solo metadatos: cuántas apps y cuánto ocupa cada categoría. Nunca el contenido. */
  async resumenMetadatos(usuario) {
    const [tokens, uso] = await Promise.all([
      this.tokens.find({ usuario }, { projection: { huella: 0, token: 0 } }).toArray(),
      this.uso(usuario),
    ]);
    const bytes = uso.reduce((s, c) => s + c.bytes, 0);
    return {
      usuario,
      apps: tokens.map((t) => ({ id: t.id, app: t.app, scope: t.scope, creado: t.creado })),
      categorias: uso,
      totalBytes: bytes,
    };
  }

  async usuario(nombre) {
    return this.usuarios.findOne({ usuario: String(nombre).toLowerCase() });
  }

  /* ----------------------------------------------------------------- tokens */
  async guardarToken({ token, usuario, scope, app, caduca }) {
    const id = idToken();
    await this.tokens.insertOne({
      id, huella: huellaToken(token), usuario, scope, app: app || 'app',
      creado: new Date().toISOString(), caduca: caduca || null,
    });
    return id;
  }

  async token(valor) {
    // La huella es lo normal; `token: valor` solo por si queda algo de una versión anterior.
    const t = await this.tokens.findOne({ $or: [{ huella: huellaToken(valor) }, { token: valor }] });
    if (!t) return null;
    if (t.caduca && new Date(t.caduca) < new Date()) return null;
    return t;
  }

  async listarTokens(usuario) {
    return this.tokens
      .find({ usuario }, { projection: { _id: 0, huella: 0, token: 0 } })
      .sort({ creado: -1 })
      .toArray();
  }

  async revocarToken(usuario, valor) {
    const r = await this.tokens.deleteOne({
      usuario,
      $or: [{ id: String(valor) }, { huella: huellaToken(valor) }, { token: valor }],
    });
    return r.deletedCount > 0;
  }

  /** Todos los documentos de un usuario, para su copia de seguridad (en claro). */
  async todoDe(usuario) {
    const docs = await this.docs.find({ usuario, carpeta: false }).toArray();
    return docs.map((d) => ({
      path: d.path, tipo: d.tipo, etag: d.etag, fecha: d.fecha,
      contenido: this.cifrador.descifrar(Buffer.from(d.cuerpo.buffer ?? d.cuerpo)).toString('base64'),
    }));
  }

  /** Tamaño ocupado por cada categoría (la primera carpeta del path). */
  async uso(usuario) {
    const porCategoria = await this.docs.aggregate([
      { $match: { usuario, carpeta: false } },
      { $project: { categoria: { $arrayElemAt: [{ $split: ['$path', '/'] }, 0] }, tamano: 1 } },
      { $group: { _id: '$categoria', documentos: { $sum: 1 }, bytes: { $sum: '$tamano' } } },
      { $sort: { _id: 1 } },
    ]).toArray();
    return porCategoria.map((c) => ({ categoria: c._id, documentos: c.documentos, bytes: c.bytes }));
  }
}

/** «/quemo/a.json» → «quemo/a.json»; con carpeta=true quita la barra final. */
export function normal(ruta, carpeta = false) {
  let p = String(ruta || '').replace(/^\/+/, '').replace(/\/+/g, '/');
  if (carpeta) p = p.replace(/\/+$/, '');
  else p = p.replace(/\/$/, '');
  return p;
}

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ------------------------------------------------------------------- memoria */

/** Almacén en memoria, para los tests (misma interfaz que el de Mongo). */
export class AlmacenMemoria {
  constructor(cifrador = null) {
    this.cifrador = cifrador || crearCifrador(null);
    this.docs = new Map();
    this.usuarios = new Map();
    this.tokens = new Map();
  }

  static async preparar(cifrador = null) { return new AlmacenMemoria(cifrador); }

  clave(usuario, ruta) { return `${usuario}\u0000${normal(ruta)}`; }

  async leer(usuario, ruta) {
    const d = this.docs.get(this.clave(usuario, ruta));
    if (!d || d.carpeta) return null;
    return { cuerpo: this.cifrador.descifrar(d.cuerpo), tipo: d.tipo, etag: d.etag, fecha: d.fecha };
  }

  async escribir(usuario, ruta, cuerpo, tipo, { ifMatch, ifNoneMatch, cuotaMax } = {}) {
    const k = this.clave(usuario, ruta);
    const buffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo);
    const etag = etagDe(buffer);
    const actual = this.docs.get(k);
    if (ifNoneMatch === '*' && actual) return { conflicto: 'existe' };
    if (ifMatch && (!actual || actual.etag !== ifMatch)) return { conflicto: 'etag' };
    if (actual && actual.etag === etag) return { sinCambios: true, etag };
    if (cuotaMax != null) {
      const usado = await this.totalUsado(usuario);
      const quedaria = usado - (actual ? actual.tamano : 0) + buffer.length;
      if (quedaria > cuotaMax) return { conflicto: 'cuota', usado, cuota: cuotaMax, quedaria };
    }
    this.docs.set(k, {
      usuario, path: normal(ruta), carpeta: false, cuerpo: this.cifrador.cifrar(buffer),
      tipo: tipo || 'application/octet-stream', etag, tamano: buffer.length,
      fecha: new Date().toISOString(), cifrado: this.cifrador.activo,
    });
    return { etag, tamano: buffer.length };
  }

  async borrar(usuario, ruta, { ifMatch } = {}) {
    const k = this.clave(usuario, ruta);
    const actual = this.docs.get(k);
    if (!actual) return { falta: true };
    if (ifMatch && actual.etag !== ifMatch) return { conflicto: 'etag' };
    this.docs.delete(k);
    return { borrado: true };
  }

  async listar(usuario, ruta) {
    const carpeta = normal(ruta, true);
    const prefijo = carpeta ? `${carpeta}/` : '';
    const items = {};
    const carpetas = {};
    let alguno = false;
    for (const d of this.docs.values()) {
      if (d.usuario !== usuario || !d.path.startsWith(prefijo)) continue;
      alguno = true;
      const resto = d.path.slice(prefijo.length);
      const [primero, ...demas] = resto.split('/');
      if (demas.length) carpetas[primero] = '';
      else items[primero] = { ETag: d.etag, 'Content-Type': d.tipo, 'Content-Length': d.tamano };
    }
    return alguno ? { items, carpetas } : null;
  }

  async crearUsuario(u) {
    const conRol = { rol: 'usuario', activo: true, ...u };
    this.usuarios.set(String(conRol.usuario).toLowerCase(), conRol);
    return conRol;
  }
  async cambiarCuota(usuario, cuota) {
    const u = this.usuarios.get(String(usuario).toLowerCase());
    if (!u) return false;
    if (cuota == null) delete u.cuota;
    else u.cuota = Number(cuota);
    return true;
  }
  async totalUsado(usuario) {
    let total = 0;
    for (const d of this.docs.values()) {
      if (d.usuario === usuario && !d.carpeta) total += d.tamano;
    }
    return total;
  }
  async listarUsuarios() {
    return [...this.usuarios.values()].map(({ hash, sal, ...resto }) => resto);
  }
  async cambiarEstado(usuario, activo) {
    const u = this.usuarios.get(String(usuario).toLowerCase());
    if (!u) return false;
    u.activo = Boolean(activo);
    return true;
  }
  async resumenMetadatos(usuario) {
    const uso = await this.uso(usuario);
    const apps = [...this.tokens.values()].filter((t) => t.usuario === usuario)
      .map((t) => ({ id: t.id, app: t.app, scope: t.scope, creado: t.creado }));
    return {
      usuario,
      apps,
      categorias: uso,
      totalBytes: uso.reduce((s, c) => s + c.bytes, 0),
    };
  }
  async usuario(nombre) { return this.usuarios.get(String(nombre).toLowerCase()) || null; }
  async guardarToken({ token, usuario, scope, app, caduca }) {
    const id = idToken();
    this.tokens.set(id, {
      id, huella: huellaToken(token), usuario, scope, app: app || 'app',
      creado: new Date().toISOString(), caduca: caduca || null,
    });
    return id;
  }
  async token(valor) {
    const h = huellaToken(valor);
    for (const t of this.tokens.values()) {
      if (t.huella === h || t.token === valor) return t;
    }
    return null;
  }
  async listarTokens(usuario) {
    return [...this.tokens.values()].filter((t) => t.usuario === usuario)
      .map(({ huella, token, ...resto }) => resto);
  }
  async revocarToken(usuario, valor) {
    const h = huellaToken(valor);
    for (const [k, t] of this.tokens.entries()) {
      if (t.usuario !== usuario) continue;
      if (t.id === String(valor) || t.huella === h || t.token === valor) return this.tokens.delete(k);
    }
    return false;
  }
  async todoDe(usuario) {
    return [...this.docs.values()]
      .filter((d) => d.usuario === usuario && !d.carpeta)
      .map((d) => ({
        path: d.path, tipo: d.tipo, etag: d.etag, fecha: d.fecha,
        contenido: this.cifrador.descifrar(d.cuerpo).toString('base64'),
      }));
  }

  async uso(usuario) {
    const mapa = new Map();
    for (const d of this.docs.values()) {
      if (d.usuario !== usuario) continue;
      const cat = d.path.split('/')[0];
      const v = mapa.get(cat) || { categoria: cat, documentos: 0, bytes: 0 };
      v.documentos += 1;
      v.bytes += d.tamano;
      mapa.set(cat, v);
    }
    return [...mapa.values()];
  }
}
