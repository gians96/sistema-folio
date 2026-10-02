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
