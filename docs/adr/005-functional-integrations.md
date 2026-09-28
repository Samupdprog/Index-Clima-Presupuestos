# ADR 005 — Autoridad de cálculo y confirmación externa

Estado: aceptado (2026-09-28).

Los cálculos económicos son exclusivos del dominio y se consultan mediante API. Web y MCP envían datos y comandos tipados, usan revisión optimista y muestran resultados del backend. Los descuentos de proveedor son multiplicativos y los ajustes se mantienen como operaciones separadas. PostgreSQL conserva el estado local.

La exportación a Holded v2 se trata como una entrega a un sistema externo, no como una segunda autoridad monetaria. Se reserva bajo bloqueo por presupuesto, se guarda el ID remoto antes de verificar, y se consulta de nuevo el documento para contrastar subtotal, IGIC, total y líneas. Un POST de resultado incierto se recupera por etiqueta estable; no se repite sin resolución. Las comas decimales de su API se normalizan en el adaptador.

El MCP autentica el bearer y scopes antes de invocar herramientas y solo llama a la API interna. La identidad y la instalación son suministradas por el servidor. No accede a SQL, Holded ni al motor de dominio. El webhook de Holded usa firma HMAC sobre bytes crudos y la reconciliación periódica cubre eventos perdidos.
