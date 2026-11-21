/** Páginas del servidor: instalación, entrada, panel de usuario y administración. */

const CSS = `:root{color-scheme:dark}
.mono,.font-monospace{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.tenue{color:var(--bs-secondary-color)}
.tarjeta{background:var(--bs-body-bg);border:1px solid var(--bs-border-color);border-radius:var(--bs-border-radius-lg);padding:1.25rem;margin-bottom:1rem}
.dato{background:var(--bs-tertiary-bg);border:1px solid var(--bs-border-color);border-radius:var(--bs-border-radius);padding:.6rem .75rem;word-break:break-all}
.pastilla{display:inline-block;background:var(--bs-tertiary-bg);border:1px solid var(--bs-border-color);border-radius:999px;padding:.1rem .6rem;font-size:.8rem;margin:0 .35rem .35rem 0}
.pastilla.mal{background:var(--bs-danger-bg-subtle);border-color:var(--bs-danger-border-subtle);color:var(--bs-danger-text-emphasis)}
.pastilla.bien{background:var(--bs-success-bg-subtle);border-color:var(--bs-success-border-subtle);color:var(--bs-success-text-emphasis)}
.barra{background:var(--bs-secondary-bg);border:1px solid var(--bs-border-color);border-radius:999px;height:.6rem;overflow:hidden;margin:.5rem 0}
.barra-llena{height:100%;background:var(--bs-primary)}
.barra-llena.apurado{background:var(--bs-warning)}
.barra-llena.llena{background:var(--bs-danger)}
.paso{width:1.6rem;height:1.6rem;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--bs-primary);color:#fff;font-size:.85rem;font-weight:600}`;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const kb = (bytes) => {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

/** Pone delante la ruta de instalación a todo lo que empieza por «/». */
const prefijar = (html, raiz) => html
  .replace(/(href|action|src)="\//g, `$1="${raiz}/`)
  .replace(/fetch\('\//g, `fetch('${raiz}/`);

function pagina(titulo, cuerpo, { nav = null, raiz = '' } = {}) {
  const html = `<!doctype html><html lang="es" data-bs-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${esc(titulo)} · RemoteMongo</title>
<link rel="stylesheet" href="/bootstrap.min.css"><style>${CSS}</style></head>
<body class="bg-body-tertiary d-flex flex-column min-vh-100">
<nav class="navbar bg-body border-bottom">
  <div class="container">
    <a class="navbar-brand d-flex align-items-center gap-2 fw-semibold" href="/">
      <span aria-hidden="true">🗄️</span><span>RemoteMongo</span>
    </a>
    ${nav ? `<div class="d-flex flex-wrap justify-content-end gap-3 small">${nav}</div>` : ''}
  </div>
</nav>
<main class="container flex-grow-1 py-4 py-md-5" style="max-width:920px">
${cuerpo}
</main>
<footer class="container text-center tenue small py-4">RemoteMongo · remoteStorage sobre MongoDB</footer>
</body></html>`;
  return raiz ? prefijar(html, raiz) : html;
}

export function respuesta(res, codigo, html, cabeceras = {}) {
  res.writeHead(codigo, { 'Content-Type': 'text/html; charset=utf-8', ...cabeceras });
  res.end(html);
}

export const redirigir = (res, destino, cabeceras = {}) => {
  res.writeHead(302, { Location: destino, ...cabeceras });
  res.end();
};

/* ------------------------------------------------------------- instalación */
export function instalar({ valores = {}, error = '', paso = 'formulario', raiz = '' } = {}) {
  if (paso === 'hecho') {
    return pagina('Instalado', `
      <div class="text-center mb-4">
        <div class="display-5">🎉</div>
        <h1 class="h3 mt-2 mb-1">Ya está instalado</h1>
        <p class="tenue mb-0">Entra con la cuenta de administración que acabas de crear.</p>
      </div>
      <div class="card shadow-sm">
        <div class="card-body text-center py-4">
          <p class="mb-3">Tu servidor remoteStorage está escuchando y con los datos cifrados.</p>
          <a class="btn btn-primary px-4" href="/entrar">Entrar</a>
        </div>
      </div>`, { raiz });
  }

  return pagina('Instalar', `
    <div class="text-center mb-4 mb-md-5">
      <div class="display-6">⚙️</div>
      <h1 class="h3 mt-2 mb-1">Primera configuración</h1>
      <p class="tenue mb-0">Como en WordPress: se rellena una vez y queda guardado en el servidor.</p>
    </div>

    ${error ? `<div class="alert alert-danger d-flex gap-2" role="alert">
      <span aria-hidden="true">⚠️</span><div>${esc(error)}</div></div>` : ''}

    <form method="post" action="/instalar" class="row g-3 g-md-4" novalidate>
      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-header bg-transparent d-flex align-items-center gap-2 fw-semibold">
            <span class="paso">1</span> Base de datos
          </div>
          <div class="card-body row g-3">
            <div class="col-12">
              <label class="form-label" for="mongoUrl">Ruta a MongoDB</label>
              <input class="form-control font-monospace" id="mongoUrl" name="mongoUrl" required
                     autocomplete="off" spellcheck="false"
                     value="${esc(valores.mongoUrl || 'mongodb://127.0.0.1:27017')}"
                     placeholder="mongodb://usuario:clave@127.0.0.1:27017/remotemongo?authSource=remotemongo">
              <div class="form-text">Con usuario y base de autenticación si los tiene. Se comprueba antes de guardar.</div>
            </div>
            <div class="col-12 col-sm-6 col-lg-4">
              <label class="form-label" for="mongoDb">Base de datos</label>
              <input class="form-control font-monospace" id="mongoDb" name="mongoDb"
                     value="${esc(valores.mongoDb || 'remotemongo')}">
            </div>
          </div>
        </div>
      </div>

      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-header bg-transparent d-flex align-items-center gap-2 fw-semibold">
            <span class="paso">2</span> Servidor
          </div>
          <div class="card-body row g-3">
            <div class="col-12 col-md-6">
              <label class="form-label" for="dominio">Dominio público</label>
              <div class="input-group">
                <span class="input-group-text">@</span>
                <input class="form-control font-monospace" id="dominio" name="dominio" required
                       value="${esc(valores.dominio || '')}" placeholder="remotemongo.eines.net">
              </div>
              <div class="form-text">Lo que va detrás de la <span class="mono">@</span> de cada usuario: <span class="mono">adela@tudominio</span>.</div>
            </div>
            <div class="col-12 col-md-6">
              <label class="form-label" for="rutaBase">Ruta de instalación</label>
              <div class="input-group">
                <span class="input-group-text mono">/</span>
                <input class="form-control font-monospace" id="rutaBase" name="rutaBase"
                       value="${esc((valores.rutaBase || '').replace(/^\//, ''))}" placeholder="remotemongo (vacío = raíz)">
              </div>
              <div class="form-text">Si la publicas en <span class="mono">https://tudominio/remotemongo/</span>, escribe
                <span class="mono">remotemongo</span>. Enlaces, API y endpoints se adaptan solos.</div>
            </div>
            <div class="col-12">
              <div class="form-check form-switch">
                <input class="form-check-input" type="checkbox" role="switch" name="https" id="https"
                       ${valores.https === false ? '' : 'checked'}>
                <label class="form-check-label" for="https">Va detrás de un proxy con TLS</label>
              </div>
              <div class="form-text">Recomendado: el protocolo exige HTTPS en producción.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-12">
        <div class="card shadow-sm">
          <div class="card-header bg-transparent d-flex align-items-center gap-2 fw-semibold">
            <span class="paso">3</span> Cuenta de administración
          </div>
          <div class="card-body row g-3">
            <div class="col-12 col-md-4">
              <label class="form-label" for="admin">Usuario</label>
              <input class="form-control font-monospace" id="admin" name="admin" required
                     pattern="[a-z0-9][a-z0-9._-]{1,31}" autocomplete="username"
                     value="${esc(valores.admin || '')}" placeholder="adela">
            </div>
            <div class="col-12 col-md-4">
              <label class="form-label" for="clave">Contraseña</label>
              <input class="form-control" id="clave" type="password" name="clave" required minlength="8"
                     autocomplete="new-password">
              <div class="form-text">Mínimo 8 caracteres.</div>
            </div>
            <div class="col-12 col-md-4">
              <label class="form-label" for="clave2">Repite la contraseña</label>
              <input class="form-control" id="clave2" type="password" name="clave2" required minlength="8"
                     autocomplete="new-password">
            </div>
          </div>
        </div>
      </div>

      <div class="col-12 d-grid d-sm-flex justify-content-sm-end gap-2">
        <button class="btn btn-primary btn-lg px-4">Instalar</button>
      </div>
    </form>`, { raiz });
}

/* ------------------------------------------------------------------ entrada */
export function entrar({ error = '', abierto = true, aviso = '', raiz = '' } = {}) {
  return pagina('Entrar', `
    <div class="row justify-content-center">
      <div class="col-12 col-sm-9 col-md-7 col-lg-5">
        <div class="card shadow-sm">
          <div class="card-body p-4">
            <h1 class="h4 mb-3">Entrar</h1>
            ${aviso ? `<div class="alert alert-success py-2">${esc(aviso)}</div>` : ''}
            ${error ? `<div class="alert alert-danger py-2">${esc(error)}</div>` : ''}
            <form method="post" action="/entrar">
              <div class="mb-3">
                <label class="form-label" for="usuario">Usuario</label>
                <input class="form-control font-monospace" id="usuario" name="usuario" required autocomplete="username">
              </div>
              <div class="mb-3">
                <label class="form-label" for="clave">Contraseña</label>
                <input class="form-control" id="clave" type="password" name="clave" required autocomplete="current-password">
              </div>
              <button class="btn btn-primary w-100">Entrar</button>
            </form>
            ${abierto ? '<p class="mt-3 mb-0 tenue small">¿No tienes cuenta? <a href="/alta">Crear una</a></p>' : ''}
          </div>
        </div>
      </div>
    </div>`, { raiz });
}

export function alta({ abierto = true, error = '', creada = null, raiz = '' } = {}) {
  if (creada) {
    return pagina('Cuenta creada', `
      <div class="row justify-content-center">
        <div class="col-12 col-md-9 col-lg-7">
          <div class="card shadow-sm">
            <div class="card-body p-4">
              <div class="text-center mb-3"><div class="display-6">✅</div>
                <h1 class="h4 mt-2 mb-1">Cuenta creada</h1></div>
              <p class="tenue">Estos son tus datos. La dirección es lo que se pone en las apps.</p>
              <label class="form-label small mb-1">Dirección</label>
              <div class="dato mono mb-3">${esc(creada.direccion)}</div>
              <label class="form-label small mb-1">Endpoint</label>
              <div class="dato mono mb-4">${esc(creada.endpoint)}</div>
              <a class="btn btn-primary" href="/panel">Ir a mi panel</a>
            </div>
          </div>
        </div>
      </div>`, { raiz });
  }
  if (!abierto) {
    return pagina('Registro cerrado', `
      <div class="row justify-content-center">
        <div class="col-12 col-md-8 col-lg-6">
          <div class="card shadow-sm"><div class="card-body p-4 text-center">
            <h1 class="h4">Registro cerrado</h1>
            <p class="tenue">Este servidor no acepta cuentas nuevas ahora mismo.</p>
            <a class="btn btn-secondary" href="/entrar">Entrar</a>
          </div></div>
        </div>
      </div>`, { raiz });
  }
  return pagina('Crear cuenta', `
    <div class="row justify-content-center">
      <div class="col-12 col-sm-9 col-md-7 col-lg-5">
        <div class="card shadow-sm">
          <div class="card-body p-4">
            <h1 class="h4 mb-3">Crear cuenta</h1>
            ${error ? `<div class="alert alert-danger py-2">${esc(error)}</div>` : ''}
            <form method="post" action="/alta">
              <div class="mb-3">
                <label class="form-label" for="usuario">Usuario</label>
                <input class="form-control font-monospace" id="usuario" name="usuario" required
                       pattern="[a-z0-9][a-z0-9._-]{1,31}" placeholder="adela" autocomplete="username">
                <div class="form-text">Minúsculas, números, punto, guion y guion bajo.</div>
              </div>
              <div class="mb-3">
                <label class="form-label" for="clave">Contraseña</label>
                <input class="form-control" id="clave" type="password" name="clave" required minlength="8"
                       autocomplete="new-password">
                <div class="form-text">Mínimo 8 caracteres.</div>
              </div>
              <button class="btn btn-primary w-100">Crear cuenta</button>
            </form>
            <p class="mt-3 mb-0 tenue small">¿Ya la tienes? <a href="/entrar">Entrar</a></p>
          </div>
        </div>
      </div>
    </div>`, { raiz });
}

/* ------------------------------------------------- paneles (Vue 3, sin build) */

/** Vue 3 desde CDN; si no hay red, cae al fichero que sirve el propio servidor. */
const VUE_CDN = 'https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js';
const VUE = `<script src="${VUE_CDN}"></script>
<script>window.Vue || document.write('<script src="/vue.global.prod.js"><\\/script>');</script>`;

/** Lo que comparten las dos plantillas: tamaño legible y fecha corta. */
const AYUDAS = `
const kb = (bytes) => {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' kB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
};
const fecha = (s) => String(s || '').slice(0, 10);
`;

/** Panel de cada persona. Los datos llegan de /api/panel; las acciones son formularios. */
export function panelUsuario({ rol = 'usuario', raiz = '' } = {}) {
  const nav = `${rol === 'admin' ? '<a href="/admin">Administración</a> · ' : ''}<a href="/salir">Salir</a>`;
  return pagina('Mi panel', `
    ${VUE}
    <div id="app">
      <p v-if="!listo" class="tenue">Cargando…</p>
      <template v-else>
        <div class="tarjeta">
          <h1>Hola, {{ usuario }}</h1>
          <p class="tenue">Tu dirección es lo que pones en las apps:</p>
          <div class="dato mono">{{ usuario }}@{{ dominio }}</div>
          <p class="mt-2 mb-1 tenue">Y tu endpoint, para apps que no hablan WebFinger:</p>
          <div class="dato mono">{{ endpoint }}</div>
        </div>
        <div class="tarjeta">
          <h2>Aplicaciones conectadas ({{ apps.length }})</h2>
          <p v-if="!apps.length" class="tenue mt-2">Ninguna app conectada todavía.</p>
          <div v-for="a in apps" :key="a.id"
               class="d-flex justify-content-between align-items-center border-top pt-2 mt-2">
            <div>
              <strong>{{ a.app }}</strong><br>
              <span class="pastilla mono">{{ a.scope }}</span>
              <span class="tenue" style="font-size:.8rem">desde {{ fecha(a.creado) }}</span>
            </div>
            <form method="post" action="/panel/revocar" class="m-0">
              <input type="hidden" name="id" :value="a.id">
              <button class="btn btn-sm btn-outline-danger">Desconectar</button>
            </form>
          </div>
        </div>
        <div class="tarjeta">
          <h2>Lo que ocupas</h2>
          <p class="mb-1"><strong>{{ kb(usado) }}</strong> de <strong>{{ kb(cuota) }}</strong>
            <span class="tenue">({{ pct }} %)</span></p>
          <div class="barra"><div class="barra-llena" :class="clase" :style="{ width: pct + '%' }"></div></div>
          <p class="tenue" style="font-size:.85rem">Te quedan <strong>{{ kb(resto) }}</strong>.
            Si se llena, las apps reciben un aviso y no se guarda nada más hasta que borres algo.</p>
          <span v-for="c in categorias" :key="c.categoria" class="pastilla mono">
            {{ c.categoria }} · {{ c.documentos }} doc · {{ kb(c.bytes) }}</span>
          <span v-if="!categorias.length" class="tenue">Sin datos guardados.</span>
          <p class="mt-3 mb-0"><a class="btn btn-sm btn-outline-secondary" href="/panel/respaldo">Descargar copia (JSON)</a></p>
        </div>
      </template>
    </div>
    <script>
    ${AYUDAS}
    Vue.createApp({
      data: () => ({ listo: false, usuario: '', rol: 'usuario', dominio: '', endpoint: '',
        apps: [], categorias: [], usado: 0, cuota: 0 }),
      computed: {
        pct() { return this.cuota > 0 ? Math.min(100, Math.round((this.usado / this.cuota) * 100)) : 0; },
        resto() { return Math.max(0, this.cuota - this.usado); },
        clase() { return this.pct >= 100 ? 'llena' : this.pct >= 90 ? 'apurado' : ''; },
      },
      methods: { kb, fecha },
      async mounted() {
        try {
          const r = await fetch('/api/panel', { credentials: 'same-origin' });
          if (r.ok) Object.assign(this, await r.json());
        } finally { this.listo = true; }
      },
    }).mount('#app');
    </script>`,
  { nav, raiz });
}

/** Administración: solo metadatos. Datos de /api/admin; acciones por formulario. */
export function panelAdmin({ error = '', raiz = '' } = {}) {
  return pagina('Administración', `
    ${VUE}
    <div id="app">
      <p v-if="!listo" class="tenue">Cargando…</p>
      <template v-else>
        <div v-if="error" class="alert alert-danger py-2">{{ error }}</div>
        <div class="tarjeta">
          <h1>Administración</h1>
          <p class="tenue">Esto es solo <strong>metadatos</strong>: apps conectadas y espacio ocupado.
            El contenido de las cuentas no se puede leer desde aquí.</p>
          <div class="table-responsive">
          <table class="table table-sm align-middle">
            <thead><tr><th>Usuario</th><th>Estado</th><th class="text-end">Apps</th>
              <th class="text-end">Ocupa / cuota</th><th></th></tr></thead>
            <tbody>
              <template v-for="u in usuarios" :key="u.usuario">
                <tr>
                  <td class="mono">{{ u.usuario }}<span v-if="u.rol === 'admin'" class="pastilla">admin</span></td>
                  <td><span class="pastilla" :class="u.activo === false ? 'mal' : 'bien'">{{ u.activo === false ? 'desactivada' : 'activa' }}</span></td>
                  <td class="text-end">{{ u.apps.length }}</td>
                  <td class="text-end mono">{{ kb(u.totalBytes) }} de {{ kb(u.cuota) }}
                    <form method="post" action="/admin/cuota" class="m-0 d-inline-flex gap-1 mt-1">
                      <input type="hidden" name="usuario" :value="u.usuario">
                      <input class="form-control form-control-sm mono text-end" style="width:80px" name="mb"
                             inputmode="decimal" :placeholder="u.cuotaPropia ? 'base' : Math.round(u.cuota / 1048576)"
                             title="Cuota en MB. Vacío o «base» = la cuota del servidor">
                      <button class="btn btn-sm btn-outline-secondary">MB</button>
                    </form>
                    <div class="tenue" style="font-size:.75rem">{{ u.cuotaPropia ? 'cuota propia' : 'cuota del servidor' }}</div>
                  </td>
                  <td class="text-end">
                    <form method="post" action="/admin/estado" class="m-0 d-inline">
                      <input type="hidden" name="usuario" :value="u.usuario">
                      <input type="hidden" name="activo" :value="u.activo === false ? '1' : '0'">
                      <button class="btn btn-sm btn-outline-secondary">{{ u.activo === false ? 'Activar' : 'Desactivar' }}</button>
                    </form>
                  </td>
                </tr>
                <tr v-if="u.apps.length">
                  <td colspan="5" class="pt-0">
                    <div class="tenue" style="font-size:.85rem">Apps:
                      <span v-for="a in u.apps" :key="a.id" class="pastilla">{{ a.app }} · {{ a.scope }}
                        <form method="post" action="/admin/revocar" class="d-inline m-0">
                          <input type="hidden" name="usuario" :value="u.usuario">
                          <input type="hidden" name="id" :value="a.id">
                          <button class="btn btn-link p-0 align-baseline" style="font-size:.8rem">desconectar</button>
                        </form>
                      </span>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="!usuarios.length"><td colspan="5" class="tenue">Sin cuentas</td></tr>
            </tbody>
          </table>
          </div>
        </div>
        <div class="tarjeta">
          <h2>Cuota de espacio por defecto</h2>
          <p class="tenue">Lo que puede ocupar cada cuenta que no tenga una cuota propia.
            Ahora mismo: <strong>{{ kb(config.cuotaBase) }}</strong>.</p>
          <form method="post" action="/admin/cuota-base" class="d-flex gap-2 align-items-end">
            <div><label class="form-label" style="font-size:.85rem">MB por cuenta</label>
              <input class="form-control mono" name="mb" inputmode="decimal" style="width:120px"
                     :value="Math.round(config.cuotaBase / 1048576)" required></div>
            <button class="btn btn-sm btn-outline-secondary mb-1">Guardar</button>
          </form>
          <p class="tenue mt-2 mb-0" style="font-size:.85rem">Cambiarla no borra nada: si alguien ya ocupa
            más, no podrá guardar cosas nuevas hasta bajar de su nuevo límite.</p>
        </div>
        <div class="tarjeta">
          <h2>Cifrado en reposo</h2>
          <template v-if="config.cifrado">
            <p class="mb-1"><span class="pastilla bien">activo</span> AES-256-GCM</p>
            <p class="tenue mb-0" style="font-size:.85rem">Los cuerpos se guardan cifrados en MongoDB con una
              clave que vive en <span class="mono">state/instalacion.json</span>, fuera de la base. Quien tenga un
              dump o un backup de Mongo ve rutas, tamaños y fechas, pero <strong>no el contenido</strong>.</p>
          </template>
          <template v-else>
            <p class="mb-1"><span class="pastilla mal">inactivo</span></p>
            <p class="tenue mb-0" style="font-size:.85rem">Sin clave los cuerpos se guardan en claro. Define
              <span class="mono">RM_CLAVE_CIFRADO</span> (32 bytes en base64) o instala desde cero.</p>
          </template>
        </div>
        <div class="tarjeta">
          <h2>Registro</h2>
          <p class="tenue">Ahora mismo: <strong>{{ config.registroAbierto ? 'abierto' : 'cerrado' }}</strong></p>
          <form method="post" action="/admin/registro" class="m-0">
            <input type="hidden" name="abierto" :value="config.registroAbierto ? '0' : '1'">
            <button class="btn btn-sm btn-outline-secondary">{{ config.registroAbierto ? 'Cerrar el registro' : 'Abrir el registro' }}</button>
          </form>
        </div>
      </template>
    </div>
    <script>
    ${AYUDAS}
    Vue.createApp({
      data: () => ({ listo: false, usuarios: [], error: ${JSON.stringify(String(error ?? ''))},
        config: { cuotaBase: 0, cifrado: false, registroAbierto: true } }),
      methods: { kb },
      async mounted() {
        try {
          const r = await fetch('/api/admin', { credentials: 'same-origin' });
          if (r.ok) { const d = await r.json(); this.usuarios = d.usuarios; this.config = d.config; }
        } finally { this.listo = true; }
      },
    }).mount('#app');
    </script>`,
  { nav: '<a href="/panel">Mi panel</a> · <a href="/salir">Salir</a>', raiz });
}

/* ------------------------------------------------------------- permiso OAuth */
export function permiso({ usuario, scope, permisos, app, redirect, estado, reto, metodo, raiz = '' }) {
  return pagina('Permiso', `
    <div class="row justify-content-center">
      <div class="col-12 col-md-9 col-lg-7">
        <div class="card shadow-sm">
          <div class="card-body p-4">
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="paso" aria-hidden="true">🔑</span>
              <h1 class="h4 mb-0">Permiso para ${esc(app)}</h1>
            </div>
            <p class="tenue">La aplicación quiere acceder a tu cuenta <strong>${esc(usuario)}</strong> en:</p>
            <ul class="list-group list-group-flush mb-3">
              ${permisos.map((p) => `<li class="list-group-item bg-transparent mono px-0">${esc(p)}</li>`).join('')}
            </ul>
            <form method="post" action="/oauth/${esc(usuario)}">
              <input type="hidden" name="scope" value="${esc(scope)}">
              <input type="hidden" name="redirect" value="${esc(redirect)}">
              <input type="hidden" name="estado" value="${esc(estado)}">
              <input type="hidden" name="reto" value="${esc(reto)}">
              <input type="hidden" name="metodo" value="${esc(metodo)}">
              <input type="hidden" name="app" value="${esc(app)}">
              <label class="form-label" for="clave">Tu contraseña</label>
              <input class="form-control mb-3" id="clave" type="password" name="clave" required autocomplete="current-password">
              <div class="d-flex gap-2">
                <button class="btn btn-primary">Permitir</button>
                <a class="btn btn-outline-secondary" href="/">Cancelar</a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>`, { raiz });
}

export function avisoPagina({ titulo, texto, enlace = '/', boton = 'Volver', raiz = '' }) {
  return pagina(titulo, `
    <div class="row justify-content-center">
      <div class="col-12 col-md-8 col-lg-6">
        <div class="card shadow-sm"><div class="card-body p-4 text-center">
          <h1 class="h4">${esc(titulo)}</h1>
          <p class="tenue">${esc(texto)}</p>
          <a class="btn btn-primary" href="${enlace}">${boton}</a>
        </div></div>
      </div>
    </div>`, { raiz });
}

export { kb, esc };
