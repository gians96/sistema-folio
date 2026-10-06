# Folio · Documentos en orden

Aplicación para cargar PDF, DOC y DOCX, organizar y foliar páginas, revisar el resultado y descargarlo como PDF. Cada persona entra con su cuenta de Google y guarda sus propios trabajos (por ejemplo "CAS 003" o "CV completo") para retomarlos cuando quiera. Usa React y TypeScript en `frontend/`, Express y TypeScript en `backend/`, y MySQL o MariaDB para usuarios, trabajos y configuración. Los archivos Word se convierten con LibreOffice.

## Inicio local en Windows

Necesitas Node.js 24, pnpm 11.1.2, una base **MySQL o MariaDB** (la de Laragon o una remota) y LibreOffice instalado. pnpm queda fijado en `package.json` y `pnpm-lock.yaml`.

1. Crea un ID de cliente OAuth de Google (ver [Acceso con Google](#acceso-con-google)).
2. Si todavía no existe `backend/.env`, copia el ejemplo:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```

3. En `backend/.env` completa `DATABASE_URL`, `GOOGLE_CLIENT_ID` y `OWNER_EMAIL` (tu correo de Google: serás el propietario). `DATABASE_URL` usa el esquema `mysql://` también con MariaDB; codifica en la URL los caracteres especiales de la contraseña. LibreOffice se detecta en `C:\Program Files\LibreOffice\program\soffice.com`; usa `SOFFICE_PATH` si está en otra ruta.
4. Desde la raíz del proyecto, ejecuta:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm dev
   ```

Abre **http://localhost:5173** y entra con Google. `pnpm dev` comprueba la base y LibreOffice, aplica las migraciones e inicia backend y frontend en la misma terminal. Para detenerlos, pulsa Ctrl+C. El usuario de la base solo necesita permisos sobre su propia base (incluidos CREATE, ALTER, INDEX y REFERENCES): las migraciones se aplican con `prisma migrate deploy`, que no crea bases auxiliares.

Si usas el MySQL de Laragon, `pnpm local:setup` crea la base y el usuario de `DATABASE_URL` y aplica la migración. Requiere que `root` pueda conectar por TCP sin contraseña; si tiene contraseña, define `LOCAL_MYSQL_ROOT_PASSWORD` en la sesión. Si el ejecutable de MySQL no está en la ruta detectada, define `MYSQL_PATH`.

```powershell
$env:LOCAL_MYSQL_ROOT_PASSWORD = 'tu-contraseña-de-root'  # Solo si Laragon la requiere
$env:MYSQL_PATH = 'C:\ruta\a\Laragon\bin\mysql\mysql.exe'  # Solo si no se detecta
pnpm local:setup
```

No guardes contraseñas en el repositorio. `backend/.env` está excluido del control de versiones. El backend guarda los originales, los PDF generados y la clave de las sesiones en `backend/data/`, también excluido. No apuntes el entorno local a la base de producción: los archivos de cada trabajo viven en el disco de quien lo creó.

## Uso

**Mis trabajos** lista tus trabajos guardados. Con **Nuevo trabajo** cargas uno o varios documentos; el trabajo toma el nombre del primer archivo y puedes renombrarlo con el lápiz. Organiza las páginas arrastrando sus miniaturas, gíralas a la izquierda o a la derecha, excluye las que no necesites y configura la foliación. Para añadir más páginas a un trabajo abierto, arrastra otros PDF, DOC o DOCX sobre el editor o usa **Añadir documento**; sus páginas se agregan al final y conservan la edición previa. Puedes elegir cualquiera de las cuatro esquinas, márgenes, color, tamaño, prefijo, dígitos y número inicial. También puedes definir una posición diferente por página. Las páginas conservadas sin folio consumen número; las excluidas no. Guarda con **Guardar** o Ctrl+S: el trabajo queda en tu cuenta hasta que lo elimines. La revisión final genera el PDF real y la descarga entrega exactamente ese archivo, con el nombre del trabajo. Una nueva edición invalida la revisión anterior.

Límites iniciales: 95 MB por archivo y 500 páginas. Un DOC o DOCX puede cambiar de distribución al convertirse con LibreOffice; revísalo antes de descargar. La aplicación no edita el texto original ni realiza OCR.

## Acceso con Google

1. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crea un **ID de cliente OAuth** de tipo **Aplicación web**.
2. En **Orígenes de JavaScript autorizados** agrega `http://localhost`, `http://localhost:5173` y la URL pública del frontend (p. ej. `https://folio.nube-tec.com`). No hace falta URI de redirección. Los cambios pueden tardar unos minutos en aplicarse.
3. En la pantalla de consentimiento elige usuarios **Externos** y pasa la app a **En producción**; en modo de prueba solo entran los usuarios de prueba que agregues.
4. Copia el ID (`….apps.googleusercontent.com`) en `GOOGLE_CLIENT_ID`.

Cualquier persona con cuenta de Google puede crear su cuenta en Folio. La cuenta cuyo correo coincide con `OWNER_EMAIL` es la del **propietario**: en **Administración** ve a todos los usuarios y sus trabajos, puede abrirlos o eliminarlos, aprobar, bloquear o eliminar cuentas, y cambiar la configuración:

- **Tamaño máximo por archivo** (95 MB al inicio; 0 = sin límite) y, si hace falta, un límite propio para cada usuario.
- **Registro de usuarios nuevos**: acceso inmediato (predeterminado) o con tu aprobación.

Bloquear una cuenta cierra su sesión de inmediato. El propietario no se puede bloquear ni eliminar.

La sesión es un JWT de 12 horas en una cookie `HttpOnly`, `SameSite=Strict` (y `Secure` en producción). La clave que lo firma se genera sola la primera vez en `DATA_DIR/.jwt-secret`; no va en el `.env` ni en la base. Para cerrar todas las sesiones, borra ese archivo y reinicia el backend.

## Estructura y comandos

```text
frontend/    React, Vite y PDF.js
backend/     Express, Prisma, MySQL/MariaDB y conversión de Word
shared/      Tipos y validación compartidos
tests/       Prueba de navegador
```

```powershell
pnpm local:check    # Comprueba la base, la configuración y LibreOffice
pnpm local:setup    # Crea base/usuario en Laragon y aplica migraciones
pnpm dev            # Inicia backend y frontend
pnpm build          # Compila los tres paquetes
pnpm test           # Pruebas del backend
pnpm test:e2e       # Prueba de navegador con servidor aislado de prueba
pnpm test:local     # PDF, DOC y DOCX con la base y LibreOffice reales; requiere pnpm dev activo y FOLIO_SESSION
```

Para instalar el navegador de Playwright la primera vez: `pnpm exec playwright install chromium`. `pnpm test:local` y `scripts/docker-smoke.mjs` necesitan una sesión iniciada: define `FOLIO_SESSION` con el valor de la cookie `folio_session` (DevTools > Aplicación > Cookies). Para añadir dependencias usa `pnpm --filter @folio/frontend add <paquete>`, `pnpm --filter @folio/backend add <paquete>` o `pnpm add -Dw <paquete>` en la raíz.

## Configuración

`backend/.env` admite `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `OWNER_EMAIL` (las tres obligatorias), `PORT` (3001), `DATA_DIR` (`./data` dentro de backend), `SOFFICE_PATH`, `MAX_PAGES` (500) y `CONVERSION_TIMEOUT_MS` (120000). El tamaño máximo por archivo y el modo de registro se cambian en **Administración** y se guardan en la base. Vite atiende en 5173 y envía `/api` a `http://localhost:3001`; puedes cambiar el destino con `API_PROXY`. En producción el frontend llama directamente a `API_URL` y el backend acepta los orígenes listados en `CORS_ORIGINS` (separados por comas). Si el puerto 5173 está ocupado, Vite avisará en lugar de cambiar de puerto silenciosamente.

La API requiere la cookie de sesión en todas las rutas salvo `/api/health`, `/api/auth/session` y `/api/auth/google`. `GET /api/jobs` lista los trabajos del usuario y `POST /api/jobs` (`multipart/form-data`, campo `file`) crea uno. Las rutas `/api/jobs/:id` (lectura, renombrar, PDF base, añadir documentos, guardado de configuración, revisión, vista previa, descarga y eliminación) solo responden al dueño del trabajo o al propietario. `/api/admin/*` es exclusiva del propietario. La base guarda usuarios, trabajos y configuración; los documentos quedan en disco. La aplicación usa una sola instancia de backend para su cola de conversiones y bloqueos.

## Despliegue en Contabo con Dokploy

Para producción usa `compose.prod.yaml` como servicio **Docker Compose** de Dokploy (no Docker Stack). La base MySQL o MariaDB es externa y se indica con `DATABASE_URL`. Frontend y API se publican en subdominios separados del mismo dominio, por ejemplo:

| Servicio   | Dominio                  | Puerto interno |
| ---------- | ------------------------ | -------------- |
| `frontend` | `folio.nube-tec.com`     | 8080           |
| `backend`  | `api-folio.nube-tec.com` | 3001           |

El frontend se compila como archivos estáticos servidos por Nginx y llama a la API en `API_URL` (Vite la incrusta al compilar). El backend solo acepta peticiones con credenciales desde `FRONTEND_URL` (CORS). Los documentos y la clave de las sesiones persisten en el volumen `document_data`. Ambos subdominios deben compartir el dominio principal (`nube-tec.com`), porque la cookie de sesión es `SameSite=Strict`.

1. **DNS.** Crea los registros `A` de `folio` y `api-folio` hacia la IP del servidor. Si usas Cloudflare con proxy (nube naranja), pon SSL/TLS en **Full (strict)**.
2. **Google.** Agrega `FRONTEND_URL` a los orígenes autorizados del ID de cliente OAuth.
3. **Servicio.** En Dokploy crea un proyecto y un servicio **Compose** con proveedor GitHub, rama `main` y ruta `./compose.prod.yaml`. Activa **Isolated Deployments**.
4. **Environment.** Copia el contenido de [`.env.dokploy.example`](.env.dokploy.example) y reemplaza los `<...>`. No subas los valores reales a GitHub. Dokploy usa estas variables para interpolar `compose.prod.yaml`; no es necesario subir un `.env`.

   | Variable | Obligatoria | Uso |
   | --- | --- | --- |
   | `FRONTEND_URL` | Sí | URL pública del frontend, p. ej. `https://folio.nube-tec.com`. Es el único origen aceptado por la API. |
   | `API_URL` | Sí | URL pública de la API, p. ej. `https://api-folio.nube-tec.com`. Se incrusta al compilar el frontend: si cambia, vuelve a desplegar. |
   | `DATABASE_URL` | Sí | `mysql://usuario:clave@host:3306/base`, también para MariaDB. Codifica en la URL los caracteres especiales de la clave; si el servidor exige TLS añade `?sslaccept=strict`. |
   | `GOOGLE_CLIENT_ID` | Sí | ID de cliente OAuth de Google. |
   | `OWNER_EMAIL` | Sí | Correo de Google del propietario. |
   | `MAX_PAGES`, `CONVERSION_TIMEOUT_MS` | No | 500 y 120000 por defecto. |

5. **Domains.** Agrega dos dominios con HTTPS: `folio.nube-tec.com` → servicio `frontend`, puerto **8080**; `api-folio.nube-tec.com` → servicio `backend`, puerto **3001**. Revisa **Preview Compose**: no debe haber puertos de host para el backend. Haz el primer despliegue manual y espera a que backend y frontend indiquen estado saludable. La migración Prisma se aplica al iniciar el backend.
6. **Verificación.** Comprueba que `https://api-folio.nube-tec.com/api/health` devuelve `{"ok":true}`. Abre `https://folio.nube-tec.com`, entra con la cuenta de `OWNER_EMAIL` y comprueba la carga, revisión y descarga de un PDF y un Word, y que **Administración** aparece. Reinicia los servicios y confirma que los trabajos siguen ahí. Los trabajos no caducan: configura respaldos del volumen `document_data` y de la base con el mismo horario. Activa el despliegue automático de GitHub solo después de esta verificación.

El cliente web se puede descargar sin iniciar sesión, pero la API de documentos requiere una cuenta activa; no uses el servicio por HTTP público.

Con Cloudflare en modo proxy, una petición que tarda más de 100 segundos termina en error 524; puede ocurrir al añadir un Word grande mientras hay otras conversiones en cola. Si te pasa a menudo, deja `api-folio` como solo DNS (nube gris). Cloudflare Free además rechaza cargas de más de 100 MB: mantén el tamaño máximo por archivo en 95 MB o menos mientras uses la nube naranja.

Antes de subir cambios ejecuta `pnpm build`, `pnpm test` y `pnpm test:e2e`. Para validar el archivo Compose sin iniciar contenedores usa `docker compose --env-file .env.dokploy.example -f compose.prod.yaml config --quiet`. La [guía de Compose](https://docs.dokploy.com/docs/core/docker-compose) y la [guía de dominios](https://docs.dokploy.com/docs/core/docker-compose/domains) de Dokploy explican esas opciones de la interfaz.
