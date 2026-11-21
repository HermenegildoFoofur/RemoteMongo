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

## Primera vez: el asistente

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
**apps conectadas**, **espacio ocupado / cuota**; puede **desconectar apps de cualquier usuario**,
**activar o desactivar cuentas**, **poner cuotas de espacio** y **abrir o cerrar el registro**.

Y lo importante: por ahí **no se puede leer ningún dato de nadie**. El panel solo consulta
metadatos (recuentos y tamaños); el contenido de las cuentas no se sirve ni con sesión de
administración. El administrador tiene su propio almacén como cualquier usuario, en `/panel`.

## Varios almacenes por cuenta

Una cuenta puede tener **varios almacenes**, con el «+» en la dirección, como en el correo:

| Dirección | Almacén | Endpoint |
|---|---|---|
| `adela@dominio` | el de por defecto | `/storage/adela/` |
| `adela+trabajo@dominio` | otro, aparte | `/storage/adela+trabajo/` |

- Misma contraseña y **misma cuota** (la cuota es de la cuenta y suma todos sus almacenes).
- **Aislamiento real**: mismo nombre de carpeta (`quemo/`), documentos distintos; un token de un
  almacén no abre el otro ni con `*:rw`.
- Tokens, apps y copia de seguridad, **por almacén**; se crean y se borran desde `/panel`, y la
  copia se descarga con `/panel/respaldo?espacio=trabajo`.
- En `/admin` se ve el desglose de cada cuenta por almacén (tamaño y número de apps).

## Cuotas de espacio

Hay una **cuota base** para todas las cuentas (100 MB por defecto, `RM_CUOTA_BASE` o desde
`/admin`) y cada cuenta puede tener **la suya** (se pone en MB en `/admin`, o vacío para volver
a la base). La cuota se comprueba en cada `PUT`, contando el espacio real de la cuenta:

- reescribir un documento **no cuenta doble** (solo la diferencia de tamaño),
- borrar **libera** sitio al momento,
- si no cabe, el `PUT` devuelve **413** con `{ error, usado, cuota }` y el documento no se toca,
- bajar la cuota base **no borra nada**: quien esté por encima deja de poder escribir hasta
  que baje de su límite.

El usuario ve su barra de ocupación en `/panel` y el administrador el reparto en `/admin`.

## Cifrado en reposo

Los cuerpos de los documentos **se guardan cifrados** en MongoDB con **AES-256-GCM**, y la
clave **no está en la base**: vive en `state/instalacion.json` (permisos `600`) o en
`RM_CLAVE_CIFRADO`. Consecuencia práctica: **quien tenga un dump o un backup de Mongo ve
rutas, tipos, tamaños y fechas, pero no puede leer el contenido** — falta la clave.

- Cada escritura lleva **IV nuevo** (GCM no lo admite repetido) y **etiqueta de integridad**:
  si alguien toca los bytes guardados, al leer salta un error en vez de devolver basura.
- El **ETag y el tamaño** son los del texto en claro, así que `If-Match`, los listados y las
  cuotas siguen funcionando igual.
- La **copia de seguridad** (`/panel/respaldo`) se sirve **en claro**, descifrada al vuelo.
- Los **tokens de las apps no se guardan**: solo su `sha256`. Un dump tampoco sirve para
  suplantar a nadie; en los paneles se revocan por identificador.
- Si cambias o pierdes la clave, **lo ya guardado no se puede recuperar**: haz copia de
  `instalacion.json` junto con el backup de Mongo.

Lo que **no** hace: no es cifrado de punta a punta. El servidor tiene la clave y por tanto
puede descifrar — quien administre el servidor con acceso al fichero de instalación sí puede
leer. Eso solo se consigue cifrando en el cliente, y entonces el servidor guardaría blobs
opacos: sin listados útiles, sin cuotas por contenido, y **si se pierde la clave de la
persona, los datos se pierden para siempre**. No está implementado.


## Dónde tiene que vivir (WebFinger)

El descubrimiento de remoteStorage está clavado en **la raíz del host**: las apps preguntan a
`https://<host>/.well-known/webfinger`. Consecuencias:

- **Lo limpio es instalarlo en la raíz** de un dominio o subdominio (`remotemongo.midominio.net`):
  con la ruta de instalación vacía, todo el protocolo funciona sin peros.
- Si vive en una **subruta** (`/remotemongo`), el host raíz tiene que reenviar `/.well-known/` al
  servicio. Con nginx:

```nginx
location = /.well-known/webfinger { proxy_pass http://127.0.0.1:8790; }
```

  El resto puede seguir en la subruta; el WebFinger que devuelve ya anuncia los endpoints
  correctos.
- Sin eso, la dirección `usuario@dominio` no se puede resolver; las apps tendrían que conectarse
  **dando la URL del endpoint** en vez de la dirección.

## La ruta de instalación

La web **no usa rutas absolutas**: el asistente pregunta en qué ruta vive (vacío = la raíz del
dominio) y todo se genera con esa ruta delante — enlaces, formularios, `/api/*`, el CSS, Vue y
los endpoints que se anuncian a las apps (`/storage/<usuario>/` y `/oauth/<usuario>`).

Así se puede publicar en `https://midominio/remotemongo/` sin tocar el código, y sigue
funcionando igual detrás de un proxy que **quite** el prefijo (como `tailscale serve
--set-path`): el servidor acepta las peticiones con la ruta o sin ella, pero siempre la
escribe en lo que devuelve.

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
| GET | `/api/panel` | Datos del panel de la sesión (JSON) |
| GET | `/api/admin` | Datos del panel de administración (JSON, solo admin) |

La web (`/panel` y `/admin`) es **Vue 3 sin compilar**: el HTML lleva la plantilla y el
servidor sirve los datos por `/api/*`. Vue se carga desde CDN (`cdn.jsdelivr.net`) y, si no hay
red, cae a `web/vue.global.prod.js`, que va en el repo. Bootstrap 5 también se sirve local.
Las acciones (desconectar app, activar cuenta, cuota) siguen siendo formularios POST normales:
funcionan aunque el navegador no ejecute JavaScript.

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
| `RM_RUTA_BASE` | vacío (raíz) | ruta donde vive la web, p. ej. `/remotemongo` (también se pide en el asistente) |
| `RM_CUOTA_BASE` | `104857600` (100 MB) | cuota de espacio por cuenta, en bytes (también desde `/admin`, en MB) |
| `RM_CLAVE_CIFRADO` | — (la genera `/instalar`) | clave de cifrado en reposo, 32 bytes en base64; **fuera** de MongoDB |

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
  por `(usuario, path)`. El `cuerpo` es binario y va **cifrado** (AES-256-GCM, hasta 16 MB por
  documento; más grande, GridFS).
- `usuarios`: `{ usuario, hash, sal, creado, activo, cuota? }` — contraseña con **scrypt** y sal.
- `tokens`: `{ id, huella, usuario, scope, app, creado, caduca }` — uno por app, con **solo la
  huella** del token; se revocan de uno en uno por `id`.

El `ETag` es el `sha256` del contenido, así que escribir lo mismo dos veces no genera cambios
y un `If-Match` viejo devuelve `412`.

## Arrancar

```bash
npm install
cp .env.example .env      # y pon tu Mongo en RM_MONGO_URL
npm start                 # http://localhost:8790
npm test                  # 29 pruebas (protocolo, cuentas, cuotas y cifrado), sin necesidad de Mongo
```

Para producción, systemd + un proxy con TLS delante (el repo de `webproxy` sirve) y
`RM_DOMINIO` con el dominio real. **Sin TLS el protocolo no funciona**: el OAuth y el
fragmento del token lo exigen.

## Estado

Primera versión funcional: **asistente de instalación**, entrada y alta de cuentas, sesiones
por cookie firmada, descubrimiento, OAuth con PKCE (y flujo clásico), almacén con ETags y
listados, **panel de usuario** (apps conectadas, consumo con barra de cuota, respaldo),
**panel de administración solo con metadatos** (apps, espacio, desconectar apps,
activar/desactivar cuentas, cuotas por cuenta y cuota base, abrir o cerrar el registro).

Pendiente y conocido:
- Cifrado de punta a punta por carpeta (hoy el cifrado es en reposo: ver arriba).
- Subida en streaming y GridFS para documentos grandes.
- `remotestorage.js` de punta a punta contra este servidor desde una app real.
- Suite de conformidad del protocolo (`rs.js` spec-check).

## Licencia

MIT.
