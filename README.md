# RemoteMongo

**Tu almacén de datos personal, hablando [remoteStorage](https://remotestorage.io) y guardando en MongoDB.**

Una app web estática (GitHub Pages, por ejemplo) no tiene servidor, pero necesita guardar datos:
tus recorridos de bici, el histórico de lo que has compartido, tus notas. RemoteMongo es el
servidor donde esos datos viven, **separados por aplicación** y con permisos que tú concedes
y puedes revocar.

```
   App (GitHub Pages)  ──WebFinger──▶  remotemongo.midominio.net
          │                                   │
          │◀── permiso OAuth (categoría) ─────│
          │                                   │
          └──PUT/GET /storage/adela/quemo/…──▶ MongoDB
```

## Primera vez: el asistente (como WordPress)

Arrancas el servidor y, si no está configurado, **todo lleva a `/instalar`**. Ahí se pide, una
sola vez:

- **la ruta a MongoDB** (con credenciales si las tiene) y el nombre de la base,
- el **dominio público** —lo que va detrás de la `@` de cada usuario— y si va detrás de TLS,
- la **cuenta de administración** (usuario y contraseña).

Se comprueba la conexión a Mongo, se guarda en `state/instalacion.json` (permisos `600`, porque
la conexión no puede vivir dentro de la propia base) con un secreto aleatorio para las sesiones,
y se crea el administrador.

Después, la entrada es **`/entrar`** (login) y **`/alta`** (crear cuenta, si el registro está
abierto).

## El flujo, en corto

1. **Te das de alta** y el servidor te da dos cosas:
   - tu **dirección**: `adela@remotemongo.midominio.net` (con forma de correo, es lo que se
     da a las apps),
   - tu **endpoint**: `https://remotemongo.midominio.net/storage/adela/` (para apps que no
     hablan WebFinger).
2. **En la app** de quemo pones esa dirección. La app pregunta al servidor por
   `/.well-known/webfinger`, descubre el endpoint y te lleva a una pantalla de permiso.
3. Tú apruebas **una carpeta**: la app pide `quemo:rw` y solo puede leer y escribir dentro de
   `/quemo/`. No ves las demás y no puedes salir de ahí.
4. La app guarda con `PUT` y lee con `GET`. Cuando quieras, revocas el permiso y la app deja
   de entrar.

No hay «crear una colección a mano»: la carpeta nace con el primer `PUT`, y el permiso lo
define lo que la app pide en el OAuth.

## Paneles

**`/panel` (cada usuario).** Su dirección y su endpoint, las **apps conectadas** con su permiso
y botón de desconectar, y lo que ocupa por categoría. Incluye **«Descargar copia»**, que baja
todos sus documentos en JSON.

**`/admin` (solo la cuenta de administración).** Lista de cuentas con **estado**, número de
**apps conectadas** y **espacio ocupado**; puede **desconectar apps de cualquier usuario**,
**activar o desactivar cuentas** y **abrir o cerrar el registro**.

Y lo importante: por ahí **no se puede leer ningún dato de nadie**. El panel solo consulta
metadatos (recuentos y tamaños); el contenido de las cuentas no se sirve ni con sesión de
administración. El administrador tiene su propio almacén como cualquier usuario, en `/panel`.


## La API que exponen las apps

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/.well-known/webfinger?resource=acct:usuario@dominio` | Descubrimiento del almacén |
| GET | `/oauth/<usuario>` | Pantalla de permiso |
| POST | `/oauth/<usuario>` | Aprobar (devuelve código PKCE o token) |
| POST | `/oauth/token` | Canje del código por el token |
| GET | `/storage/<usuario>/<ruta>` | Leer un documento o listar una carpeta |
| HEAD | `/storage/<usuario>/<ruta>` | Metadatos (ETag, tipo, tamaño) |
| PUT | `/storage/<usuario>/<ruta>` | Escribir (con `If-Match` / `If-None-Match`) |
| DELETE | `/storage/<usuario>/<ruta>` | Borrar |

Los **permisos** son por categoría (la primera carpeta): `quemo:rw`, `secretos:rw`, `*:r`.
Todo lleva **CORS abierto**, ETags para no pisar cambios, y los listados en JSON-LD como pide
el borrador `draft-dejong-remotestorage-22`.

## Configuración

Todo por entorno o en un `.env` al lado del proyecto (ver `.env.example`):

| Variable | Por defecto | Para qué |
|---|---|---|
| `RM_PORT` | `8790` | puerto donde escucha |
| `RM_DOMINIO` | `localhost:8790` | dominio público: es lo que va detrás de la `@` de cada usuario |
| `RM_HTTPS` | `si` | `si` cuando va detrás de un proxy con TLS |
| **`RM_MONGO_URL`** | `mongodb://127.0.0.1:27017` | **la ruta a MongoDB** |
| **`RM_MONGO_DB`** | `remotemongo` | **base donde se guardan los datos** |
| `RM_REGISTRO` | `si` | registro abierto o cerrado (también se cambia desde `/admin`) |

Las variables **son opcionales cuando usas el asistente**: escribe la ruta de Mongo en
`/instalar` y queda guardada en `state/instalacion.json`. Si defines `RM_MONGO_URL`,
`RM_DOMINIO` y `RM_SECRETO`, el servidor arranca ya configurado y se salta el asistente
(útil en Docker).

Con credenciales, la ruta de Mongo lleva usuario y base de autenticación:

```
RM_MONGO_URL=mongodb://remotemongo:CLAVE@127.0.0.1:27017/remotemongo?authSource=remotemongo
```

## Cómo se guarda en MongoDB

Una sola colección hace de sistema de ficheros, porque el protocolo habla de rutas, no de
colecciones consultables:

- `documentos`: `{ usuario, path, tipo, etag, tamano, fecha, cuerpo }`, con índice **único**
  por `(usuario, path)`. El `cuerpo` es binario (hasta 16 MB por documento; más grande, GridFS).
- `usuarios`: `{ usuario, hash, sal, creado, activo }` — contraseña con **scrypt** y sal.
- `tokens`: `{ token, usuario, scope, app, creado, caduca }` — uno por app; se revocan de uno
  en uno.

El `ETag` es el `sha256` del contenido, así que escribir lo mismo dos veces no genera cambios
y un `If-Match` viejo devuelve `412`.

## Arrancar

```bash
npm install
cp .env.example .env      # y pon tu Mongo en RM_MONGO_URL
npm start                 # http://localhost:8790
npm test                  # 7 pruebas del protocolo, sin necesidad de Mongo
```

Para producción, systemd + un proxy con TLS delante (el repo de `webproxy` sirve) y
`RM_DOMINIO` con el dominio real. **Sin TLS el protocolo no funciona**: el OAuth y el
fragmento del token lo exigen.

## Estado

Primera versión funcional: **asistente de instalación**, entrada y alta de cuentas, sesiones
por cookie firmada, descubrimiento, OAuth con PKCE (y flujo clásico), almacén con ETags y
listados, **panel de usuario** (apps conectadas, consumo, respaldo) y **panel de
administración solo con metadatos** (apps, espacio, desconectar apps, activar/desactivar
cuentas, abrir o cerrar el registro).

Pendiente y conocido:
- Subida en streaming y GridFS para documentos grandes.
- `remotestorage.js` de punta a punta contra este servidor desde una app real.
- Suite de conformidad del protocolo (`rs.js` spec-check).

## Licencia

MIT.
