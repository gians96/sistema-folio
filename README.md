# Folio · Documentos en orden

Aplicación local para cargar PDF, DOC y DOCX, organizar y foliar páginas, revisar el resultado y descargarlo como PDF. Usa React y TypeScript en `frontend/`, Express y TypeScript en `backend/`, y MySQL para los trabajos. Los archivos Word se convierten con LibreOffice.

## Inicio local en Windows

Necesitas Node.js 24, pnpm 11.1.2, **MySQL activo en Laragon** y LibreOffice instalado. No necesitas MySQL Workbench. pnpm queda fijado en `package.json` y `pnpm-lock.yaml`.

1. Inicia MySQL desde Laragon y comprueba que use el puerto `3306`.
2. Si todavía no existe `backend/.env`, copia el ejemplo:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```

3. Revisa `DATABASE_URL` en `backend/.env`. La configuración predeterminada usa `folio` / `folio_local_dev` en `localhost:3306`. LibreOffice se detecta en `C:\Program Files\LibreOffice\program\soffice.com`; usa `SOFFICE_PATH` si está en otra ruta.
4. Desde la raíz del proyecto, ejecuta:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm local:setup
   pnpm dev
   ```

Abre **http://localhost:5173**. `pnpm local:setup` crea la base y el usuario en el MySQL de Laragon, genera el cliente Prisma y aplica la migración. Requiere que el usuario `root` de Laragon pueda conectar por TCP sin contraseña; si tiene contraseña, define `LOCAL_MYSQL_ROOT_PASSWORD` en la sesión antes de ejecutar el comando. Si el ejecutable de MySQL no está en la ruta detectada, define `MYSQL_PATH` en la sesión. `pnpm dev` comprueba MySQL y LibreOffice, confirma las migraciones e inicia backend y frontend en la misma terminal. Para detenerlos, pulsa Ctrl+C.

```powershell
$env:LOCAL_MYSQL_ROOT_PASSWORD = 'tu-contraseña-de-root'  # Solo si Laragon la requiere
$env:MYSQL_PATH = 'C:\ruta\a\Laragon\bin\mysql\mysql.exe'  # Solo si no se detecta
pnpm local:setup
```

No guardes la contraseña de `root` en el repositorio. `backend/.env` está excluido del control de versiones. El backend guarda los originales y PDF generados en `backend/data/`, también excluido. Los trabajos caducan en 24 horas y el usuario puede eliminarlos desde la interfaz.

## Uso

Carga uno o varios documentos, organiza las páginas arrastrando sus miniaturas, gíralas a la izquierda o a la derecha, excluye las que no necesites y configura la foliación. Para añadir más páginas a un trabajo abierto, arrastra otros PDF, DOC o DOCX sobre el editor o usa **Añadir documento**; sus páginas se agregan al final y conservan la edición previa. Puedes elegir cualquiera de las cuatro esquinas, márgenes, color, tamaño, prefijo, dígitos y número inicial. También puedes definir una posición diferente por página. Las páginas conservadas sin folio consumen número; las excluidas no. La revisión final genera el PDF real y la descarga entrega exactamente ese archivo. Una nueva edición invalida la revisión anterior.

Límites iniciales: sin límite de tamaño y 500 páginas. Un DOC o DOCX puede cambiar de distribución al convertirse con LibreOffice; revísalo antes de descargar. La aplicación no edita el texto original ni realiza OCR.

## Estructura y comandos

```text
frontend/    React, Vite y PDF.js
backend/     Express, Prisma, MySQL y conversión de Word
shared/      Tipos y validación compartidos
tests/       Prueba de navegador
```

```powershell
pnpm local:check    # Comprueba Laragon, configuración y LibreOffice
pnpm local:setup    # Crea base/usuario y aplica migraciones
pnpm dev            # Inicia backend y frontend
pnpm build          # Compila los tres paquetes
pnpm test           # Pruebas del backend
pnpm test:e2e       # Prueba de navegador con servidor aislado de prueba
pnpm test:local     # PDF, DOC y DOCX con Laragon y LibreOffice reales; requiere pnpm dev activo
```

Para instalar el navegador de Playwright la primera vez: `pnpm exec playwright install chromium`. Para añadir dependencias usa `pnpm --filter @folio/frontend add <paquete>`, `pnpm --filter @folio/backend add <paquete>` o `pnpm add -Dw <paquete>` en la raíz.

## Configuración

`backend/.env` admite `DATABASE_URL`, `PORT` (3001), `DATA_DIR` (`./data` dentro de backend), `SOFFICE_PATH`, `MAX_FILE_MB` (0 = sin límite), `MAX_PAGES` (500), `JOB_TTL_HOURS` (24) y `CONVERSION_TIMEOUT_MS` (120000). Vite atiende en 5173 y envía `/api` a `http://localhost:3001`; puedes cambiar el destino con `API_PROXY`. En producción el frontend llama directamente a `API_URL` y el backend acepta los orígenes listados en `CORS_ORIGINS` (separados por comas) y `TRUST_PROXY` (0 por defecto). Si el puerto 5173 está ocupado, Vite avisará en lugar de cambiar de puerto silenciosamente.

La API crea un trabajo con `POST /api/jobs` (`multipart/form-data`, campo `file`) y devuelve un token temporal. Las rutas `/api/jobs/:id` requieren `Authorization: Bearer <token>`. Incluyen lectura, PDF base, guardado de configuración, generación de revisión, vista previa, descarga y eliminación. MySQL guarda metadatos y configuración; los documentos quedan en disco. La aplicación usa una sola instancia de backend para su cola de conversiones y bloqueos.

## Despliegue en Contabo con Dokploy

El desarrollo local sigue usando Laragon. Para producción usa `compose.prod.yaml` como servicio **Docker Compose** de Dokploy (no Docker Stack). Frontend y API se publican en subdominios separados del mismo dominio, por ejemplo:

| Servicio   | Dominio                  | Puerto interno |
| ---------- | ------------------------ | -------------- |
| `frontend` | `folio.nube-tec.com`     | 8080           |
| `backend`  | `api-folio.nube-tec.com` | 3001           |

El frontend se compila como archivos estáticos servidos por Nginx y llama a la API en `API_URL` (Vite la incrusta al compilar). El backend solo acepta peticiones con credenciales desde `FRONTEND_URL` (CORS). MySQL queda en la red interna y no se publica; MySQL y los documentos persisten en volúmenes con nombre. Ambos subdominios deben compartir el dominio principal (`nube-tec.com`), porque la cookie de sesión es `SameSite=Strict`.

1. **DNS.** Crea los registros `A` de `folio` y `api-folio` hacia la IP del servidor. Si usas Cloudflare con proxy (nube naranja), pon SSL/TLS en **Full (strict)**.
2. **Secretos.** En una terminal local ejecuta `pnpm auth:hash` y escribe una contraseña larga para la cuenta compartida. Copia únicamente el hash `scrypt:...`; la contraseña no se guarda en el repositorio. Genera tres valores hexadecimales distintos para `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` y `SESSION_SECRET`, por ejemplo con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` una vez por valor. Usa solo letras y números para las claves MySQL, porque `DATABASE_URL` se construye a partir de ellas.
3. **Servicio.** En Dokploy crea un proyecto y un servicio **Compose** con proveedor GitHub, rama `main` y ruta `./compose.prod.yaml`. Activa **Isolated Deployments**.
4. **Environment.** Copia el contenido de [`.env.dokploy.example`](.env.dokploy.example) y reemplaza los `<...>`. No subas los valores reales a GitHub ni reutilices las contraseñas de Laragon. Dokploy usa estas variables para interpolar `compose.prod.yaml`; no es necesario subir un `.env`.

   | Variable | Obligatoria | Uso |
   | --- | --- | --- |
   | `FRONTEND_URL` | Sí | URL pública del frontend, p. ej. `https://folio.nube-tec.com`. Es el único origen aceptado por la API. |
   | `API_URL` | Sí | URL pública de la API, p. ej. `https://api-folio.nube-tec.com`. Se incrusta al compilar el frontend: si cambia, vuelve a desplegar. |
   | `MYSQL_DATABASE`, `MYSQL_USER` | Sí | Nombre de base y usuario, p. ej. `folio`. |
   | `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` | Sí | Hexadecimales aleatorios distintos. |
   | `ADMIN_USER` | Sí | Usuario de acceso a la app. |
   | `ADMIN_PASSWORD_HASH` | Sí | Resultado de `pnpm auth:hash`. |
   | `SESSION_SECRET` | Sí | Hexadecimal aleatorio de 32 caracteres o más. |
   | `TRUST_PROXY` | No (2) | Proxies delante del backend: `2` con Cloudflare en modo proxy + Traefik, `1` solo con Traefik. Afecta al límite de intentos de login por IP. |
   | `MAX_FILE_MB` | No (0) | 0 = sin límite. Cloudflare Free rechaza peticiones de más de 100 MB: con nube naranja usa `95`. |
   | `MAX_PAGES`, `JOB_TTL_HOURS`, `CONVERSION_TIMEOUT_MS` | No | 500, 24 y 120000 por defecto. |

5. **Domains.** Agrega dos dominios con HTTPS: `folio.nube-tec.com` → servicio `frontend`, puerto **8080**; `api-folio.nube-tec.com` → servicio `backend`, puerto **3001**. Revisa **Preview Compose**: no debe haber puertos de host para backend ni MySQL. Haz el primer despliegue manual y espera a que MySQL, backend y frontend indiquen estado saludable. La migración Prisma se aplica al iniciar el backend.
6. **Verificación.** Comprueba que `https://api-folio.nube-tec.com/api/health` devuelve `{"ok":true}`. Abre `https://folio.nube-tec.com`, inicia sesión y comprueba la carga, revisión y descarga de un PDF y un Word. Reinicia los servicios y confirma que un trabajo aún vigente se recupera. Configura respaldos de los volúmenes `mysql_data` y `document_data` con el mismo horario; los trabajos caducan a las 24 horas. Activa el despliegue automático de GitHub solo después de esta verificación.

La cookie de acceso es `HttpOnly`, `Secure` y `SameSite=Strict`, dura ocho horas y se usa además del token específico de cada trabajo. El inicio de sesión limita los intentos fallidos por dirección IP. Cambiar `SESSION_SECRET` cierra todas las sesiones. El frontend se puede descargar sin iniciar sesión, pero la API de documentos requiere la cuenta compartida; no uses el servicio por HTTP público.

Con Cloudflare en modo proxy, una petición que tarda más de 100 segundos termina en error 524; puede ocurrir al añadir un Word grande mientras hay otras conversiones en cola. Si te pasa a menudo, deja `api-folio` como solo DNS (nube gris) y cambia `TRUST_PROXY` a `1`.

Antes de subir cambios ejecuta `pnpm build`, `pnpm test` y `pnpm test:e2e`. Para validar el archivo Compose sin iniciar contenedores usa `docker compose --env-file .env.dokploy.example -f compose.prod.yaml config --quiet`. La [guía de Compose](https://docs.dokploy.com/docs/core/docker-compose) y la [guía de dominios](https://docs.dokploy.com/docs/core/docker-compose/domains) de Dokploy explican esas opciones de la interfaz.
