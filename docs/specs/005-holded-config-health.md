# Spec 005 - Configuración y salud de Holded

Estado: implementada.

## Objetivo

Permitir que una instalación configure Holded desde la aplicación y conozca el
estado de la conexión sin enviar la credencial al navegador ni duplicar la
lógica económica del dominio.

## Configuración

- La API es la única capa que resuelve la API Key de Holded.
- Una clave guardada desde Configuración se cifra con AES-256-GCM antes de
  persistirse en `installations.config`.
- `HOLDED_ENCRYPTION_KEY` debe estar definido en despliegues persistentes. La
  clave se deriva de secretos internos solo como compatibilidad de desarrollo.
- La configuración persistida tiene prioridad sobre `HOLDED_API_KEY`, que se
  mantiene como fallback de compatibilidad operativa.
- La respuesta HTTP solo devuelve una máscara de la clave, nunca el secreto.
- El valor vacío elimina la clave persistida y permite volver al fallback de
  `HOLDED_API_KEY`.

## Salud

- La comprobación usa un endpoint autenticado y de bajo coste de Holded.
- Los resultados se clasifican como `healthy`, `unhealthy` o `unknown`, con
  códigos accionables para clave inválida, rate limit, red y configuración
  ausente.
- El intervalo se guarda por instalación y admite 1, 5, 10, 15, 30 o 60
  minutos; el valor por defecto es 5 minutos.
- Las comprobaciones concurrentes se deduplican en la API y no se repiten
  durante el intervalo configurado salvo una petición manual explícita.
- Los detalles de respuesta de Holded y las credenciales no se escriben en
  logs ni se envían al frontend.

## API interna

- `GET /holded/settings` devuelve estado, máscara, intervalo y salud.
- `PATCH /holded/settings` actualiza la clave recibida y/o el intervalo.
- `GET|POST /holded/health` fuerza una comprobación y devuelve solo su estado.
- La exportación de presupuestos reutiliza la misma resolución de credencial.

## Criterios de aceptación

- La clave se puede configurar sin reiniciar la API.
- Recargar Configuración muestra la máscara y conserva el intervalo.
- Una clave inválida se identifica sin exponer la respuesta sensible de Holded.
- Un fallo temporal durante la actualización de clientes conserva la última
  lista válida del selector.
- `npm run typecheck`, `npm test` y `npm run build` son válidos.
