# 09 · Criterios de selección: qué se aplicó y cómo validarlo

Estado a 14/11/2026. Fórmula en `src/analogs/similarity.py` (Python) y `app/src/scoring.js` (web), con los
parámetros en `configs/variables.yaml` (bloques `dimensions`, `scoring` y, por variable, `dimension`,
`half_diff`, `matrix`, `criterion`). Tras cambiar el YAML: `python scripts/export_scoring.py` y recargar la web.

## Aplicado

| # | Cambio | Antes | Ahora |
|---|---|---|---|
| 1 | Nota suave | `max(0, 1 − Δ/tol)`: a partir de `tol` todo vale 0 y deja de ordenar | `1 / (1 + (Δ/half_diff)²)`: 0,5 en `half_diff`, 0,2 en 2×, nunca 0. La Antártida queda por delante del Sahara en temperatura aunque ninguna llegue a Marte |
| 2 | Pesos por dimensión | 3 temperaturas = 3 votos de 9 | Terreno · Térmica · Agua y hielo · Cielo y luz (· Composición). Cada dimensión pesa 1 (o el mayor peso que la prueba da a sus variables); dentro, media ponderada |
| 3 | Tolerancias con criterio | Todas `[supuesto]` sin justificar; Sol 3° ataba la latitud; hielo binario | `half_diff` con `criterion` escrito (operativo, de medida o climático). Sol 10°. Hielo con matriz entre clases (≤ 1 m ↔ 1–5 m = 0,5…) |
| 8 | Entorno de la celda | Solo la celda (6,5 km) | Ranking = 60 % la celda + 40 % la media de sus 6 vecinas (~20 km; las que no son zona de búsqueda cuentan 0). Premia zonas homogéneas donde cabe una campaña |

`tolerance` se conserva para variables sin `half_diff` y para los márgenes del planificador del rover.

## Punto 9 (estudio, NO aplicado): validar con análogos conocidos

**Idea.** Si el índice tiene sentido, los sitios que la comunidad ya usa como análogos deberían salir
arriba cuando se busca desde el sitio de Marte o la Luna que representan.

**Conjunto de prueba** (ya está en `app/data/analogos_conocidos.json`, 20 sitios, con `analog_of`):

| Objetivo | Análogos esperados |
|---|---|
| Marte, latitudes medias heladas (Phoenix, Arcadia, Utopia) | Valles Secos de McMurdo, Devon Island (Haughton), Svalbard (Bockfjord) |
| Marte, ecuatorial seco (Jezero, Gale, Meridiani) | Atacama, MDRS (Utah), Pilbara, Dallol, Río Tinto |
| Marte volcánico | Islandia (Askja), Mauna Kea, Kilauea, Teide, Lanzarote |
| Luna (mares, tierras altas) | Lanzarote, SP Crater, Craters of the Moon, Meteor Crater, Ries, Sudbury |
| Luna, polo sur (Shackleton) | Antártida (Transantárticas), Devon Island |

**Métricas** (para cada pareja objetivo → análogo):
- *Percentil del análogo*: qué fracción de las 1,4 M celdas de búsqueda queda por debajo del índice del
  análogo (100 = el mejor). Resumen: mediana por grupo.
- *Enriquecimiento top-1 %*: cuántas veces más análogos conocidos caen en el 1 % mejor que al azar.
- *Recall@N*: ¿aparece el análogo (a < 50 km) entre los N mejores sitios separados?

**Cómo ajustar sin hacer trampa.**
1. Rejilla pequeña de parámetros (`half_diff` ×0,5 / ×1 / ×2 por dimensión, `area_weight` 0 / 0,2 / 0,4).
2. Elegir con *leave-one-out*: se ajusta con 19 sitios y se mide en el que queda fuera, rotando.
3. Sensibilidad: con los parámetros elegidos, variar cada `half_diff` ±50 % y medir cuánto cambian los
   100 primeros (solapamiento o Kendall τ). Un sitio que sale arriba con todas las variantes es robusto.

**Cuidado.**
- 20 sitios es poco: sirve para detectar errores gordos, no para "calibrar" en sentido estadístico.
- Los análogos conocidos están sesgados hacia lugares accesibles (cerca de carreteras, bases o
  universidades): un buen análogo remoto que no está en la lista no es un fallo del índice.
- Varios sitios de la lista quedan fuera de la máscara de búsqueda (Río Tinto, Teide, Kilauea: vegetación
  o ciudad cerca). Hay que medirlos con su propia ficha, no exigirles que salgan en el ranking.
- Algunos son análogos por una sola propiedad (Río Tinto: química del agua; Ries: impacto). Ninguna
  variable actual mide eso: no deben contar como fallo del índice general, sino de una prueba concreta.

**Coste estimado.** Un script `scripts/validate_analogs.py` (lee las fichas de Marte, la Luna y la tabla de
búsqueda de la Tierra, ~1 min por combinación de parámetros) y un informe en `docs/`. Medio día.
