# Arquitectura

## Capas

### `packages/domain`

Reglas puras del negocio:

- clientes como concepto de dominio;
- presupuestos;
- líneas;
- pricing;
- descuentos;
- ajustes posteriores;
- cálculo;
- revisiones y estados cuando sean reglas de dominio.

No conoce:

- HTTP;
- Next.js;
- MCP;
- PostgreSQL;
- Drizzle;
- Holded;
- variables de entorno.

### `packages/application`

Casos de uso:

- commands para mutaciones;
- queries para lecturas;
- validación de permisos a nivel de caso de uso;
- optimistic locking;
- idempotencia;
- auditoría mediante puertos;
- coordinación de repositorios e integraciones.

No contiene SQL ni UI.

### `packages/db`

Único lugar con conocimiento de PostgreSQL/Drizzle.

Implementa repositorios y migraciones.

### `apps/api`

Adaptador HTTP.

Traduce HTTP a commands/queries y devuelve respuestas. No calcula precios.

Es la única puerta hacia Holded. Resuelve la API key, que nunca sale del backend, y expone lecturas tipadas de Estimates (`/holded/estimates`) y la exportación (`POST /quotes/:id/holded`).

### `apps/mcp`

Adaptador MCP remoto.

Valida contratos de tools y llama a la API interna. No dispone de acceso SQL ni contiene reglas de negocio. Tampoco llama a Holded: consulta y exporta Estimates solo a través de la API.

Así toda mutación humana o de IA cruza la misma autoridad.

### `apps/oauth`

Authorization Server OAuth 2.1 de la instalación (oidc-provider), para ChatGPT y Claude. Emite tokens JWT con audiencia igual al MCP. Solo persiste artefactos OAuth (`oauth_artifacts`) a través de `packages/db`. No conoce presupuestos, clientes ni Holded. Ver ADR-006.

### `apps/worker`

Ejecutor interno de trabajos persistidos:

- webhooks;
- Holded;
- reconciliación;
- reintentos;
- outbox/jobs.

Puede usar repositorios y servicios de aplicación diseñados para jobs, pero no puede escribir valores económicos saltándose el dominio.

### `apps/web`

Interfaz reemplazable/personalizable.

El navegador no recibe credenciales internas.

## Dirección de dependencias

```text
domain         <- application <- api
contracts      <- application <- api
contracts                   <- mcp
db             -> application ports
holded         -> application ports
auth           -> mcp, oauth (scopes compartidos)
```

Las dependencias externas apuntan hacia el núcleo, no al revés.
