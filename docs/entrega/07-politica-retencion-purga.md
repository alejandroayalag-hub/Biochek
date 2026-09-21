# BioChek — Política de Retención y Purga de Datos Biométricos

Última actualización: 2026-09-21

Este documento explica, en términos simples, qué pasa con el dato biométrico (rostro) de cada empleado a lo largo del tiempo — para que el cliente lo entienda sin tener que leer código.

## Qué se guarda

Al enrolarse, cada empleado tiene un registro de **enrolamiento biométrico** con:
- 3 fotos de su rostro
- Un vector matemático derivado de su rostro (embedding), usado para comparar contra cada checada
- Ambos, **cifrados** en el servidor

## Cuánto tiempo se guarda (retención)

**5 años, contados desde la fecha del enrolamiento** (no desde que el empleado cause baja). Esta fecha de vencimiento se calcula y se guarda desde el momento en que el empleado se enrola por primera vez.

> Si el cliente prefiere que el conteo empiece desde la **baja** del empleado en vez del enrolamiento, es un cambio de código puntual (una línea en `mobileEnrolamientosController.js`) — avisar antes de que haya enrolamientos reales en producción, para no tener que recalcular fechas ya guardadas.

## Qué pasa al vencer el plazo (purga)

Un script (`npm run purge`) corre **todas las madrugadas a las 4:00 am** (cron del sistema, no dentro de la app) y revisa qué enrolamientos ya vencieron. Para cada uno:

1. Borra las 3 fotos cifradas del servidor.
2. Borra el vector biométrico (embedding) de la base de datos.
3. **NO borra el registro completo** — deja la fila con un sello `anonimizado_at` (fecha en que se anonimizó), para conservar evidencia histórica de que el empleado existió y fue enrolado, sin conservar el dato biométrico en sí.
4. Registra la purga en la bitácora de auditoría del sistema.

Esto es **anonimización, no eliminación total** — es la diferencia entre "borrar que existió" y "borrar lo sensible, dejar evidencia de que se cumplió la política".

## Quién puede ver el dato biométrico mientras está vigente

Solo roles **admin** y **RH** desde el panel web, y cada vez que alguien ve las fotos de un enrolamiento, **queda registrado en la bitácora de auditoría** (quién, cuándo, cuál enrolamiento) — no es un acceso silencioso.

## Qué necesitamos del cliente

- Confirmar si el conteo de 5 años debe ser desde el enrolamiento (como está hoy) o desde la baja del empleado.
- Este documento asume que la política de "5 años" ya fue decidida con el cliente — si cambia el plazo, es un ajuste de configuración menor, no un cambio estructural.
