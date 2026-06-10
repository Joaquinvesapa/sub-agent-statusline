# Solución de problemas

Esta guía junta problemas comunes al instalar, usar o desarrollar `opencode-subagent-statusline`.

La estrategia general:

> Primero verificá que OpenCode esté cargando el plugin correcto. Después mirá eventos, estado, cache y datos disponibles.

## El plugin no aparece

### 1. Revisá la configuración TUI

Archivo usual:

```txt
~/.config/opencode/tui.json
```

Configuración mínima:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-statusline"]
}
```

Si usás build local:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
}
```

Puntos a verificar:

- el JSON es válido;
- el campo se llama `plugin`;
- la ruta local es absoluta;
- ejecutaste `pnpm build` antes de apuntar a `dist/tui.js`;
- reiniciaste OpenCode después de cambiar config.

### 2. Revisá logs de OpenCode

```sh
grep -n "subagent-statusline\|failed to load tui plugin" ~/.local/share/opencode/log/*.log
```

Buscá errores de:

- paquete no encontrado;
- ruta inválida;
- entrypoint incorrecto;
- dependencia peer no disponible;
- excepción al inicializar la TUI.

## OpenCode sigue usando una versión vieja

OpenCode puede cachear paquetes.

Probá limpiar:

```txt
~/.cache/opencode/packages/
```

Después reiniciá OpenCode.

Si estás probando localmente, asegurate de que `tui.json` apunte a la ruta local de `dist/tui.js`, no al paquete npm cacheado.

## No veo subagentes aunque están corriendo

Posibles causas:

1. OpenCode no emitió todavía un evento que el plugin pueda interpretar.
2. La actividad pertenece a otra sesión, así que no aparece en la sidebar de la sesión actual.
3. La fila existe pero fue colapsada con otra representación.
4. La sesión todavía no tiene `targetSessionID` navegable.
5. El plugin no cargó correctamente.

Qué revisar:

- logs de OpenCode;
- si la sidebar está habilitada;
- si la sección está colapsada;
- si hay actividad en el resumen global de home o después de navegar a la sesión dueña;
- si `Alt+B` enfoca la lista;
- si el problema se reproduce con una nueva delegación.

Para debug profundo, activá eventos:

```sh
OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS=1 opencode
```

## Veo menos filas de las esperadas

Puede ser correcto.

El plugin deduplica representaciones técnicas del mismo trabajo.

Ejemplo interno:

```txt
tool:prt_task
subtask:prt_1
ses_child
```

Fila visible:

```txt
Review current diff
```

Esto evita mostrar wrappers `task`/`delegate` como subagentes duplicados.

Si querés entender la regla, leé:

- [Modelo de estado y contadores](./05-modelo-de-estado-y-contadores.md)
- [Renderizado y deduplicación](./06-renderizado-y-deduplicacion.md)

## El total no coincide con la cantidad de filas

También puede ser correcto.

`Σ total` cuenta ejecuciones reales, no filas visibles. En la sidebar está
limitado a la sesión actual; en el resumen de home y el statusline textual sigue
siendo global entre sesiones.

Casos normales:

| Caso                                         | Por qué pasa                                    |
| -------------------------------------------- | ----------------------------------------------- |
| Hay más entradas internas que filas          | El render colapsó duplicados.                   |
| El total es mayor que filas visibles         | Filas `done` viejas se ocultaron o podaron.     |
| Un wrapper aparece pero no suma              | `source: "tool"` es evidencia, no ejecución.    |
| Un subtask y una sesión cuentan una sola vez | El contador se reconcilió hacia la sesión real. |

## Veo subagentes `running` viejos

El plugin es conservador para cerrar filas viejas.

No marca un subagente como `done` solo porque pasó tiempo. Primero busca evidencia en:

- estado vivo de TUI;
- estado de sesión de OpenCode;
- mensajes del child;
- actividad reciente del parent;
- umbral de stale-running.

Si una fila queda `running`, puede ser porque no hubo evidencia terminal segura.

Para diagnóstico, se puede ajustar temporalmente:

```sh
OPENCODE_SUBAGENT_STATUSLINE_STALE_RUNNING_MS=3600000 opencode
```

No uses valores muy bajos como configuración permanente salvo que entiendas el riesgo: podrías cerrar visualmente trabajo que sigue activo.

## No aparecen tokens/contexto

Esto es común.

El plugin muestra tokens/contexto solo si encuentra datos en alguna fuente:

- eventos de OpenCode;
- estado vivo de TUI;
- SQLite de OpenCode;
- logs recientes.

Si OpenCode no expone esa información o el formato cambió, la fila se muestra sin tokens.

Podés probar una ruta custom a la DB:

```sh
OPENCODE_SUBAGENT_STATUSLINE_OPENCODE_DB=/path/to/opencode.db opencode
```

Pero la ausencia de tokens no significa necesariamente que el plugin esté roto.

## `Alt+B` no enfoca la lista

Verificá:

1. que el plugin cargó;
2. que la sidebar está habilitada;
3. que hay filas visibles o la sección existe;
4. que OpenCode no está capturando el atajo en otra capa;
5. que la versión de OpenCode expone la API de keymap esperada o la fallback legacy.

También podés probar desde la command palette:

```txt
Subagents: Focus sidebar list
```

Si el comando funciona pero el atajo no, el problema probablemente está en keybinding/capa de foco.

## `Enter` no abre una sesión

Una fila solo puede abrirse si tiene una sesión real navegable.

Condición típica:

```txt
targetSessionID = "ses_..."
```

Si la fila viene de:

- `tool:*` sin target;
- `subtask:*` sin sesión real;
- evidencia incompleta;

entonces puede mostrarse pero no navegar.

Esto es intencional. La UI no inventa una sesión de destino.

## La sección desaparece o se colapsa

La TUI guarda preferencias en `api.kv`:

- `subagents.sidebar.expanded`
- `subagents.sidebar.enabled`

Probá:

- usar `Subagents: Toggle sidebar section`;
- usar `Alt+B`;
- reiniciar OpenCode;
- revisar si el problema aparece solo en una sesión o globalmente.

## Build local no refleja cambios

Pasos:

1. Corré build:

   ```sh
   pnpm build
   ```

2. Verificá que `tui.json` apunte a:

   ```txt
   /absolute/path/to/sub-agent-statusline/dist/tui.js
   ```

3. Reiniciá OpenCode.
4. Si seguís viendo el paquete npm, revisá cache de OpenCode.

## Tests fallan por estado o filesystem

Los tests de runtime usan temp dirs y variables de entorno.

Si agregaste una variable nueva que se muta en tests, asegurate de restaurarla en `test/setup.ts`.

Si un test escribe archivos:

- usá `createRuntimeHarness()`;
- no hardcodees rutas globales;
- limpiá timers/mocks;
- preferí fixtures chicos.

## Tests con tiempo fallan de forma intermitente

Usá fake timers explícitos.

Helper recomendado:

```ts
useFrozenTime("2026-01-01T00:00:00.000Z");
```

Evitá depender del reloj real si estás probando duración, poda o stale-running.

## Snapshots frágiles

Si un snapshot falla por cambios menores de formato, preguntate si realmente querés proteger todo el output.

Preferí asserts focalizados:

```ts
expect(output).toContain("1 running");
expect(output).toContain("Review current diff");
```

Usá snapshot solo si el shape completo es el contrato.

## `pnpm typecheck` pasa pero el paquete puede no publicar bien

El CI de PR corre:

```sh
pnpm typecheck
pnpm test
```

No corre build ni pack dry-run.

Si tocaste packaging, exports, assets o `package.json.files`, corré:

```sh
pnpm build
pnpm pack --dry-run
```

## Docs en `docs/es/` no aparecen en npm

Con la configuración actual de `package.json`, se publican:

```txt
dist
assets
README.md
```

`docs/es/` es documentación del repo, pero no se incluiría en el paquete npm.

Si se quiere publicar, hay que agregar `docs` o `docs/es` a `package.json.files` y validar con:

```sh
pnpm pack --dry-run
```

## Activar log de eventos

Para investigar eventos reales:

```sh
OPENCODE_SUBAGENT_STATUSLINE_DEBUG_EVENTS=1 opencode
```

El log se escribe como JSONL bajo runtime/tmp, por ejemplo:

```txt
$XDG_RUNTIME_DIR/opencode-subagent-statusline/tui-events.log
```

Precaución: puede crecer rápido y contener datos de sesiones.

## Checklist rápido

Cuando algo falla, seguí este orden:

1. ¿OpenCode carga el plugin?
2. ¿`tui.json` apunta al paquete o build correcta?
3. ¿Reiniciaste OpenCode?
4. ¿Hay errores en logs?
5. ¿Estás viendo una versión cacheada?
6. ¿La sidebar está habilitada y expandida?
7. ¿Hay eventos reales de subagentes?
8. ¿El item tiene `targetSessionID` si esperás navegación?
9. ¿La ausencia de tokens/contexto puede ser normal?
10. ¿El comportamiento puede ser deduplicación correcta?

## Archivos útiles para investigar

| Archivo                                | Cuándo mirarlo                                 |
| -------------------------------------- | ---------------------------------------------- |
| `README.md`                            | Instalación y troubleshooting básico.          |
| `docs/es/02-instalacion-y-uso.md`      | Uso normal y setup local.                      |
| `docs/es/08-configuracion-avanzada.md` | Variables de entorno, rutas y debug.           |
| `src/events.ts`                        | Si un evento no se interpreta.                 |
| `src/state.ts`                         | Si el conteo o persistencia parece incorrecto. |
| `src/render.ts`                        | Si una fila aparece/desaparece raro.           |
| `src/reconcile.ts`                     | Si un `running` viejo no se cierra.            |
| `src/tui.tsx`                          | Si falla UI, hydration o navegación.           |
| `src/tui-commands.ts`                  | Si fallan comandos o `Alt+B`.                  |
| `test/helpers/runtime-harness.ts`      | Si fallan tests de filesystem/env.             |
