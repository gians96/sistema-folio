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

Carga un documento, organiza las páginas, gira o excluye las que necesites y configura la foliación. Puedes elegir cualquiera de las cuatro esquinas, márgenes, color, tamaño, prefijo, dígitos y número inicial. También puedes definir una posición diferente por página. Las páginas conservadas sin folio consumen número; las excluidas no. La revisión final genera el PDF real y la descarga entrega exactamente ese archivo. Una nueva edición invalida la revisión anterior.

Límites iniciales: 50 MB y 500 páginas. Un DOC o DOCX puede cambiar de distribución al convertirse con LibreOffice; revísalo antes de descargar. La aplicación no edita el texto original ni realiza OCR.

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

`backend/.env` admite `DATABASE_URL`, `PORT` (3001), `DATA_DIR` (`./data` dentro de backend), `SOFFICE_PATH`, `MAX_FILE_MB` (50), `MAX_PAGES` (500), `JOB_TTL_HOURS` (24) y `CONVERSION_TIMEOUT_MS` (120000). Vite atiende en 5173 y envía `/api` a `http://localhost:3001`; puedes cambiar el destino con `API_PROXY`. Si el puerto 5173 está ocupado, Vite avisará en lugar de cambiar de puerto silenciosamente.

La API crea un trabajo con `POST /api/jobs` (`multipart/form-data`, campo `file`) y devuelve un token temporal. Las rutas `/api/jobs/:id` requieren `Authorization: Bearer <token>`. Incluyen lectura, PDF base, guardado de configuración, generación de revisión, vista previa, descarga y eliminación. MySQL guarda metadatos y configuración; los documentos quedan en disco. La aplicación usa una sola instancia de backend para su cola de conversiones y bloqueos.

## Despliegue en Contabo con Dokploy

El desarrollo local sigue usando Laragon. Para producción usa `compose.prod.yaml` como servicio **Docker Compose** de Dokploy (no Docker Stack). Este archivo construye React como archivos estáticos servidos por Nginx, mantiene Express y MySQL en la red interna y persiste MySQL y los documentos en volúmenes con nombre. No publica los puertos 3001 ni 3306.

1. En una terminal local ejecuta `pnpm auth:hash` y escribe una contraseña larga para la cuenta compartida. Copia únicamente el hash `scrypt:...`; la contraseña no se guarda en el repositorio. Genera tres valores hexadecimales distintos para `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` y `SESSION_SECRET`, por ejemplo con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` una vez por valor. Usa solo letras y números para las claves MySQL, porque `DATABASE_URL` se construye a partir de ellas.
2. Sube estos cambios a la rama que Dokploy lee desde GitHub. En Dokploy crea un proyecto y un servicio **Compose** con proveedor GitHub, esa rama y ruta `./compose.prod.yaml`. Activa **Isolated Deployments**.
3. En **Environment** define los valores siguientes. No los incluyas en GitHub ni reutilices las contraseñas de Laragon:

   ```text
   MYSQL_DATABASE=folio
   MYSQL_USER=folio
   MYSQL_PASSWORD=<hexadecimal-aleatorio>
   MYSQL_ROOT_PASSWORD=<otro-hexadecimal-aleatorio>
   ADMIN_USER=<nombre-de-usuario>
   ADMIN_PASSWORD_HASH=<resultado-de-pnpm-auth-hash>
   SESSION_SECRET=<tercer-hexadecimal-aleatorio>
   ```

   Dokploy usa estas variables para interpolar `compose.prod.yaml`; no es necesario subir un `.env`. Los parámetros opcionales `MAX_FILE_MB`, `MAX_PAGES`, `JOB_TTL_HOURS` y `CONVERSION_TIMEOUT_MS` conservan los valores locales si se omiten. Mantén `MAX_FILE_MB` en 50 o menos salvo que ajustes también `client_max_body_size` en `frontend/nginx.conf`.
4. En **Domains** agrega el dominio que ya apunta a Contabo, selecciona solo el servicio `frontend`, puerto interno **8080** y habilita HTTPS. Revisa **Preview Compose**: debe publicar únicamente el frontend, sin puertos de host para backend o MySQL. Haz el primer despliegue manual y espera a que MySQL, backend y frontend indiquen estado saludable. La migración Prisma se aplica al iniciar el backend.
5. Abre `https://tu-dominio`, inicia sesión y comprueba la carga, revisión y descarga de un PDF y un Word. Reinicia los servicios y confirma que un trabajo aún vigente se recupera. Configura respaldos de los volúmenes `mysql_data` y `document_data` con el mismo horario; los trabajos caducan a las 24 horas. Activa el despliegue automático de GitHub solo después de esta verificación.

La cookie de acceso es `HttpOnly`, `Secure` y `SameSite=Strict`, dura ocho horas y se usa además del token específico de cada trabajo. El inicio de sesión limita los intentos fallidos por dirección IP. Cambiar `SESSION_SECRET` cierra todas las sesiones. El frontend se puede descargar sin iniciar sesión, pero la API de documentos requiere la cuenta compartida; no uses el servicio por HTTP público.

Antes de subir cambios ejecuta `pnpm build`, `pnpm test` y `pnpm test:e2e`. Para validar el archivo Compose sin iniciar contenedores usa `docker compose -f compose.prod.yaml config --quiet` con las variables de Environment definidas en tu sesión. La [guía de Compose](https://docs.dokploy.com/docs/core/docker-compose) y la [guía de dominios](https://docs.dokploy.com/docs/core/docker-compose/domains) de Dokploy explican esas opciones de la interfaz.
