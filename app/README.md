# app/ — la app

## Qué hace

```
① INICIO     la Tierra, la Luna y Marte en 3D, con texturas reales de NASA
② FILTROS    ¿Qué quieres probar? [Ruedas ▾]   ¿Para dónde? [Marte · Jezero ▾]   [Buscar]
③ VUELO      la cámara va al objetivo (Marte, Jezero) y lo marca
④ RESULTADO  vuela a la Tierra, la colorea por índice (0–100) y baja sola al mejor match
⑤ FICHA      clic → índice + nota de cada variable (valor Marte vs. valor Tierra, con unidades y fuente)
              + bloque "no análogo" (gravedad, presión…) + validez de la prueba + fotos a la misma escala
⑥ AL REVÉS   clic en cualquier punto de la Tierra → a qué sitio de la Luna o Marte se parece más
```

**Regla:** primero que funcione lo básico (Tierra coloreada + clic → ficha). Después, vuelos y animaciones.

## De dónde saca los datos

- **Los matches:** SOLO de `app/data/`. La app **nunca** descarga datos científicos de NASA.
- **Los mapas y fotos:** en vivo desde los servidores de mapas (Worldview/GIBS para la Tierra, Moon Trek / Mars Trek para la Luna y Marte). Son públicos y no piden cuenta [verificar URLs de teselas].
- **Sin servidor propio:** es una web estática (GitHub Pages / Vercel).

## Formato de `app/data/` (el contrato entre el motor y la app)

Lo escribe [`src/analogs/export.py`](../src/analogs/export.py). Para tener ya datos falsos: `python scripts/make_mock_data.py`.

| Fichero | Contenido |
|---|---|
| `config.json` | `variables` (unidad, tolerancia, tipo), `pruebas` (pesos + frase de validez), `bodies` (gravedad, presión, día) y `operability` |
| `objetivos.json` | `{"objetivos": [{id, name, body, lat, lon, type, features: {slope_deg: …, t_mean_K: …}}]}` |
| `tierra.json` | `{"n_cells": N, "columns": {"cell_id": […], "lat": […], "lon": […], "slope_deg": […], …}}`, una lista por columna, `null` = sin dato |
| `analogos_conocidos.json` | `{"analogos": [{name, country, lat, lon, analog_of, environment, notes}]}` |
| `marte/index.json` + `marte/rNNN.bin.gz` | **Planet-wide card grid** (decision 007): every H3 res-5 cell of Mars, compact binary, one gzip file per H3 base cell (122). Format and how to do it for Earth/Moon: [`docs/07_card_grid_binary_format.md`](../docs/07_card_grid_binary_format.md). Read with `new CardGrid('marte')` → `cardAt(lat, lon)` ([`src/grid.js`](src/grid.js)) |

`marte/objetivos.json`: **real** cards of the 12 Mars target sites (`features` = variables of `configs/variables.yaml`, `extras` = other card columns, `h3` = their cell). `objetivos.json` stays the mock package until the Moon and Earth are real (`scripts/build_comparator_data.py` rejects mixed real/mock files).

Si llevan `"_aviso": "DATOS FALSOS…"`, la app debe enseñarlo bien visible.

## La fórmula (tiene que ser IDÉNTICA a `src/analogs/similarity.py`)

```
nota_k  = max(0, 1 − |objetivo_k − tierra_k| / tolerancia_k)      (numérica)
nota_k  = matriz[objetivo_k][tierra_k], o igual → 1 / distinto → 0   (categórica)
índice  = 100 · Σ peso_k · nota_k / Σ peso_k     (solo variables con dato en los dos)
```

Comprobación: con el ejemplo de [`tests/test_similarity.py`](../tests/test_similarity.py), la versión de la app tiene que dar 37,5 / 82,5 / 77,5.

## 🚙 Planificador de ensayos del rover (segunda vista: menú del título → "Rover test planner")

**Cómo se abre:** el título de la barra ("Analogs ▾") es un menú con las dos vistas. "Analogs" es el buscador de análogos tal cual; "Rover test planner" enseña **solo lo del rover** (se esconden la barra de resultados, el panel de índice, el selector "Test" y el intercambio de cuerpos; a la izquierda queda Marte o la Luna y a la derecha siempre la Tierra). También se abre directo con `#rover` al final de la dirección. El punto clicado se conserva al cambiar de vista.

**Qué responde:** mandas un rover al punto que has clicado en Marte o la Luna → **dónde de la Tierra se puede probar cada pieza**, dónde se prueba el rover entero, y qué no se puede probar en ningún sitio (va al laboratorio).

| Fichero | Qué hace |
|---|---|
| [`data/rover.json`](data/rover.json) | **La configuración, escrita a mano:** las piezas, las variables de la ficha de las que depende cada una, su margen (±), los límites por la física (gravedad, vacío) y qué nodos del modelo 3D forman cada pieza |
| [`src/rover.js`](src/rover.js) | El menú de vistas, el cálculo (`RoverPlanner`) y el panel. Usa la misma tabla de la Tierra que el buscador (`loadTable('earth')` de `match.js`): no descarga nada nuevo |
| [`src/main.js`](src/main.js) | Solo el enganche: las líneas marcadas con `// [rover]` (crear la vista, pasarle el punto clicado en vez de buscar análogos, y contar sus paneles al encuadrar la cámara) |
| [`src/rover3d.js`](src/rover3d.js) | El rover 3D con piezas clicables (three.js). Solo se descarga al abrir el planificador |
| `data/rover/perseverance.glb` | Modelo 3D de Perseverance, **NASA/JPL-Caltech**, del repositorio [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) (sin copyright; hay que citar la fuente). `data/rover/draco/` = descompresor del modelo (viene con three.js) |

**El método (una "caja" por pieza):**

```
d = máx_k |tierra_k − objetivo_k| / margen_k        (el eslabón más débil manda)

✔ campo        hay celdas de la Tierra con d ≤ 1  (todas sus variables dentro del margen)
◐ con reservas solo hay celdas con d ≤ 2, o falta una variable, o la física lo limita (gravedad, aire tenue)
✖ laboratorio  ninguna celda con d ≤ 2, o la pieza necesita vacío

índice de ensayabilidad = 100 · (campo + ½ · con reservas) / piezas
```

- Si `margen` es `null` en `rover.json`, se usa la `tolerance` de `configs/variables.yaml` (no el `half_diff` de la nota suave del buscador: aquí hace falta un límite duro, "dentro o fuera").
- **Todos los márgenes y límites son [supuesto] nuestros.** Se cambian en `rover.json` y la app recalcula sola.
- "Rover entero": celdas donde pasan más piezas a la vez. "Campaña": el menor número de sitios que cubren todas las piezas (empieza en el mejor y añade el más cercano que cubra lo que falta).
- Respeta el filtro "Earth zone": sirve para preguntar "¿qué puedo probar dentro de esta región?".
- Comprobado en el navegador: Jezero 70 %, Shackleton 30 % (control térmico y polvo, solo laboratorio).

**Pendiente:** el taladro solo compara el hielo: falta el tipo de roca en la tabla de búsqueda de la Tierra (la sílice ya está en la malla, no en `match.bin.gz`), y las rocas en superficie no existen como dato de la Tierra.

## Opciones de librería (decidir el sábado)

| Opción | Pros | Contras |
|---|---|---|
| **globe.gl** (three.js) | Globo 3D en pocas líneas; texturas propias (Luna, Marte); vuelo de cámara con una llamada [verificar API] | Menos control que Cesium |
| **CesiumJS** | Muy potente, vuelos de cámara, muchos formatos | Cuesta más aprenderla |
| **React + MapLibre** | Control total, mapas 2D/globo | Hace falta alguien cómodo con JS |
| **Streamlit + pydeck** | Todo en Python, rápido | Menos vistoso; animaciones limitadas |

Texturas: NASA Blue Marble (Tierra), mosaicos de LRO (Luna) y Viking/MOLA (Marte) [verificar fuentes y licencias].
