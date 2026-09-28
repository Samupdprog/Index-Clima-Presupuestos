# Operación del cierre funcional

## Arranque local

Con `.env` configurado y `INSTALLATION_ID` estable:

```bash
docker compose run --rm migrate
docker compose --profile mcp up -d --build postgres api web worker mcp
docker compose ps
```

Web: `http://localhost:${WEB_PORT:-3000}`. MCP: `http://localhost:${MCP_PORT:-4001}/mcp`, con `MCP_PUBLIC_URL` exactamente igual a la URL que usará el cliente. Usa `FEATURE_MCP=true`, `MCP_AUTH_MODE=bearer` y un `MCP_AUTH_TOKEN` aleatorio de al menos 32 caracteres, distinto de `INTERNAL_SERVICE_TOKEN`. En modo local, el token y su lista `MCP_SCOPES` identifican una sola instalación. El archivo `docker-compose.prod.yml` exige `APP_ACCESS_PASSWORD`; la web responde con autenticación HTTP Basic antes de abrir páginas o `/api/backend`. Usa HTTPS, una contraseña única y larga; si quieres cuentas independientes y revocación por usuario, añade autenticación de usuarios en el proxy de entrada y un verificador OAuth para clientes MCP. El bearer local equivale a una cuenta de servicio.

Holded requiere scopes `contacts:contacts.read/write`, `sales:estimates.read/write` y `accounting:taxes.read`. En Configuración conecta la clave, comprueba salud y carga impuestos. Si una tasa muestra varias variantes, selecciona el impuesto IGIC normal correspondiente; las claves reales de la cuenta de prueba fueron `s_igic_0`, `s_igic_3`, `s_igic_7`, `s_igic_15`. No sustituyas por IVA. El botón de sincronización de clientes ejecuta una reconciliación inmediata; el worker la repite cada cinco minutos cuando Holded está activo. El webhook opcional se publica como `/api/holded-webhook` y requiere `HOLDED_WEBHOOK_SECRET` de la configuración de Holded.

El borrado de datos funcionales está desactivado por defecto (`ALLOW_DATA_RESET=false`). Al habilitarlo, la pantalla exige frase y confirmación; borra solo datos locales de la instalación y preserva instalación, configuración, usuarios y auditoría. No elimina nada en Holded. Conserva copia de seguridad antes de usarlo en datos valiosos.

## Verificación

```bash
npm run typecheck
npm test
npm run build
docker compose run --rm -v "${PWD}/packages:/app/packages" migrate npm run test:integration
npm run test:e2e
npm audit
docker compose ps
```

En Windows PowerShell, `${PWD}` representa el directorio actual. La prueba real de Holded está en `scripts/live-holded-smoke.ts`; se ejecuta deliberadamente dentro de API con `npx esbuild ...` y crea solo clientes/Estimates `TEST`, que intenta borrar al finalizar. La prueba MCP está en `scripts/live-mcp-smoke.mjs` y también archiva su presupuesto `TEST`. Revisa entidades `TEST` si un proceso se interrumpe antes de ejecutar su limpieza.

Para probar el MCP autenticado en un solo comando desde PowerShell:

```powershell
Get-Content scripts/live-mcp-smoke.mjs -Raw | docker compose exec -T mcp node --input-type=module
```

En este host, Docker Desktop 4.72.0 ha fallado al arrancar por sockets temporales antiguos (`dockerInference` y `engine.sock`). Si reaparece ese error y `docker info` no responde, ejecuta en PowerShell `./scripts/recover-docker-desktop.ps1`. Renombra solo las carpetas temporales de esos sockets y reinicia Docker Desktop; no toca volúmenes ni la base de datos.
