# Interfaz TUI

La interfaz principal del plugin es una sección en la sidebar de OpenCode. Su objetivo es mostrar actividad de subagentes sin obligarte a salir del flujo de trabajo actual.

## Superficies visuales

El plugin registra varias superficies TUI:

| Superficie        | Uso                                        |
| ----------------- | ------------------------------------------ |
| `sidebar_content` | Lista principal de subagentes.             |
| `home_bottom`     | Resumen compacto en la pantalla de inicio. |
| `home_prompt`     | Wrapper del prompt para conservar foco.    |
| `session_prompt`  | Wrapper del prompt dentro de sesiones.     |

La parte visible para usuarios está principalmente en `sidebar_content` y `home_bottom`.

## Sidebar de subagentes

La sidebar muestra una lista compacta de work items relacionados con subagentes.

Puede incluir:

- título humano de la tarea;
- estado;
- duración;
- tokens/contexto si están disponibles;
- indicador de sesión navegable;
- agrupación por sesión actual u otras sesiones.

Ejemplo conceptual:

```txt
Subagentes

● Review current diff        00:42
✓ Run focused tests          01:10 · 1.5k ctx 12%
✕ Typecheck                  00:08
```

## Sesión actual y otras sesiones

La sidebar intenta priorizar subagentes relacionados con la sesión actual de OpenCode.

Si no hay subagentes de la sesión actual, o si hay actividad relevante fuera de ella, puede mostrar una sección de “otras sesiones”.

Esto ayuda en dos casos:

1. cuando navegás entre sesiones;
2. cuando el plugin hidrata actividad previa o concurrente.

## Estados visuales

| Estado interno | Significado para la UI                                            |
| -------------- | ----------------------------------------------------------------- |
| `running`      | Trabajo activo o pendiente. Debe permanecer visible.              |
| `done`         | Trabajo terminado recientemente. Puede ocultarse después.         |
| `error`        | Trabajo fallido. Debe permanecer visible para llamar la atención. |

La UI evita convertir la sidebar en un historial infinito. Por eso las filas `done` viejas pueden desaparecer aunque sigan habiendo contado para `totalExecuted`.

## Resumen en home

Cuando hay actividad relevante, el plugin puede mostrar un resumen compacto en la parte inferior de home.

Ejemplo:

```txt
↳ 1 running · 1 done · 0 error · Σ 2 total
```

Este resumen sirve para saber rápidamente si hay subagentes activos sin abrir la sidebar.

## Foco de la lista

La sidebar tiene un modo de foco para navegación con teclado.

El atajo principal es:

```txt
Alt+B
```

Ese atajo alterna entre:

- foco en la lista de subagentes;
- foco de vuelta en el prompt.

Cuando la lista está enfocada, los atajos de navegación se aplican a la lista. Cuando no está enfocada, el prompt mantiene el control normal.

## Atajos de teclado

| Atajo        | Acción                                       |
| ------------ | -------------------------------------------- |
| `Alt+B`      | Alterna foco entre lista y prompt.           |
| `j`          | Selecciona el siguiente subagente visible.   |
| `ArrowDown`  | Selecciona el siguiente subagente visible.   |
| `k`          | Selecciona el subagente anterior.            |
| `ArrowUp`    | Selecciona el subagente anterior.            |
| `Enter`      | Abre la sesión seleccionada si es navegable. |
| `c`          | Alterna completed history para filas `done` retenidas. |
| `h`          | Colapsa la sección.                          |
| `ArrowLeft`  | Colapsa la sección.                          |
| `l`          | Expande la sección.                          |
| `ArrowRight` | Expande la sección.                          |
| `Esc`        | Sale del modo foco y vuelve al prompt.       |

## Comandos registrados

El plugin registra comandos para la command palette de OpenCode.

| Comando                             | Acción                         |
| ----------------------------------- | ------------------------------ |
| `Subagents: Focus sidebar list`     | Enfoca la lista de subagentes. |
| `Subagents: Toggle sidebar section` | Activa o desactiva la sección. |
| `Subagents: Toggle completed history` | Alterna filas completadas retenidas en la sidebar. |

Internamente, el plugin registra ambas APIs cuando están disponibles:
`keymap.registerLayer` mantiene el atajo `Alt+B`, y `command.register` mantiene
los comandos visibles en la command palette de OpenCode. Si solo existe una API,
el plugin usa esa ruta sin fallar.

## Abrir una sesión hija

`Enter` o click pueden abrir una sesión hija cuando la fila tiene un `targetSessionID` navegable.

Condición típica:

```txt
targetSessionID = "ses_..."
```

Si el plugin solo conoce un wrapper técnico `tool:*` o un subtask sin sesión real, la fila puede no ser navegable.

Esto es intencional: navegar requiere una sesión real de OpenCode.

## Expansión, colapso y preferencias

La sección puede expandirse o colapsarse.

Hacer click en `Σ`, presionar `c` con la lista enfocada o ejecutar
`Subagents: Toggle completed history` alterna completed history. Esto muestra
filas `done` viejas retenidas y filas `done` retenidas que no están relacionadas
con el trabajo activo. El toggle es transitorio y no se guarda en `api.kv`.

El plugin guarda preferencias en `api.kv` de OpenCode:

| Preferencia                  | Uso                                     |
| ---------------------------- | --------------------------------------- |
| `subagents.sidebar.expanded` | Recuerda si la sección está expandida.  |
| `subagents.sidebar.enabled`  | Recuerda si la sección está habilitada. |

Estas preferencias pertenecen al entorno TUI de OpenCode, no al archivo `state.json` del runtime plugin.

Completed history está limitado por la retención de estado: las filas terminales
se conservan hasta 3 días con un límite de 1.500 filas. Las filas ya podadas del
estado no se restauran.

## Scroll y selección

La lista mantiene selección y scroll para que navegar no sea incómodo cuando hay varios subagentes visibles.

Comportamiento esperado:

- la selección se mueve dentro de filas visibles;
- si una fila desaparece por deduplicación o filtro, la selección se ajusta;
- el scroll intenta conservar contexto;
- `Esc` devuelve el control al prompt.

## Relación con deduplicación

La sidebar consume filas ya procesadas por la lógica de render/dedupe.

Eso evita mostrar wrappers técnicos como subagentes independientes cuando hay evidencia de que corresponden al mismo trabajo.

Ejemplo:

```txt
Estado interno:
- tool:prt_task
- subtask:prt_1
- ses_child

Sidebar:
- Review current diff
```

La UI busca responder “qué trabajo delegado está pasando”, no “cuántas señales técnicas llegaron”.

## Información de tokens/contexto

Cuando hay datos, la fila puede mostrar uso de contexto en forma compacta.

Ejemplos:

```txt
1.5k ctx 12%
12.3% used
```

Si no hay datos, no se muestra nada extra. Eso no significa que el subagente no haya usado tokens; solo significa que OpenCode o las fuentes consultadas no expusieron esa información de forma disponible para el plugin.

## Hydration en la TUI

Cuando cambiás de sesión, la TUI intenta reconstruir subagentes previos consultando APIs de OpenCode.

Esto hace que la sidebar pueda mostrar actividad que ocurrió antes de que el plugin recibiera eventos live en la sesión actual.

El flujo es:

```txt
route/session change
  ↓
consultar children/messages/status
  ↓
crear eventos sintéticos internos
  ↓
aplicar pipeline normal
  ↓
actualizar sidebar
```

## Mantenimiento periódico

La TUI corre tareas periódicas:

- refrescar duración visible;
- intentar hidratar tokens/contexto;
- persistir snapshots auxiliares;
- reconciliar subagentes viejos que quedaron `running`.

La reconciliación es conservadora. No cierra filas viejas solo porque pasó tiempo; primero busca evidencia.

## Límites actuales

La documentación y los tests cubren bien la lógica que alimenta la UI, pero hay un límite importante:

> No hay automatización E2E profunda de la UI visual completa dentro del host OpenCode/OpenTUI.

Lo que sí está cubierto automáticamente:

- registro de comandos;
- fallback de comandos legacy;
- keybinding `Alt+B`;
- lógica de estado/render/reconcile que alimenta la UI.

Para cambios visuales o de interacción completa, se recomienda hacer smoke test manual en OpenCode.

## Smoke test manual sugerido

Para validar la TUI después de cambios:

1. Ejecutar build local:

   ```sh
   pnpm build
   ```

2. Configurar OpenCode con ruta absoluta a `dist/tui.js`.
3. Reiniciar OpenCode.
4. Ejecutar una delegación/subagente.
5. Verificar que aparece en la sidebar.
6. Probar `Alt+B`.
7. Probar `j/k`, flechas, `c` y `Esc`.
8. Hacer click en `Σ` y verificar que completed history alterna.
9. Si hay sesión navegable, probar `Enter`.
10. Confirmar que completions recientes aparecen y luego no ensucian la vista por defecto.

## Archivos relacionados

| Archivo               | Qué mirar                                     |
| --------------------- | --------------------------------------------- |
| `src/tui.tsx`         | UI, slots, hydration, reconcile y navegación. |
| `src/tui-commands.ts` | Comandos y keybindings.                       |
| `src/render.ts`       | Filas visibles y deduplicación previa a UI.   |
| `src/tui.test.ts`     | Tests de registro de comandos.                |
| `README.md`           | Tabla de shortcuts para usuarios.             |
