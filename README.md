# Generador de Presupuestos

Plataforma base reutilizable para construir instalaciones de presupuestos por
cliente sin rehacer backend, dominio, base de datos e infraestructura.

La intención es sencilla:

1. clonar el repositorio;
2. configurar `.env`;
3. definir identidad, impuestos, features y branding;
4. personalizar principalmente `apps/web`;
5. mantener estable el núcleo de dominio y aplicación;
6. desplegar el mismo conjunto de servicios.

No es un SaaS multi-tenant. Cada cliente puede tener una instalación aislada y fácil de entender.

## Arquitectura

```text
apps/
├── web       Next.js; capa visual reemplazable
├── api       HTTP; única entrada para operaciones de usuario/IA
├── mcp       MCP remoto; traduce tools a comandos de la API
├── oauth     Authorization Server OAuth 2.1 (ChatGPT/Claude)
└── worker    sincronización, webhooks, reintentos y trabajos

packages/
├── domain        reglas puras y motor de presupuestos
├── application   commands/queries y casos de uso
├── db            PostgreSQL + Drizzle + migraciones
├── holded        adaptador Holded
├── contracts     contratos y validación compartida
└── auth          scopes compartidos por MCP y OAuth
```

Regla central:

```text
Web ─────┐
         ├──> API ──> Application ──> Domain ──> DB
MCP ─────┘

Worker ─────> Application/Domain para trabajos internos autorizados
```

Ni Next.js ni MCP contienen reglas económicas.

## Documentación / SDD

Antes de implementar una funcionalidad relevante se crea o actualiza una especificación en:

```text
docs/specs/
```

Lee primero:

- `docs/README.md`
- `docs/sdd.md`
- `docs/architecture.md`
- `docs/rules.md`

No se pretende documentar cada línea de código. Se documentan decisiones, contratos, invariantes, flujos y criterios de aceptación.

Para levantar y comprobar la instalación completa con Holded y MCP, sigue
[cierre funcional](docs/operations/functional-closure.md). Los resultados de
pruebas unitarias, PostgreSQL, navegador, MCP y Holded real están en el
[informe de cierre](docs/operations/closure-report-2026-09-28.md).

## Desarrollo local (hot reload)

Requisitos: Node.js 22+, npm 11+ y Docker con Docker Compose.

```bash
npm ci
cp .env.example .env        # rellena los CHANGE_ME (valores locales)
docker compose up -d postgres
docker compose run --rm migrate
```

Cada servicio se arranca con recarga en caliente, sin reconstruir imágenes. `scripts/dev-local.mjs` lee `.env`, traduce `postgres:5432` y `api:4000` a los puertos publicados en `127.0.0.1` y no imprime secretos:

```bash
npm run dev:local:api       # 127.0.0.1:${API_PORT}
npm run dev:local:web       # localhost:${WEB_PORT}
npm run dev:local:mcp       # 127.0.0.1:${MCP_PORT}
npm run dev:local:worker    # opcional: reconciliación periódica de contactos
npm run dev:local:oauth     # Authorization Server OAuth (issuer http://localhost:${OAUTH_PORT})
```

Los scripts `npm run dev:web|dev:api|dev:mcp|dev:worker` siguen disponibles si prefieres exportar las variables tú mismo.

Validación completa del monorepo (typecheck, pruebas y compilación de todos los workspaces):

```bash
npm run check
```

## Producción

Resumen (detalle en [docs/operations/deployment.md](docs/operations/deployment.md)):

```bash
git clone https://github.com/Samupdprog/Index-Clima-Presupuestos.git
cd Index-Clima-Presupuestos
./scripts/setup-instance.sh index-clima presupuestos.example.com mcp.example.com admin@example.com
# revisa .env (INSTALLATION_NAME, COMPOSE_PROFILES, MCP_SCOPES…)
./scripts/preflight.sh
./scripts/deploy.sh         # build + migraciones automáticas + arranque
```

Después configura la API key de Holded en Configuración → Holded. Las migraciones se aplican solas en cada despliegue antes de arrancar la API. La base de datos vive en un volumen persistente con nombre.

Si el servidor está vacío, instala antes el Traefik compartido (`infra/traefik/README.md`). No levantes un segundo Traefik si ya existe uno usando 80/443.

## Auditoría de un servidor

Antes de instalar en un VPS desconocido:

```bash
sudo ./infra/server-audit/audit.sh
```

Genera un informe sanitizado con Docker, Compose, redes, volúmenes, puertos, mounts y rutas para comprender el servidor antes de modificarlo.

Consulta `infra/server-audit/README.md`.

## Crear una instalación

Sigue [create-new-client.md](docs/operations/create-new-client.md). Las
instalaciones cliente son repositorios independientes con `origin` propio y
`upstream` apuntando a esta base. No se mantienen branches permanentes por
cliente.

## Migraciones y pruebas

```bash
npm run db:generate                 # tras cambiar el esquema Drizzle
docker compose run --rm migrate     # aplica migraciones + installation
npm run typecheck
npm test
npm run test:integration            # PostgreSQL real
npm run build
```

## Estado actual

Generador operativo para Index Clima:

- Clientes locales sincronizados con contactos de Holded v2.
- Presupuestos con materiales, mano de obra, desplazamientos y otros conceptos; reglas de precio, descuentos encadenados, IGIC y ajustes posteriores con preview. La autoridad económica es el dominio.
- Revisiones con bloqueo optimista, revisión previa a la exportación, PDF y exportación idempotente al mismo Estimate de Holded.
- MCP para IA con scopes, que opera el Generador y consulta en solo lectura los Estimates existentes en Holded ([SPEC-011](docs/specs/011-mcp-holded-estimates.md)).
- Conexión de ChatGPT y Claude mediante OAuth 2.1 con Authorization Server integrado ([guía](docs/operations/chatgpt-mcp-oauth.md), [SPEC-012](docs/specs/012-mcp-oauth.md)).
- v1.1: login persistente de 30 días, decimales en formato español, coste por unidad o total, resultado interno en Revisión, número editable, papelera y mantenimiento del catálogo (también por MCP) con actualización masiva previsualizada ([SPEC-013](docs/specs/013-v1.1-ux-catalog-lifecycle.md), [CHANGELOG](CHANGELOG.md)).

El desarrollo funcional continúa mediante especificaciones SDD pequeñas y verificables en `docs/specs/`.
