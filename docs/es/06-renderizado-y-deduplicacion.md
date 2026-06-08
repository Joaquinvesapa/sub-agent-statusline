# Renderizado y deduplicación

`src/render.ts` convierte el estado interno en una vista útil. No muestra todos los `children` tal como están guardados. Primero ordena, colapsa duplicados, filtra filas y arma un resumen agregado.

La regla central:

> La UI muestra trabajo entendible para humanos, no todos los detalles técnicos que el estado guarda como evidencia.

## De estado interno a filas visibles

El flujo conceptual es:

```txt
StatuslineState.children
  ↓
ordenar por prioridad
  ↓
collapseSubagentWorkItems()
  ↓
filtrar visibilidad
  ↓
renderStatusLine() / sidebar
```

Esto explica por qué puede haber tres entradas internas para un solo trabajo delegado, pero una sola fila visible.

## Por qué hace falta deduplicar

OpenCode puede emitir varias representaciones del mismo subagente:

```txt
tool:prt_task       wrapper técnico de task
subtask:prt_sub     parte sintética de mensaje
ses_child           sesión hija real
```

Para el usuario, eso suele ser una sola delegación.

Si la UI mostrara todo sin procesar, aparecerían duplicados como:

```txt
↳ Run tests       running
↳ Run tests       running
↳ test-agent      running
```

El render intenta mostrar una sola fila clara, usando la mejor evidencia disponible.

## Diferencia entre deduplicación y conteo

Deduplicar filas visibles no es lo mismo que contar ejecuciones.

| Concepto             | Dónde vive                 | Pregunta que responde                  |
| -------------------- | -------------------------- | -------------------------------------- |
| Conteo               | `src/state.ts`             | ¿Cuántas ejecuciones reales hubo?      |
| Deduplicación visual | `src/render.ts`            | ¿Cuántas filas debería ver el usuario? |
| Estado interno       | `StatuslineState.children` | ¿Qué evidencia conoce el plugin?       |

Ejemplo:

```txt
children internos: 3
filas visibles:   1
totalExecuted:    1
```

Esto puede ser completamente correcto.

## Orden de prioridad

Antes de renderizar, los items se ordenan para que lo más relevante aparezca primero.

Reglas generales:

- items más nuevos primero;
- `running` y `error` importan más que históricos viejos;
- tie-break por `id` para mantener orden estable.

El orden estable evita que la UI salte de forma innecesaria cuando dos items tienen timestamps iguales.

## Collapse de work items

La función principal es `collapseSubagentWorkItems()`.

Su objetivo es agrupar representaciones relacionadas del mismo trabajo.

Agrupaciones típicas:

| Caso                                                     | Resultado esperado                           |
| -------------------------------------------------------- | -------------------------------------------- |
| `subtask:*` con `targetSessionID` hacia `ses_*`          | Se muestra una sola fila enriquecida.        |
| `tool:*` asociado a un `subtask:*` y una sesión real     | Se oculta el wrapper técnico.                |
| sesión real duplicada por fila sintética más descriptiva | Se fusionan datos terminales/tokens/timing.  |
| wrapper genérico sin correlación segura                  | No se colapsa con una sesión no relacionada. |

## Qué datos se fusionan

Cuando hay una relación segura, el render puede copiar o preferir datos de una sesión real hacia una fila sintética.

Datos útiles:

- `status` terminal (`done` o `error`);
- `endedAt`;
- duración;
- `targetSessionID`;
- tokens/contexto;
- color;
- resumen o título más útil.

Esto permite que una fila con buen título humano, por ejemplo `Review current diff`, muestre el estado real de la sesión `ses_child`.

## Ejemplo: subtask + sesión

Estado interno:

```ts
children = {
  "subtask:prt_1": {
    id: "subtask:prt_1",
    source: "subtask",
    title: "Review current diff",
    targetSessionID: "ses_child",
    status: "running",
  },
  ses_child: {
    id: "ses_child",
    source: "session",
    targetSessionID: "ses_child",
    status: "done",
    endedAt: "...",
  },
};
```

Fila visible esperada:

```txt
Review current diff · done
```

La sesión real aporta el estado terminal, pero la fila conserva el título más útil del subtask.

## Ejemplo: wrapper técnico sin target

Estado interno:

```ts
children = {
  "tool:prt_task": {
    id: "tool:prt_task",
    source: "tool",
    title: "task",
    status: "running",
  },
  ses_other: {
    id: "ses_other",
    source: "session",
    status: "running",
  },
};
```

Si no hay evidencia segura de que `tool:prt_task` corresponde a `ses_other`, el render no debe colapsarlos.

Esto evita ocultar trabajo real por una suposición incorrecta.

## Visibilidad de filas `done`

El plugin no mantiene todas las finalizaciones visibles para siempre.

Reglas generales:

- `running` se mantiene visible;
- `error` se mantiene visible;
- `done` reciente se mantiene visible por feedback;
- `done` viejo puede ocultarse;
- si hay trabajo activo, se priorizan filas relacionadas con ese trabajo.

Esto mantiene la sidebar útil y evita que se convierta en un historial largo.

La sidebar puede relajar temporalmente los filtros de `done` con completed
history. Cuando completed history está activo, las filas `done` viejas y las
filas `done` no relacionadas con el trabajo activo vuelven a mostrarse después
del collapse/dedupe normal. El statusline textual y el resumen de home conservan
el filtrado por defecto.

## Relación con poda de estado

Ocultar una fila en render no significa borrarla inmediatamente del estado.

Hay dos capas distintas:

1. **Filtro de visibilidad** en `src/render.ts`.
2. **Poda de estado** en `src/state.ts`, que conserva filas terminales hasta 3
   días con un límite de 1.500 filas.

El filtro decide qué ve el usuario ahora. La poda evita que el estado crezca indefinidamente.

Ninguna de las dos debería reducir `totalExecuted`.

Completed history solo muestra filas retenidas. No restaura filas que la poda de
estado ya eliminó ni sesiones pasadas que las APIs de OpenCode no devuelven.

## Render textual

Además de la sidebar TUI, el proyecto puede producir un statusline textual.

Ejemplo conceptual:

```txt
↳ 1 running · 1 done · 0 error · Σ 2 total · Review diff 00:42 · Tests 01:10
```

El render textual incluye:

- cantidad de running;
- cantidad de done visibles;
- cantidad de error;
- total ejecutado;
- detalles compactos por child visible;
- tokens/contexto cuando existen.

## Formato de duración

Las duraciones se formatean de forma compacta.

| Duración        | Formato    |
| --------------- | ---------- |
| Menos de 1 hora | `MM:SS`    |
| 1 hora o más    | `HH:MM:SS` |

Ejemplos:

```txt
00:08
04:31
01:12:09
```

## Formato de tokens/contexto

Cuando hay información disponible, el plugin puede mostrar tokens y uso de contexto.

Ejemplos conceptuales:

```txt
1,500 tokens · 12.3% used
1.5k ctx 12%
```

La disponibilidad depende de OpenCode. Si la información no aparece en eventos, TUI state, SQLite o logs, se omite.

## Color

El render textual puede usar ANSI colors.

Se puede desactivar con:

```sh
NO_COLOR=1
```

O con:

```sh
OPENCODE_SUBAGENT_STATUSLINE_COLOR=0
```

La TUI usa su propio render visual, pero la normalización de estados/colores sigue siendo parte del modelo.

## Estados agregados

El resumen agregado se basa en filas visibles y total semántico.

Ejemplo:

```txt
↳ 1 running · 0 done · 1 error · Σ 2 total
```

Importante:

- `running`, `done` y `error` describen filas visibles o relevantes;
- `Σ total` viene del contador semántico;
- el total puede ser mayor que la cantidad de filas visibles actuales.

## Casos donde ver menos filas es correcto

### Caso A: tool + session

```txt
Estado:
- tool:prt_task
- ses_child

Visible:
- ses_child

Total:
- 1
```

El wrapper desaparece porque no aporta una fila humana adicional.

### Caso B: subtask + session

```txt
Estado:
- subtask:prt_1
- ses_child

Visible:
- subtask enriquecido con datos de ses_child

Total:
- 1
```

Se conserva la fila con mejor título, pero se toma estado real de la sesión.

### Caso C: done viejo

```txt
Estado:
- ses_old done
- ses_running running

Visible:
- ses_running

Total:
- conserva historial ejecutado
```

La finalización vieja se oculta para no ensuciar la vista.

Con completed history activo en la sidebar, esa fila `done` vieja vuelve a ser
visible si todavía está retenida en el estado.

## Casos donde no colapsar es correcto

### Caso A: wrapper ambiguo

```txt
- tool:prt_task sin target
- ses_a
- ses_b
```

No hay forma segura de saber a cuál sesión pertenece el wrapper. Se evita colapsar.

### Caso B: múltiples IDs en output

```txt
output: "task_id: ses_a ... task_id: ses_b"
```

Si hay más de un candidato, el plugin no elige uno al azar.

### Caso C: títulos genéricos

Un título parecido no alcanza por sí solo para deduplicar si falta parent/message/target confiable.

## Relación con la sidebar

La sidebar TUI usa el resultado del render/derivación para mostrar filas humanas.

Además, aplica reglas propias de UX:

- preferir subagentes de la sesión actual;
- mostrar “Other sessions” cuando corresponda;
- permitir foco y navegación;
- abrir una sesión solo si hay `targetSessionID` navegable;
- conservar scroll y estado expandido/colapsado.

La deduplicación evita que la sidebar muestre wrappers técnicos como si fueran subagentes independientes.

## Relación con tests

Los tests de render protegen estos comportamientos:

| Test                 | Garantía                                                      |
| -------------------- | ------------------------------------------------------------- |
| `src/render.test.ts` | Collapse entre sintéticos y sesiones reales.                  |
| `src/render.test.ts` | No colapsar wrappers genéricos sin correlación.               |
| `src/render.test.ts` | Mantener visibles `done` recientes.                           |
| `src/render.test.ts` | Ocultar históricos no relacionados cuando hay trabajo activo. |
| `src/render.test.ts` | Orden estable.                                                |
| `src/render.test.ts` | Formato agregado y `NO_COLOR`.                                |

También dependen de tests en:

- `src/state.test.ts`, para conteo correcto;
- `src/events.test.ts`, para target/correlación segura;
- `src/reconcile.test.ts`, para cierres conservadores.

## Checklist para cambios futuros

Antes de tocar render o deduplicación, preguntate:

- ¿Estoy ocultando una fila solo con evidencia segura?
- ¿El wrapper técnico sigue sin contar como ejecución?
- ¿El título visible sigue siendo el más útil para humanos?
- ¿La sesión real sigue siendo navegable vía `targetSessionID`?
- ¿Los errores siguen visibles?
- ¿Los `done` recientes siguen dando feedback suficiente?
- ¿El total semántico sigue independiente de la cantidad de filas visibles?
- ¿Agregué o actualicé tests de render si cambié una regla visual?

## Resumen

El render es la capa que transforma evidencia técnica en una vista humana.

Sus responsabilidades son:

- evitar duplicados visuales;
- preservar información útil;
- ocultar ruido técnico;
- mantener errores y actividad visibles;
- mostrar finalizaciones recientes sin convertir la sidebar en historial;
- mantener separado el total semántico de la cantidad de filas visibles.

Esta separación es lo que permite que el plugin sea confiable aunque OpenCode emita la misma delegación como tool call, subtask y sesión real.
