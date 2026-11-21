/** Páginas HTML del servidor: portada, alta, permiso y panel. Bootstrap servido en local. */

const CABECERA = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RemoteMongo</title>
<link rel="stylesheet" href="/bootstrap.min.css">
<style>
  body { background:#0f1115; color:#e7ecf3; }
  .caja { max-width: 640px; margin: 6vh auto 4vh; }
  .tarjeta { background:#171a21; border:1px solid #262b36; border-radius:14px; padding:22px; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .dato { background:#0f1115; border:1px solid #262b36; border-radius:10px; padding:10px 12px; word-break:break-all; }
  h1 { font-size:1.6rem; }
  .tenue { color:#93a0b4; }
  a { color:#6fb1ff; }
</style>
</head><body><div class="caja">`;

const PIE = `</div></body></html>`;

export function respuesta(res, codigo, html) {
  res.writeHead(codigo, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

export function portada(config) {
  return `${CABECERA}
<div class="tarjeta">
  <h1>RemoteMongo</h1>
  <p class="tenue">Tu almacén de datos personal, hablando el protocolo remoteStorage y guardando en MongoDB.</p>
  <p>Una cuenta te da una <strong>dirección</strong> con la que las apps te identifican, y un
  <strong>endpoint</strong> donde se guardan tus datos, separados por aplicación.</p>
  <div class="dato mono">tu_usuario@${config.dominio}</div>
  <p class="mt-3"><a class="btn btn-primary" href="/alta">Crear cuenta</a></p>
  <hr>
  <p class="tenue mb-0">Conectar una app: en la app de remoteStorage pon esa dirección. Te pedirá
  permiso para una carpeta concreta (por ejemplo <code>quemo</code>) y podrás revocarlo cuando quieras.</p>
</div>
${PIE}`;
}

export function alta({ abierto, creada } = {}) {
  if (creada) {
    return `${CABECERA}
<div class="tarjeta">
  <h1>Cuenta creada</h1>
  <p class="tenue">Guarda estos dos datos. El primero es lo que ponen las apps.</p>
  <p class="mb-1">Dirección</p>
  <div class="dato mono">${creada.direccion}</div>
  <p class="mt-3 mb-1">Endpoint</p>
  <div class="dato mono">${creada.endpoint}</div>
  <p class="mt-3 tenue">También puedes darlo como <code>${creada.endpoint}</code> en apps que no
  hablan WebFinger.</p>
</div>
${PIE}`;
  }
  if (!abierto) {
    return `${CABECERA}<div class="tarjeta"><h1>Registro cerrado</h1>
    <p class="tenue">Este servidor no acepta cuentas nuevas ahora mismo.</p></div>${PIE}`;
  }
  return `${CABECERA}
<div class="tarjeta">
  <h1>Crear cuenta</h1>
  <form method="post" action="/alta">
    <label class="form-label mt-2">Usuario</label>
    <input class="form-control" name="usuario" required pattern="[a-z0-9][a-z0-9._-]{1,31}"
           placeholder="adela" autocomplete="username">
    <label class="form-label mt-3">Contraseña</label>
    <input class="form-control" type="password" name="clave" required minlength="8"
           autocomplete="new-password">
    <button class="btn btn-primary mt-3">Crear cuenta</button>
  </form>
</div>
${PIE}`;
}

export function permiso({ usuario, scope, permisos, app, redirect, estado, reto, metodo }) {
  return `${CABECERA}
<div class="tarjeta">
  <h1>Permiso para ${app}</h1>
  <p class="tenue">La aplicación quiere acceder a tu cuenta <strong>${usuario}</strong> en:</p>
  <ul>${permisos.map((p) => `<li class="mono">${p}</li>`).join('')}</ul>
  <form method="post" action="/oauth/${usuario}">
    <input type="hidden" name="scope" value="${escapar(scope)}">
    <input type="hidden" name="redirect" value="${escapar(redirect)}">
    <input type="hidden" name="estado" value="${escapar(estado)}">
    <input type="hidden" name="reto" value="${escapar(reto)}">
    <input type="hidden" name="metodo" value="${escapar(metodo)}">
    <input type="hidden" name="app" value="${escapar(app)}">
    <label class="form-label">Tu contraseña</label>
    <input class="form-control" type="password" name="clave" required autocomplete="current-password">
    <button class="btn btn-primary mt-3">Permitir</button>
    <a class="btn btn-link" href="/">Cancelar</a>
  </form>
</div>
${PIE}`;
}

export function panel({ usuarios, config }) {
  const filas = usuarios.length
    ? usuarios.map((u) => `<tr><td class="mono">${u.usuario}</td><td>${u.creado || ''}</td></tr>`).join('')
    : '<tr><td colspan="2" class="tenue">Sin cuentas todavía</td></tr>';
  return `${CABECERA}
<div class="tarjeta">
  <h1>Administración</h1>
  <p class="tenue">Usuarios de ${config.dominio}</p>
  <table class="table table-dark table-sm">
    <thead><tr><th>Usuario</th><th>Creado</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
</div>
${PIE}`;
}

const escapar = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
