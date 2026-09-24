# Despliegue

## Servidor desconocido

Primero:

```bash
sudo ./infra/server-audit/audit.sh
```

Revisar:

- puertos 80/443;
- Traefik existente;
- red Docker compartida;
- proyectos Compose existentes;
- volúmenes;
- mounts;
- espacio en disco;
- políticas de restart.

## Servidor con Traefik existente

Crear DNS de `APP_HOST` y `MCP_HOST`.

Después:

```bash
./scripts/setup-instance.sh ...
./scripts/preflight.sh
./scripts/deploy.sh
```

## Servidor sin Traefik

Usar `infra/traefik` una sola vez para el servidor.

No instalar un Traefik por cada cliente.

## Actualización

```bash
git pull --ff-only
./scripts/deploy.sh
```

Aplicar migraciones pendientes desde la red privada de Compose:

```bash
docker compose run --rm migrate
```

El servicio es one-shot, no publica puertos y espera a que PostgreSQL esté healthy.

## Activar la exportación a Holded

La acción “Guardar e importar en Holded” se ejecuta desde la API para que la
credencial nunca llegue al navegador. Para el primer arranque configura en
`.env`:

```bash
FEATURE_HOLDED=true
HOLDED_API_KEY=tu_clave_privada
HOLDED_ENCRYPTION_KEY=un_secreto_estable_y_largo
HOLDED_HEALTH_CHECK_INTERVAL_MINUTES=5
```

Después recrea al menos el servicio API:

```bash
docker compose up -d --build api
```

Con `FEATURE_HOLDED=false` o sin clave, la interfaz conserva el presupuesto sin
cambiar su estado y muestra que la integración no está configurada.

Una vez iniciada la aplicación, la clave también puede guardarse desde
`Configuración`. La API la cifra en `installations.config`, devuelve únicamente
una máscara y usa la configuración persistida antes que `HOLDED_API_KEY`. No
cambies `HOLDED_ENCRYPTION_KEY` después de guardar claves: hacerlo impide
descifrarlas. El intervalo de salud se puede ajustar desde la misma pantalla y
por defecto es de cinco minutos.

Crear o actualizar la instalación configurada en `INSTALLATION_SLUG`:

```bash
npm run db:seed
```

El comando es idempotente por `INSTALLATION_SLUG` y devuelve el UUID que debe
configurarse como `INSTALLATION_ID` para API y worker.

## Logs

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=200
```

La red `private` mantiene el acceso interno entre servicios y PostgreSQL. API y worker también se conectan a `egress` para acceder a servicios externos como Holded; PostgreSQL permanece fuera de esa red.
