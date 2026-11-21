/** Páginas del servidor: instalación, entrada, paneles y pantalla de permiso.
 *
 *  Sin framework de componentes: Tailwind precompilado en `web/tailwind.css` y las clases
 *  de `web/estilos.css` (.caja, .campo, .boton…), que usan variables CSS para el tema claro
 *  y oscuro. Los paneles son apps de Vue 3 (CDN con caída local) que piden sus datos a la
 *  API del propio servidor. Todos los enlaces internos son relativos: la web funciona en la
 *  raíz del dominio, en una subruta o detrás de un proxy que quita el prefijo.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const kb = (bytes) => {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

/** Enlaces relativos a la carpeta de la página (ver cabecera). */
const relativizar = (html) => html.replace(
  /(href|action)="\/([^"]*)"/g,
  (_, atributo, resto) => `${atributo}="${resto || '.'}"`,
);

/** Tema guardado en el navegador; se aplica antes de pintar para no parpadear. */
const SCRIPT_TEMA = `<script>
  (function () {
    try {
      var guardado = localStorage.getItem('tema') || 'sistema';
      var oscuro = guardado === 'oscuro'
        || (guardado === 'sistema' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = oscuro ? 'dark' : 'light';
    } catch (e) { document.documentElement.dataset.theme = 'light'; }
  })();
</script>`;

const SCRIPT_BOTON_TEMA = `<script>
  (function () {
    var boton = document.getElementById('tema');
    if (!boton) return;
    var pinta = function () {
      var oscuro = document.documentElement.dataset.theme === 'dark';
      boton.textContent = oscuro ? '☀️' : '🌙';
      boton.setAttribute('title', oscuro ? 'Tema claro' : 'Tema oscuro');
    };
    pinta();
    boton.addEventListener('click', function () {
      var oscuro = document.documentElement.dataset.theme !== 'dark';
      document.documentElement.dataset.theme = oscuro ? 'dark' : 'light';
      try { localStorage.setItem('tema', oscuro ? 'oscuro' : 'claro'); } catch (e) {}
      pinta();
    });
  })();
</script>`;

function pagina(titulo, cuerpo, { nav = null, raiz = '' } = {}) {
  const html = `<!doctype html><html lang="es" data-theme="light" class="h-full"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(titulo)} · RemoteMongo</title>
<link rel="stylesheet" href="tailwind.css">
${SCRIPT_TEMA}
</head>
<body class="flex min-h-full flex-col bg-fondo text-texto">
<header class="sticky top-0 z-10 border-b border-borde bg-superficie/85 backdrop-blur">
  <div class="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
    <a href="." class="flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden="true">🗄️</span><span>RemoteMongo</span>
    </a>
    <div class="flex items-center gap-3 text-sm">
      ${nav ? `<nav class="flex flex-wrap items-center gap-3">${nav}</nav>` : ''}
      <button id="tema" type="button" aria-label="Cambiar de tema"
              class="rounded-lg border border-borde px-2 py-1 text-base leading-none hover:border-acento">🌙</button>
    </div>
  </div>
</header>
<main class="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10">
${cuerpo}
</main>
<footer class="mx-auto w-full max-w-3xl px-4 pb-8 text-center text-xs text-tenue">
  RemoteMongo · remoteStorage sobre MongoDB
</footer>
${SCRIPT_BOTON_TEMA}
</body></html>`;
  return relativizar(html);
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
      <div class="mx-auto max-w-md text-center">
        <div class="text-5xl">🎉</div>
        <h1 class="mt-3 text-2xl font-semibold">Ya está instalado</h1>
        <p class="mt-1 text-tenue">Entra con la cuenta de administración que acabas de crear.</p>
        <div class="caja mt-6 text-left">
          <p class="text-sm">El servidor está escuchando y los datos se guardan cifrados.</p>
          <a class="boton-principal mt-4 w-full" href="/entrar">Entrar</a>
        </div>
      </div>`, { raiz });
  }

  return pagina('Instalar', `
    <div class="mb-6 text-center sm:mb-8">
      <div class="text-4xl">⚙️</div>
      <h1 class="mt-2 text-2xl font-semibold sm:text-3xl">Primera configuración</h1>
      <p class="mt-1 text-sm text-tenue">Se rellena una vez y queda guardado en el servidor.</p>
    </div>

    ${error ? `<div role="alert" class="mb-4 flex gap-2 rounded-caja border border-peligro/40 bg-peligro/10 px-4 py-3 text-sm text-peligro">
      <span aria-hidden="true">⚠️</span><span>${esc(error)}</span></div>` : ''}

    <form method="post" action="/instalar" class="space-y-4" novalidate>
      <section class="caja">
        <h2 class="mb-4 flex items-center gap-2 text-base font-semibold">
          <span class="paso">1</span> Base de datos
        </h2>
        <div class="space-y-4">
          <div>
            <label class="etiqueta" for="mongoUrl">Ruta a MongoDB</label>
            <input class="campo font-mono" id="mongoUrl" name="mongoUrl" required autocomplete="off"
                   spellcheck="false" value="${esc(valores.mongoUrl || 'mongodb://127.0.0.1:27017')}"
                   placeholder="mongodb://usuario:clave@127.0.0.1:27017/remotemongo?authSource=remotemongo">
            <p class="ayuda">Con usuario y base de autenticación si los tiene. Se comprueba antes de guardar.</p>
          </div>
          <div class="sm:max-w-xs">
            <label class="etiqueta" for="mongoDb">Base de datos</label>
            <input class="campo font-mono" id="mongoDb" name="mongoDb" value="${esc(valores.mongoDb || 'remotemongo')}">
          </div>
        </div>
      </section>

      <section class="caja">
        <h2 class="mb-4 flex items-center gap-2 text-base font-semibold">
          <span class="paso">2</span> Servidor
        </h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="etiqueta" for="dominio">Dominio público</label>
            <div class="flex">
              <span class="flex items-center rounded-l-lg border border-r-0 border-borde bg-superficie-2 px-3 text-sm text-tenue">@</span>
              <input class="campo rounded-l-none font-mono" id="dominio" name="dominio" required
                     value="${esc(valores.dominio || '')}" placeholder="remotemongo.eines.net">
            </div>
            <p class="ayuda">Lo que va detrás de la <span class="mono">@</span> de cada usuario.</p>
          </div>
          <div>
            <label class="etiqueta" for="rutaBase">Ruta de instalación</label>
            <div class="flex">
              <span class="flex items-center rounded-l-lg border border-r-0 border-borde bg-superficie-2 px-3 text-sm text-tenue">/</span>
              <input class="campo rounded-l-none font-mono" id="rutaBase" name="rutaBase"
                     value="${esc((valores.rutaBase || '').replace(/^\//, ''))}" placeholder="remotemongo">
            </div>
            <p class="ayuda">En blanco, la raíz del dominio. Si la publicas en
              <span class="mono">/remotemongo/</span>, escribe <span class="mono">remotemongo</span>.</p>
          </div>
          <div class="sm:col-span-2">
            <label class="flex items-center gap-3 text-sm">
              <input type="checkbox" name="https" id="https" ${valores.https === false ? '' : 'checked'}
                     class="size-4 rounded border-borde accent-[var(--tono-acento)]">
              <span>Va detrás de un proxy con TLS</span>
            </label>
            <p class="ayuda">Recomendado: el protocolo exige HTTPS en producción.</p>
          </div>
        </div>
      </section>

      <section class="caja">
        <h2 class="mb-4 flex items-center gap-2 text-base font-semibold">
          <span class="paso">3</span> Cuenta de administración
        </h2>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="sm:col-span-2">
            <label class="etiqueta" for="admin">Usuario</label>
            <input class="campo font-mono sm:max-w-xs" id="admin" name="admin" required
                   pattern="[a-z0-9][a-z0-9._-]{1,31}" autocomplete="username"
                   value="${esc(valores.admin || '')}" placeholder="adela">
          </div>
          <div>
            <label class="etiqueta" for="clave">Contraseña</label>
            <input class="campo" id="clave" type="password" name="clave" required minlength="8"
                   autocomplete="new-password">
            <p class="ayuda">Mínimo 8 caracteres.</p>
          </div>
          <div>
            <label class="etiqueta" for="clave2">Repite la contraseña</label>
            <input class="campo" id="clave2" type="password" name="clave2" required minlength="8"
                   autocomplete="new-password">
          </div>
        </div>
      </section>

      <div class="flex justify-end pt-2">
        <button class="boton-principal w-full sm:w-auto sm:px-8">Instalar</button>
      </div>
    </form>`, { raiz });
}

/* ------------------------------------------------------------------ entrada */
export function entrar({ error = '', abierto = true, aviso = '', raiz = '' } = {}) {
  return pagina('Entrar', `
    <div class="mx-auto max-w-sm">
      <h1 class="mb-4 text-2xl font-semibold">Entrar</h1>
      <div class="caja">
        ${aviso ? `<div class="mb-3 rounded-lg border border-exito/40 bg-exito/10 px-3 py-2 text-sm text-exito">${esc(aviso)}</div>` : ''}
        ${error ? `<div class="mb-3 rounded-lg border border-peligro/40 bg-peligro/10 px-3 py-2 text-sm text-peligro">${esc(error)}</div>` : ''}
        <form method="post" action="/entrar" class="space-y-4">
          <div>
            <label class="etiqueta" for="usuario">Usuario</label>
            <input class="campo font-mono" id="usuario" name="usuario" required autocomplete="username">
          </div>
          <div>
            <label class="etiqueta" for="clave">Contraseña</label>
            <input class="campo" id="clave" type="password" name="clave" required autocomplete="current-password">
          </div>
          <button class="boton-principal w-full">Entrar</button>
        </form>
        ${abierto ? '<p class="mt-4 text-sm text-tenue">¿No tienes cuenta? <a class="boton-enlace text-acento" href="/alta">Crear una</a></p>' : ''}
      </div>
    </div>`, { raiz });
}

export function alta({ abierto = true, error = '', creada = null, raiz = '' } = {}) {
  if (creada) {
    return pagina('Cuenta creada', `
      <div class="mx-auto max-w-lg">
        <div class="mb-4 text-center">
          <div class="text-4xl">✅</div>
          <h1 class="mt-2 text-2xl font-semibold">Cuenta creada</h1>
          <p class="mt-1 text-sm text-tenue">Estos son tus datos. La dirección es lo que se pone en las apps.</p>
        </div>
        <div class="caja">
          <p class="etiqueta">Dirección</p>
          <div class="dato mb-4">${esc(creada.direccion)}</div>
          <p class="etiqueta">Endpoint</p>
          <div class="dato mb-5">${esc(creada.endpoint)}</div>
          <a class="boton-principal w-full" href="/panel">Ir a mi panel</a>
        </div>
      </div>`, { raiz });
  }
  if (!abierto) {
    return pagina('Registro cerrado', `
      <div class="mx-auto max-w-md text-center">
        <h1 class="text-2xl font-semibold">Registro cerrado</h1>
        <p class="mt-1 text-sm text-tenue">Este servidor no acepta cuentas nuevas ahora mismo.</p>
        <div class="caja mt-6">
          <a class="boton-suave w-full" href="/entrar">Entrar</a>
        </div>
      </div>`, { raiz });
  }
  return pagina('Crear cuenta', `
    <div class="mx-auto max-w-sm">
      <h1 class="mb-4 text-2xl font-semibold">Crear cuenta</h1>
      <div class="caja">
        ${error ? `<div class="mb-3 rounded-lg border border-peligro/40 bg-peligro/10 px-3 py-2 text-sm text-peligro">${esc(error)}</div>` : ''}
        <form method="post" action="/alta" class="space-y-4">
          <div>
            <label class="etiqueta" for="usuario">Usuario</label>
            <input class="campo font-mono" id="usuario" name="usuario" required
                   pattern="[a-z0-9][a-z0-9._-]{1,31}" placeholder="adela" autocomplete="username">
            <p class="ayuda">Minúsculas, números, punto, guion y guion bajo.</p>
          </div>
          <div>
            <label class="etiqueta" for="clave">Contraseña</label>
            <input class="campo" id="clave" type="password" name="clave" required minlength="8"
                   autocomplete="new-password">
            <p class="ayuda">Mínimo 8 caracteres.</p>
          </div>
          <button class="boton-principal w-full">Crear cuenta</button>
        </form>
        <p class="mt-4 text-sm text-tenue">¿Ya la tienes? <a class="boton-enlace text-acento" href="/entrar">Entrar</a></p>
      </div>
    </div>`, { raiz });
}

/* ------------------------------------------------- paneles (Vue 3, sin build) */

/** Vue 3 desde CDN; si no hay red, cae al fichero que sirve el propio servidor. */
const VUE_CDN = 'https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js';
const VUE = `<script src="${VUE_CDN}"></script>
<script>window.Vue || document.write('<script src="vue.global.prod.js"><\\/script>');</script>`;

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

/** Panel de cada persona. Los datos llegan de api/panel; las acciones son formularios. */
export function panelUsuario({ rol = 'usuario', raiz = '' } = {}) {
  const nav = `${rol === 'admin' ? '<a class="text-acento" href="/admin">Administración</a>' : ''}
    <a class="text-acento" href="/salir">Salir</a>`;
  return pagina('Mi panel', `
    ${VUE}
    <div id="app">
      <p v-if="!listo" class="text-sm text-tenue">Cargando…</p>
      <template v-else>
        <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold">Hola, {{ usuario }}</h1>
            <p class="mt-1 text-sm text-tenue">Cada almacén es un espacio aparte: sus carpetas, sus apps y su copia.</p>
          </div>
          <div class="min-w-[200px]">
            <div class="mb-1 text-xs uppercase tracking-wide text-tenue">Cuota de la cuenta</div>
            <div class="text-sm"><strong>{{ kb(usado) }}</strong> de <strong>{{ kb(cuota) }}</strong>
              <span class="text-tenue">({{ pct }} %)</span></div>
            <div class="barra mt-1"><div class="barra-llena" :class="clase" :style="{ width: pct + '%' }"></div></div>
          </div>
        </div>

        <section v-for="esp in espacios" :key="esp.espacio" class="caja mt-4">
          <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="text-xl" aria-hidden="true">{{ esp.espacio ? '📁' : '🏠' }}</span>
              <div>
                <h2 class="font-semibold">{{ esp.espacio ? 'Almacén «' + esp.espacio + '»' : 'Almacén por defecto' }}</h2>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="mono text-sm text-tenue">{{ esp.direccion }}</span>
                  <button type="button" class="boton-suave px-2 py-0.5 text-xs"
                          @click="copiar(esp.direccion, 'dir-' + esp.espacio)"
                          :title="'Copiar ' + esp.direccion">
                    {{ copiado['dir-' + esp.espacio] ? '✅ Copiada' : '📋 Copiar dirección' }}</button>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="pastilla">{{ kb(esp.usado) }}</span>
              <form v-if="esp.espacio" method="post" action="/panel/espacio" class="m-0"
                    onsubmit="return confirm('Se borrará este almacén y todo lo que tenga dentro. ¿Seguro?')">
                <input type="hidden" name="accion" value="borrar">
                <input type="hidden" name="espacio" :value="esp.espacio">
                <button class="boton-peligro px-3 py-1 text-xs">Borrar</button>
              </form>
            </div>
          </div>

          <p class="etiqueta">Endpoint para las apps</p>
          <div class="mb-5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div class="dato flex-1">{{ esp.endpoint }}</div>
            <button type="button" class="boton-suave px-3 py-1 text-xs sm:py-0"
                    @click="copiar(esp.endpoint, 'ep-' + esp.espacio)">
              {{ copiado['ep-' + esp.espacio] ? '✅ Copiado' : '📋 Copiar' }}</button>
          </div>

          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-tenue">
            Aplicaciones conectadas ({{ esp.apps.length }})</h3>
          <p v-if="!esp.apps.length" class="mb-4 text-sm text-tenue">Ninguna app conectada a este almacén.</p>
          <ul class="mb-5 divide-y divide-borde">
            <li v-for="a in esp.apps" :key="a.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="text-sm">{{ a.app }}</strong>
                <span class="pastilla mono">{{ a.scope }}</span>
                <span class="text-xs text-tenue">desde {{ fecha(a.creado) }}</span>
              </div>
              <form method="post" action="/panel/revocar" class="m-0">
                <input type="hidden" name="id" :value="a.id">
                <button class="boton-peligro px-3 py-1 text-xs">Desconectar</button>
              </form>
            </li>
          </ul>

          <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-tenue">Lo que ocupa</h3>
          <div class="flex flex-wrap gap-2">
            <span v-for="c in esp.categorias" :key="c.categoria" class="pastilla mono">
              {{ c.categoria }} · {{ c.documentos }} doc · {{ kb(c.bytes) }}</span>
            <span v-if="!esp.categorias.length" class="text-sm text-tenue">Sin datos guardados.</span>
          </div>

          <a class="boton-suave mt-4 text-xs" :href="'panel/respaldo' + (esp.espacio ? '?espacio=' + esp.espacio : '')">
            Descargar copia (JSON)</a>
        </section>

        <section class="caja mt-4">
          <h2 class="font-semibold">Crear otro almacén</h2>
          <p class="mt-1 text-sm text-tenue">Para separar, por ejemplo, el quemo de casa del del trabajo: mismos
            permisos, datos distintos. Su dirección sería
            <span class="mono">{{ usuario }}+nombre@{{ dominio }}</span>.</p>
          <form method="post" action="/panel/espacio" class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="sm:max-w-xs">
              <label class="etiqueta" for="espacio">Nombre del almacén</label>
              <input class="campo font-mono" id="espacio" name="espacio" required
                     pattern="[a-z0-9][a-z0-9._-]{0,31}" placeholder="trabajo">
            </div>
            <button class="boton-principal">Crear almacén</button>
          </form>
        </section>
      </template>
    </div>
    <script>
    ${AYUDAS}
    Vue.createApp({
      data: () => ({ listo: false, usuario: '', rol: 'usuario', dominio: '',
        espacios: [], usado: 0, cuota: 0, copiado: {} }),
      computed: {
        pct() { return this.cuota > 0 ? Math.min(100, Math.round((this.usado / this.cuota) * 100)) : 0; },
        clase() { return this.pct >= 100 ? 'llena' : this.pct >= 90 ? 'apurado' : ''; },
      },
      methods: {
        kb, fecha,
        async copiar(texto, clave) {
          try {
            await navigator.clipboard.writeText(texto);
          } catch (e) {
            // sin permiso de portapapeles (o sin HTTPS): se copia con un campo temporal
            const campo = document.createElement('textarea');
            campo.value = texto; campo.style.position = 'fixed'; campo.style.opacity = '0';
            document.body.appendChild(campo); campo.select();
            try { document.execCommand('copy'); } catch (e2) { /* nada */ }
            campo.remove();
          }
          this.copiado = { ...this.copiado, [clave]: true };
          setTimeout(() => { this.copiado = { ...this.copiado, [clave]: false }; }, 1800);
        },
      },
      async mounted() {
        try {
          const r = await fetch('api/panel', { credentials: 'same-origin' });
          if (r.ok) Object.assign(this, await r.json());
        } finally { this.listo = true; }
      },
    }).mount('#app');
    </script>`,
  { nav, raiz });
}

/** Administración: solo metadatos. Datos de api/admin; acciones por formulario. */
export function panelAdmin({ error = '', raiz = '' } = {}) {
  return pagina('Administración', `
    ${VUE}
    <div id="app">
      <p v-if="!listo" class="text-sm text-tenue">Cargando…</p>
      <template v-else>
        <div class="mb-5">
          <h1 class="text-2xl font-semibold">Administración</h1>
          <p class="mt-1 text-sm text-tenue">Esto es solo <strong>metadatos</strong>: apps conectadas y espacio
            ocupado. El contenido de las cuentas no se puede leer desde aquí.</p>
        </div>

        <div v-if="error" class="mb-4 rounded-lg border border-peligro/40 bg-peligro/10 px-3 py-2 text-sm text-peligro">
          {{ error }}</div>

        <section class="caja overflow-x-auto">
          <table class="tabla">
            <thead>
              <tr><th>Usuario</th><th>Estado</th><th class="text-right">Apps</th>
                <th class="text-right">Ocupa / cuota</th><th></th></tr>
            </thead>
            <tbody>
              <template v-for="u in usuarios" :key="u.usuario">
                <tr>
                  <td class="font-mono">
                    {{ u.usuario }}
                    <span v-if="u.rol === 'admin'" class="pastilla ml-1">admin</span>
                  </td>
                  <td>
                    <span class="pastilla" :class="u.activo === false ? 'pastilla-mal' : 'pastilla-bien'">
                      {{ u.activo === false ? 'desactivada' : 'activa' }}</span>
                  </td>
                  <td class="text-right">{{ u.apps.length }}</td>
                  <td class="text-right">
                    <div class="font-mono text-xs">{{ kb(u.totalBytes) }} de {{ kb(u.cuota) }}</div>
                    <form method="post" action="/admin/cuota" class="mt-1 flex items-center justify-end gap-1">
                      <input type="hidden" name="usuario" :value="u.usuario">
                      <input class="campo w-20 px-2 py-1 text-right text-xs" name="mb" inputmode="decimal"
                             :placeholder="u.cuotaPropia ? 'base' : Math.round(u.cuota / 1048576)"
                             title="Cuota en MB. Vacío o «base» = la cuota del servidor">
                      <button class="boton-suave px-2 py-1 text-xs">MB</button>
                    </form>
                    <div class="mt-1 text-[0.7rem] text-tenue">
                      {{ u.cuotaPropia ? 'cuota propia' : 'cuota del servidor' }}</div>
                  </td>
                  <td class="text-right">
                    <form method="post" action="/admin/estado" class="m-0">
                      <input type="hidden" name="usuario" :value="u.usuario">
                      <input type="hidden" name="activo" :value="u.activo === false ? '1' : '0'">
                      <button class="boton-suave px-2 py-1 text-xs">
                        {{ u.activo === false ? 'Activar' : 'Desactivar' }}</button>
                    </form>
                  </td>
                </tr>
                <tr>
                  <td colspan="5" class="border-t-0 pt-0">
                    <div class="mb-1 text-xs text-tenue">Almacenes:
                      <span v-for="e in u.espacios" :key="e.espacio" class="pastilla mono">
                        {{ e.espacio || '(por defecto)' }} · {{ kb(e.usado) }} · {{ e.apps }} app(s)</span>
                    </div>
                    <div v-if="u.apps.length" class="text-xs text-tenue">Apps:
                      <span v-for="a in u.apps" :key="a.id" class="pastilla">
                        {{ a.app }} · {{ a.scope }}
                        <form method="post" action="/admin/revocar" class="ml-1 inline">
                          <input type="hidden" name="usuario" :value="u.usuario">
                          <input type="hidden" name="id" :value="a.id">
                          <button class="boton-enlace text-peligro">desconectar</button>
                        </form>
                      </span>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="!usuarios.length"><td colspan="5" class="text-tenue">Sin cuentas</td></tr>
            </tbody>
          </table>
        </section>

        <section class="caja mt-4">
          <h2 class="font-semibold">Cuota de espacio por defecto</h2>
          <p class="mt-1 text-sm text-tenue">Lo que puede ocupar cada cuenta que no tenga una cuota propia.
            Ahora mismo: <strong>{{ kb(config.cuotaBase) }}</strong>.</p>
          <form method="post" action="/admin/cuota-base" class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="sm:max-w-[10rem]">
              <label class="etiqueta" for="mb">MB por cuenta</label>
              <input class="campo font-mono" id="mb" name="mb" inputmode="decimal"
                     :value="Math.round(config.cuotaBase / 1048576)" required>
            </div>
            <button class="boton-suave">Guardar</button>
          </form>
          <p class="ayuda mt-2">Cambiarla no borra nada: si alguien ya ocupa más, no podrá guardar cosas
            nuevas hasta bajar de su nuevo límite.</p>
        </section>

        <section class="caja mt-4">
          <h2 class="font-semibold">Cifrado en reposo</h2>
          <template v-if="config.cifrado">
            <p class="mt-2"><span class="pastilla pastilla-bien">activo</span>
              <span class="ml-1 text-sm">AES-256-GCM</span></p>
            <p class="mt-2 text-sm text-tenue">Los cuerpos se guardan cifrados en MongoDB con una clave que vive en
              <span class="mono">state/instalacion.json</span>, fuera de la base. Quien tenga un dump o un backup de
              Mongo ve rutas, tamaños y fechas, pero <strong class="text-texto">no el contenido</strong>.</p>
          </template>
          <template v-else>
            <p class="mt-2"><span class="pastilla pastilla-mal">inactivo</span></p>
            <p class="mt-2 text-sm text-tenue">Sin clave los cuerpos se guardan en claro. Define
              <span class="mono">RM_CLAVE_CIFRADO</span> (32 bytes en base64) o instala desde cero.</p>
          </template>
        </section>

        <section class="caja mt-4">
          <h2 class="font-semibold">Registro</h2>
          <p class="mt-1 text-sm text-tenue">Ahora mismo:
            <strong>{{ config.registroAbierto ? 'abierto' : 'cerrado' }}</strong></p>
          <form method="post" action="/admin/registro" class="mt-4">
            <input type="hidden" name="abierto" :value="config.registroAbierto ? '0' : '1'">
            <button class="boton-suave">
              {{ config.registroAbierto ? 'Cerrar el registro' : 'Abrir el registro' }}</button>
          </form>
        </section>
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
          const r = await fetch('api/admin', { credentials: 'same-origin' });
          if (r.ok) { const d = await r.json(); this.usuarios = d.usuarios; this.config = d.config; }
        } finally { this.listo = true; }
      },
    }).mount('#app');
    </script>`,
  { nav: '<a class="text-acento" href="/panel">Mi panel</a><a class="text-acento" href="/salir">Salir</a>', raiz });
}

/* ------------------------------------------------------------- permiso OAuth */
export function permiso({ usuario, scope, permisos, app, redirect, estado, reto, metodo, espacio = '', almacenNuevo = false, raiz = '' }) {
  return pagina('Permiso', `
    <div class="mx-auto max-w-lg">
      <div class="caja">
        <h1 class="text-xl font-semibold">Permiso para ${esc(app)}</h1>
        <p class="mt-1 text-sm text-tenue">La aplicación quiere acceder a tu cuenta
          <strong class="text-texto">${esc(usuario)}</strong> en:</p>
        ${almacenNuevo ? `<div class="mt-3 rounded-lg border border-acento/40 bg-acento/10 px-3 py-2 text-sm text-acento">
          El almacén <span class="mono">${esc(espacio)}</span> todavía no existe: si permites, se crea ahora
          y queda vacío, aparte del resto.</div>` : ''}
        <ul class="mt-3 space-y-1">
          ${permisos.map((p) => `<li class="mono rounded-lg bg-superficie-2 px-3 py-2 text-sm">${esc(p)}</li>`).join('')}
        </ul>
        <form method="post" action="/oauth/${esc(usuario)}" class="mt-5 space-y-4">
          <input type="hidden" name="scope" value="${esc(scope)}">
          <input type="hidden" name="redirect" value="${esc(redirect)}">
          <input type="hidden" name="estado" value="${esc(estado)}">
          <input type="hidden" name="reto" value="${esc(reto)}">
          <input type="hidden" name="metodo" value="${esc(metodo)}">
          <input type="hidden" name="app" value="${esc(app)}">
          <div>
            <label class="etiqueta" for="clave">Tu contraseña</label>
            <input class="campo" id="clave" type="password" name="clave" required autocomplete="current-password">
          </div>
          <div class="flex flex-col gap-2 sm:flex-row">
            <button class="boton-principal flex-1">Permitir</button>
            <a class="boton-suave" href="/">Cancelar</a>
          </div>
        </form>
      </div>
    </div>`, { raiz });
}

export function avisoPagina({ titulo, texto, enlace = '/', boton = 'Volver', raiz = '' }) {
  return pagina(titulo, `
    <div class="mx-auto max-w-md">
      <div class="caja text-center">
        <h1 class="text-xl font-semibold">${esc(titulo)}</h1>
        <p class="mt-1 text-sm text-tenue">${esc(texto)}</p>
        <a class="boton-principal mt-5 w-full" href="${enlace}">${boton}</a>
      </div>
    </div>`, { raiz });
}

export { kb, esc };
