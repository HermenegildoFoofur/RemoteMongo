/** Páginas del servidor: instalación, entrada, panel de usuario y administración. */

const CSS = `body{background:#0f1115;color:#e7ecf3}
.caja{max-width:760px;margin:5vh auto 4vh;padding:0 14px}
.tarjeta{background:#171a21;border:1px solid #262b36;border-radius:14px;padding:22px;margin-bottom:18px}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dato{background:#0f1115;border:1px solid #262b36;border-radius:10px;padding:10px 12px;word-break:break-all}
h1{font-size:1.5rem}h2{font-size:1.1rem;color:#b9c6d8}
.tenue{color:#93a0b4}a{color:#6fb1ff}
.pastilla{display:inline-block;background:#0f1115;border:1px solid #262b36;border-radius:999px;padding:2px 10px;font-size:.8rem;margin:0 6px 6px 0}
.mal{background:#3a1d1d;border-color:#7a2e2e;color:#ffd9d9}
.bien{background:#17301f;border-color:#2e6b43;color:#d8ffe4}
.barra{background:#0f1115;border:1px solid #262b36;border-radius:999px;height:10px;overflow:hidden;margin:8px 0}
.barra-llena{height:100%;background:#3b6fe0}
.barra-llena.apurado{background:#c9a227}
.barra-llena.llena{background:#a13b3b}`;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const kb = (bytes) => {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

function pagina(titulo, cuerpo, { nav = null } = {}) {
  return `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} · RemoteMongo</title>
<link rel="stylesheet" href="/bootstrap.min.css"><style>${CSS}</style></head><body>
<div class="caja">
${nav ? `<div class="d-flex justify-content-between align-items-center mb-3">
  <strong>RemoteMongo</strong>
  <div class="tenue">${nav}</div>
</div>` : ''}
${cuerpo}
<p class="tenue text-center mt-4" style="font-size:.8rem">RemoteMongo · remoteStorage sobre MongoDB</p>
</div></body></html>`;
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
export function instalar({ valores = {}, error = '', paso = 'formulario' } = {}) {
  if (paso === 'hecho') {
    return pagina('Instalado', `<div class="tarjeta">
      <h1>Ya está instalado 🎉</h1>
      <p class="tenue">Entra con la cuenta de administración que acabas de crear.</p>
      <a class="btn btn-primary" href="/entrar">Entrar</a>
    </div>`);
  }
  return pagina('Instalar', `<div class="tarjeta">
    <h1>Primera configuración</h1>
    <p class="tenue">Como en WordPress: se rellena una vez y queda guardado en el servidor.</p>
    ${error ? `<div class="alert alert-danger py-2">${esc(error)}</div>` : ''}
    <form method="post" action="/instalar">
      <h2 class="mt-3">Base de datos</h2>
      <label class="form-label">Ruta a MongoDB</label>
      <input class="form-control mono" name="mongoUrl" required
             value="${esc(valores.mongoUrl || 'mongodb://127.0.0.1:27017')}"
             placeholder="mongodb://usuario:clave@127.0.0.1:27017/remotemongo?authSource=remotemongo">
      <label class="form-label mt-2">Base de datos</label>
      <input class="form-control mono" name="mongoDb" value="${esc(valores.mongoDb || 'remotemongo')}">

      <h2 class="mt-4">Servidor</h2>
      <label class="form-label">Dominio público (sin https://)</label>
      <input class="form-control mono" name="dominio" required
             value="${esc(valores.dominio || '')}" placeholder="remotemongo.eines.net">
      <div class="form-check mt-2">
        <input class="form-check-input" type="checkbox" name="https" id="https" ${valores.https === false ? '' : 'checked'}>
        <label class="form-check-label" for="https">Va detrás de un proxy con TLS (recomendado)</label>
      </div>

      <h2 class="mt-4">Cuenta de administración</h2>
      <label class="form-label">Usuario</label>
      <input class="form-control mono" name="admin" required pattern="[a-z0-9][a-z0-9._-]{1,31}"
             value="${esc(valores.admin || '')}" placeholder="adela">
      <label class="form-label mt-2">Contraseña (mínimo 8)</label>
      <input class="form-control" type="password" name="clave" required minlength="8">
      <label class="form-label mt-2">Repite la contraseña</label>
      <input class="form-control" type="password" name="clave2" required minlength="8">
      <button class="btn btn-primary mt-3">Instalar</button>
    </form>
  </div>`);
}

/* ------------------------------------------------------------------ entrada */
export function entrar({ error = '', abierto = true, aviso = '' } = {}) {
  return pagina('Entrar', `<div class="tarjeta">
    <h1>Entrar</h1>
    ${aviso ? `<div class="alert alert-success py-2">${esc(aviso)}</div>` : ''}
    ${error ? `<div class="alert alert-danger py-2">${esc(error)}</div>` : ''}
    <form method="post" action="/entrar">
      <label class="form-label">Usuario</label>
      <input class="form-control mono" name="usuario" required autocomplete="username">
      <label class="form-label mt-2">Contraseña</label>
      <input class="form-control" type="password" name="clave" required autocomplete="current-password">
      <button class="btn btn-primary mt-3">Entrar</button>
    </form>
    ${abierto ? '<p class="mt-3 tenue">¿No tienes cuenta? <a href="/alta">Crear una</a></p>' : ''}
  </div>`);
}

export function alta({ abierto = true, error = '', creada = null } = {}) {
  if (creada) {
    return pagina('Cuenta creada', `<div class="tarjeta">
      <h1>Cuenta creada</h1>
      <p class="tenue">Estos son tus datos. La dirección es lo que se pone en las apps.</p>
      <p class="mb-1">Dirección</p>
      <div class="dato mono">${esc(creada.direccion)}</div>
      <p class="mt-3 mb-1">Endpoint</p>
      <div class="dato mono">${esc(creada.endpoint)}</div>
      <a class="btn btn-primary mt-3" href="/panel">Ir a mi panel</a>
    </div>`);
  }
  if (!abierto) {
    return pagina('Registro cerrado', `<div class="tarjeta"><h1>Registro cerrado</h1>
      <p class="tenue">Este servidor no acepta cuentas nuevas ahora mismo.</p>
      <a class="btn btn-secondary" href="/entrar">Entrar</a></div>`);
  }
  return pagina('Crear cuenta', `<div class="tarjeta">
    <h1>Crear cuenta</h1>
    ${error ? `<div class="alert alert-danger py-2">${esc(error)}</div>` : ''}
    <form method="post" action="/alta">
      <label class="form-label">Usuario</label>
      <input class="form-control mono" name="usuario" required pattern="[a-z0-9][a-z0-9._-]{1,31}"
             placeholder="adela" autocomplete="username">
      <label class="form-label mt-2">Contraseña (mínimo 8)</label>
      <input class="form-control" type="password" name="clave" required minlength="8" autocomplete="new-password">
      <button class="btn btn-primary mt-3">Crear cuenta</button>
    </form>
    <p class="mt-3 tenue">¿Ya la tienes? <a href="/entrar">Entrar</a></p>
  </div>`);
}

/* ------------------------------------------------------------ panel usuario */
export function panelUsuario({ usuario, rol, dominio, endpoint, metadatos, cuota = 0 }) {
  const usado = Number(metadatos.totalBytes) || 0;
  const tope = Number(cuota) || 0;
  const pct = tope > 0 ? Math.min(100, Math.round((usado / tope) * 100)) : 0;
  const resto = Math.max(0, tope - usado);
  const clase = pct >= 100 ? ' llena' : pct >= 90 ? ' apurado' : '';
  const apps = metadatos.apps.length
    ? metadatos.apps.map((a) => `<div class="d-flex justify-content-between align-items-center border-top pt-2 mt-2">
        <div><strong>${esc(a.app)}</strong><br><span class="pastilla mono">${esc(a.scope)}</span>
        <span class="tenue" style="font-size:.8rem">desde ${esc((a.creado || '').slice(0, 10))}</span></div>
        <form method="post" action="/panel/revocar" class="m-0">
          <input type="hidden" name="token" value="${esc(a.token)}">
          <button class="btn btn-sm btn-outline-danger">Desconectar</button>
        </form>
      </div>`).join('')
    : '<p class="tenue mt-2">Ninguna app conectada todavía.</p>';

  const categorias = metadatos.categorias.length
    ? metadatos.categorias.map((c) => `<span class="pastilla mono">${esc(c.categoria)} · ${c.documentos} doc · ${kb(c.bytes)}</span>`).join('')
    : '<span class="tenue">Sin datos guardados.</span>';

  return pagina('Mi panel', `
    <div class="tarjeta">
      <h1>Hola, ${esc(usuario)}</h1>
      <p class="tenue">Tu dirección es lo que pones en las apps:</p>
      <div class="dato mono">${esc(usuario)}@${esc(dominio)}</div>
      <p class="mt-2 mb-1 tenue">Y tu endpoint, para apps que no hablan WebFinger:</p>
      <div class="dato mono">${esc(endpoint)}</div>
    </div>
    <div class="tarjeta">
      <h2>Aplicaciones conectadas (${metadatos.apps.length})</h2>
      ${apps}
    </div>
    <div class="tarjeta">
      <h2>Lo que ocupas</h2>
      <p class="mb-1"><strong>${kb(usado)}</strong> de <strong>${kb(tope)}</strong>
        <span class="tenue">(${pct} %)</span></p>
      <div class="barra"><div class="barra-llena${clase}" style="width:${pct}%"></div></div>
      <p class="tenue" style="font-size:.85rem">Te quedan <strong>${kb(resto)}</strong>.
        Si se llena, las apps reciben un aviso y no se guarda nada más hasta que borres algo.</p>
      ${categorias}
      <p class="mt-3 mb-0"><a class="btn btn-sm btn-outline-secondary" href="/panel/respaldo">Descargar copia (JSON)</a></p>
    </div>`,
  { nav: `${rol === 'admin' ? '<a href="/admin">Administración</a> · ' : ''}<a href="/salir">Salir</a>` });
}

/* --------------------------------------------------------- administración */
export function panelAdmin({ usuarios, config, mensaje = '', error = '' }) {
  const filas = usuarios.map((u) => `
    <tr>
      <td class="mono">${esc(u.usuario)}${u.rol === 'admin' ? ' <span class="pastilla">admin</span>' : ''}</td>
      <td>${u.activo === false ? '<span class="pastilla mal">desactivada</span>' : '<span class="pastilla bien">activa</span>'}</td>
      <td class="text-end">${u.apps.length}</td>
      <td class="text-end mono">${kb(u.totalBytes)} de ${kb(u.cuota)}
        <form method="post" action="/admin/cuota" class="m-0 d-inline-flex gap-1 mt-1">
          <input type="hidden" name="usuario" value="${esc(u.usuario)}">
          <input class="form-control form-control-sm mono text-end" style="width:80px" name="mb"
                 inputmode="decimal" placeholder="${u.cuotaPropia ? 'base' : (u.cuota / 1048576).toFixed(0)}"
                 title="Cuota en MB. Vacío o «base» = la cuota del servidor">
          <button class="btn btn-sm btn-outline-secondary">MB</button>
        </form>
        <div class="tenue" style="font-size:.75rem">${u.cuotaPropia ? 'cuota propia' : 'cuota del servidor'}</div>
      </td>
      <td class="text-end">
        <form method="post" action="/admin/estado" class="m-0 d-inline">
          <input type="hidden" name="usuario" value="${esc(u.usuario)}">
          <input type="hidden" name="activo" value="${u.activo === false ? '1' : '0'}">
          <button class="btn btn-sm btn-outline-secondary">${u.activo === false ? 'Activar' : 'Desactivar'}</button>
        </form>
      </td>
    </tr>
    ${u.apps.length ? `<tr><td colspan="5" class="pt-0">
      <div class="tenue" style="font-size:.85rem">Apps: ${u.apps.map((a) => `
        <span class="pastilla">${esc(a.app)} · ${esc(a.scope)}
          <form method="post" action="/admin/revocar" class="d-inline m-0">
            <input type="hidden" name="usuario" value="${esc(u.usuario)}">
            <input type="hidden" name="token" value="${esc(a.token)}">
            <button class="btn btn-link p-0 align-baseline" style="font-size:.8rem">desconectar</button>
          </form>
        </span>`).join('')}</div>
    </td></tr>` : ''}`).join('');

  return pagina('Administración', `
    ${mensaje ? `<div class="alert alert-success py-2">${esc(mensaje)}</div>` : ''}
    ${error ? `<div class="alert alert-danger py-2">${esc(error)}</div>` : ''}
    <div class="tarjeta">
      <h1>Administración</h1>
      <p class="tenue">Esto es solo <strong>metadatos</strong>: apps conectadas y espacio ocupado.
      El contenido de las cuentas no se puede leer desde aquí.</p>
      <table class="table table-dark table-sm align-middle">
        <thead><tr><th>Usuario</th><th>Estado</th><th class="text-end">Apps</th><th class="text-end">Ocupa / cuota</th><th></th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" class="tenue">Sin cuentas</td></tr>'}</tbody>
      </table>
    </div>
    <div class="tarjeta">
      <h2>Cuota de espacio por defecto</h2>
      <p class="tenue">Lo que puede ocupar cada cuenta que no tenga una cuota propia.
      Ahora mismo: <strong>${kb(config.cuotaBase)}</strong>.</p>
      <form method="post" action="/admin/cuota-base" class="d-flex gap-2 align-items-end">
        <div><label class="form-label" style="font-size:.85rem">MB por cuenta</label>
          <input class="form-control mono" name="mb" inputmode="decimal" style="width:120px"
                 value="${(config.cuotaBase / 1048576).toFixed(0)}" required></div>
        <button class="btn btn-sm btn-outline-secondary mb-1">Guardar</button>
      </form>
      <p class="tenue mt-2 mb-0" style="font-size:.85rem">Cambiarla no borra nada: si alguien ya ocupa
      más, no podrá guardar cosas nuevas hasta bajar de su nuevo límite.</p>
    </div>
    <div class="tarjeta">
      <h2>Registro</h2>
      <p class="tenue">Ahora mismo: <strong>${config.registroAbierto ? 'abierto' : 'cerrado'}</strong></p>
      <form method="post" action="/admin/registro" class="m-0">
        <input type="hidden" name="abierto" value="${config.registroAbierto ? '0' : '1'}">
        <button class="btn btn-sm btn-outline-secondary">${config.registroAbierto ? 'Cerrar el registro' : 'Abrir el registro'}</button>
      </form>
    </div>`,
  { nav: '<a href="/panel">Mi panel</a> · <a href="/salir">Salir</a>' });
}

/* ------------------------------------------------------------- permiso OAuth */
export function permiso({ usuario, scope, permisos, app, redirect, estado, reto, metodo }) {
  return pagina('Permiso', `<div class="tarjeta">
    <h1>Permiso para ${esc(app)}</h1>
    <p class="tenue">La aplicación quiere acceder a tu cuenta <strong>${esc(usuario)}</strong> en:</p>
    <ul>${permisos.map((p) => `<li class="mono">${esc(p)}</li>`).join('')}</ul>
    <form method="post" action="/oauth/${esc(usuario)}">
      <input type="hidden" name="scope" value="${esc(scope)}">
      <input type="hidden" name="redirect" value="${esc(redirect)}">
      <input type="hidden" name="estado" value="${esc(estado)}">
      <input type="hidden" name="reto" value="${esc(reto)}">
      <input type="hidden" name="metodo" value="${esc(metodo)}">
      <input type="hidden" name="app" value="${esc(app)}">
      <label class="form-label">Tu contraseña</label>
      <input class="form-control" type="password" name="clave" required autocomplete="current-password">
      <button class="btn btn-primary mt-3">Permitir</button>
      <a class="btn btn-link" href="/">Cancelar</a>
    </form>
  </div>`);
}

export function avisoPagina({ titulo, texto, enlace = '/', boton = 'Volver' }) {
  return pagina(titulo, `<div class="tarjeta"><h1>${esc(titulo)}</h1>
    <p class="tenue">${esc(texto)}</p><a class="btn btn-primary" href="${enlace}">${boton}</a></div>`);
}

export { kb, esc };
