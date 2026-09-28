# Spec 007 — Cierre económico, importación y ajustes

Fecha: 2026-09-24.

El dominio conserva tarifa bruta, descuentos consecutivos y coste neto separados.
Cada descuento debe estar entre 0 y 100; el multiplicador es el producto de
`(1 - descuento / 100)`. El descuento efectivo es `100 * (1 - multiplicador)`.
Un coste neto explícito prevalece sobre el coste derivado. Si falta la tarifa y
se conocen coste neto y descuentos, se reconstruye dividiendo por el multiplicador;
un multiplicador cero hace esta reconstrucción imposible y produce error visible.

Las reglas automáticas parten del coste neto o de la tarifa según `saleBaseMode`.
Un porcentaje añadido de cero conserva esa base. Los datos incompletos producen
`pricing_data_required`, nunca una base cero inventada. Un precio fijo cero
explícito sigue siendo válido (líneas gratuitas); la importación sin precio de venta
utiliza una regla automática. Las líneas y sus descuentos se guardan conjuntamente.

Beneficio = venta sin IGIC menos coste. Rentabilidad sobre coste y margen sobre
venta se calculan separadamente, con null cuando su denominador es cero.

El preview de ajustes exige la revisión y recalcula con el mismo motor que aplica
los cambios. Devuelve coste, venta, reparto, beneficio y margen antes/después por
línea y selección. No modifica persistencia. Los ajustes conservan su operación
original. El reparto usa céntimos enteros y restos mayores (desempate por ID), no
acumula todos los errores en una última línea. Un ajuste imposible, un objetivo
negativo o targets inexistentes son rechazados explícitamente.

La lectura de presupuestos expone métricas calculadas de dominio; duplicar copia
descuentos, empleados, textos y ajustes con nuevas referencias y recálculo.

Validación: regresiones de cinco materiales con coste 5749,38, 40+10=46%, N
descuentos, cantidades, reconstrucción de tarifa, márgenes e IGIC separado,
repartos de pocos céntimos, cero venta y preview frente a cálculo final.
