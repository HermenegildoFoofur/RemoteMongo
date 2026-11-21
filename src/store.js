/** Almacén de documentos sobre MongoDB.
 *
 *  remoteStorage habla de ficheros, no de colecciones consultables: la clave es el path
 *  («quemo/2026-11-19.json») y lo que se guarda es su contenido con un ETag. Mongo hace
 *  de almacén de claves con un índice único por (usuario, path), y de ahí salen también
 *  los listados de carpeta.
 */

import { createHash } from 'node:crypto';

export const COLECCIONES = { documentos: 'documentos', usuarios: 'usuarios', tokens: 'tokens' };

/** Hash corto y estable: es el ETag del documento. */
export const etagDe = (cuerpo) => `"${createHash('sha256').update(cuerpo).digest('base64url').slice(0, 22)}"`;

export class AlmacenMongo {
  constructor(db) {
    this.db = db;
    this.docs = db.collection(COLECCIONES.documentos);
    this.usuarios = db.collection(COLECCIONES.usuarios);
    this.tokens = db.collection(COLECCIONES.tokens);
  }

  /** Índices: el path es único por usuario y los listados van por prefijo. */
  static async preparar(db) {
    const docs = db.collection(COLECCIONES.documentos);
    await docs.createIndex({ usuario: 1, path: 1 }, { unique: true });
    await docs.createIndex({ usuario: 1, path: 1, carpeta: 1 });
    await db.collection(COLECCIONES.usuarios).createIndex({ usuario: 1 }, { unique: true });
    await db.collection(COLECCIONES.tokens).createIndex({ token: 1 }, { unique: true });
    return new AlmacenMongo(db);
  }

  /* ------------------------------------------------------------- documentos */
  async leer(usuario, ruta) {
    const doc = await this.docs.findOne({ usuario, path: normal(ruta), carpeta: false });
    if (!doc) return null;
    return {
      cuerpo: Buffer.from(doc.cuerpo.buffer ?? doc.cuerpo),
      tipo: doc.tipo,
      etag: doc.etag,
      fecha: doc.fecha,
    };
  }

  async escribir(usuario, ruta, cuerpo, tipo, { ifMatch, ifNoneMatch } = {}) {
    const path = normal(ruta);
    const buffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo);
    const etag = etagDe(buffer);
    const actual = await this.docs.findOne({ usuario, path, carpeta: false });

    if (ifNoneMatch === '*' && actual) return { conflicto: 'existe' };
    if (ifMatch && (!actual || actual.etag !== ifMatch)) return { conflicto: 'etag' };
    if (actual && actual.etag === etag) return { sinCambios: true, etag };

    await this.docs.updateOne(
      { usuario, path },
      {
        $set: {
          usuario, path, carpeta: false, tipo: tipo || 'application/octet-stream',
          etag, tamano: buffer.length, fecha: new Date().toISOString(), cuerpo: buffer,
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
  async crearUsuario({ usuario, hash, sal }) {
    await this.usuarios.insertOne({
      usuario, hash, sal, creado: new Date().toISOString(), activo: true,
    });
    return { usuario };
  }

  async usuario(nombre) {
    return this.usuarios.findOne({ usuario: String(nombre).toLowerCase() });
  }

  /* ----------------------------------------------------------------- tokens */
  async guardarToken({ token, usuario, scope, app, caduca }) {
    await this.tokens.insertOne({
      token, usuario, scope, app: app || 'app', creado: new Date().toISOString(), caduca: caduca || null,
    });
    return token;
  }

  async token(valor) {
    const t = await this.tokens.findOne({ token: valor });
    if (!t) return null;
    if (t.caduca && new Date(t.caduca) < new Date()) return null;
    return t;
  }

  async listarTokens(usuario) {
    return this.tokens
      .find({ usuario }, { projection: { _id: 0 } })
      .sort({ creado: -1 })
      .toArray();
  }

  async revocarToken(usuario, valor) {
    const r = await this.tokens.deleteOne({ usuario, token: valor });
    return r.deletedCount > 0;
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
  constructor() {
    this.docs = new Map();
    this.usuarios = new Map();
    this.tokens = new Map();
  }

  static async preparar() { return new AlmacenMemoria(); }

  clave(usuario, ruta) { return `${usuario}\u0000${normal(ruta)}`; }

  async leer(usuario, ruta) {
    const d = this.docs.get(this.clave(usuario, ruta));
    if (!d || d.carpeta) return null;
    return { cuerpo: d.cuerpo, tipo: d.tipo, etag: d.etag, fecha: d.fecha };
  }

  async escribir(usuario, ruta, cuerpo, tipo, { ifMatch, ifNoneMatch } = {}) {
    const k = this.clave(usuario, ruta);
    const buffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo);
    const etag = etagDe(buffer);
    const actual = this.docs.get(k);
    if (ifNoneMatch === '*' && actual) return { conflicto: 'existe' };
    if (ifMatch && (!actual || actual.etag !== ifMatch)) return { conflicto: 'etag' };
    if (actual && actual.etag === etag) return { sinCambios: true, etag };
    this.docs.set(k, {
      usuario, path: normal(ruta), carpeta: false, cuerpo: buffer,
      tipo: tipo || 'application/octet-stream', etag, tamano: buffer.length,
      fecha: new Date().toISOString(),
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

  async crearUsuario(u) { this.usuarios.set(String(u.usuario).toLowerCase(), u); return u; }
  async usuario(nombre) { return this.usuarios.get(String(nombre).toLowerCase()) || null; }
  async guardarToken(t) { this.tokens.set(t.token, t); return t.token; }
  async token(valor) { return this.tokens.get(valor) || null; }
  async listarTokens(usuario) { return [...this.tokens.values()].filter((t) => t.usuario === usuario); }
  async revocarToken(usuario, valor) {
    const t = this.tokens.get(valor);
    if (!t || t.usuario !== usuario) return false;
    return this.tokens.delete(valor);
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
