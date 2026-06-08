# Instalación y uso

`opencode-subagent-statusline` se instala como plugin TUI de OpenCode. Una vez activo, agrega una sección de subagentes en la sidebar y un resumen compacto en la pantalla de inicio cuando hay actividad.

## Instalación rápida

Agregá el paquete al archivo de configuración TUI de OpenCode:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-subagent-statusline"]
}
```

La ruta usual es:

```txt
~/.config/opencode/tui.json
```

Después reiniciá OpenCode.

## Qué deberías ver

Cuando haya actividad de subagentes, el plugin puede mostrar:

- subagentes corriendo;
- subagentes terminados recientemente;
- subagentes con error;
- duración;
- uso de tokens/contexto cuando OpenCode lo expone;
- un resumen agregado en home;
- una lista navegable en la sidebar.

Ejemplo conceptual:

```txt
Subagentes
  ● Review current diff       00:42
  ✓ Run tests                 01:10
  ✕ Typecheck                 00:08

↳ 1 running · 1 done · 1 error · Σ 3 total
```

Los textos exactos pueden variar según el estado, la versión de OpenCode y la información disponible en eventos.

## Probar una build local

Para desarrollar o probar cambios locales:

```sh
pnpm install
pnpm build
```

Después apuntá OpenCode al archivo construido:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
}
```

Usá una ruta absoluta. No copies solamente `dist/tui.js` a otro lugar sin entender las dependencias: el plugin espera correr dentro del contexto del paquete/proyecto o del cache de OpenCode.

## Uso diario

El plugin no requiere comandos para empezar a recolectar actividad. Una vez cargado:

1. OpenCode emite eventos de sesiones, mensajes y partes.
2. El plugin detecta actividad de subagentes.
3. La sidebar muestra filas relevantes.
4. El resumen inferior aparece cuando hay actividad o conteo.
5. Si una fila tiene una sesión real asociada, se puede abrir desde la UI.

## Estados visibles

| Estado    | Qué significa                                             |
| --------- | --------------------------------------------------------- |
| `running` | Hay evidencia de trabajo activo, pendiente o en progreso. |
| `done`    | El trabajo terminó o quedó idle exitosamente.             |
| `error`   | Hubo error, fallo, cancelación o aborto.                  |

OpenCode puede emitir muchas palabras distintas para estados. El plugin las normaliza a estos tres estados internos.

## Total ejecutado

El total mostrado como `Σ total` no es una suma de filas visibles.

Representa ejecuciones reales de subagentes.

Por eso estas situaciones son normales:

| Situación                                                | Resultado correcto                 |
| -------------------------------------------------------- | ---------------------------------- |
| Un wrapper `task` y una sesión real representan lo mismo | Cuenta 1.                          |
| Hay tres entradas internas pero una sola fila visible    | Puede contar 1.                    |
| Un `done` viejo ya no se ve                              | El total histórico no baja.        |
| Tokens/contexto no aparecen                              | La fila se muestra sin esos datos. |

Para más detalle, ver [Modelo de estado y contadores](./05-modelo-de-estado-y-contadores.md).

## Navegación básica

La sidebar soporta navegación por teclado cuando la lista está enfocada.

| Atajo              | Acción                                                    |
| ------------------ | --------------------------------------------------------- |
| `Alt+B`            | Alterna foco entre la lista de subagentes y el prompt.    |
| `j` / `ArrowDown`  | Mueve la selección al siguiente subagente visible.        |
| `k` / `ArrowUp`    | Mueve la selección al subagente anterior.                 |
| `Enter`            | Abre la sesión seleccionada, si hay una sesión navegable. |
| `c`                | Alterna completed history para filas `done` retenidas.    |
| `h` / `ArrowLeft`  | Colapsa la sección.                                       |
| `l` / `ArrowRight` | Expande la sección.                                       |
| `Esc`              | Sale del modo foco y vuelve al prompt.                    |

También podés usar la command palette de OpenCode:

```txt
Subagents: Focus sidebar list
Subagents: Toggle sidebar section
Subagents: Toggle completed history
```

## Cuándo una fila se puede abrir

Una fila se puede abrir cuando el plugin conoce un `targetSessionID` real, normalmente con forma `ses_*`.

Si la fila viene solo de un wrapper técnico o de una subtarea sin sesión conocida, puede mostrarse pero no ser navegable todavía.

## Tokens y contexto

El plugin muestra tokens/contexto solo cuando consigue evidencia confiable.

Puede obtenerla desde:

- payloads de eventos;
- estado vivo de la TUI;
- base SQLite de OpenCode;
- logs recientes.

Si OpenCode no expone esos datos, el plugin omite la información sin romper la fila.

## Problemas comunes

### El plugin no aparece

Revisá logs de OpenCode:

```sh
grep -n "subagent-statusline\|failed to load tui plugin" ~/.local/share/opencode/log/*.log
```

Después verificá:

- que `~/.config/opencode/tui.json` tenga JSON válido;
- que el campo se llame `plugin`;
- que hayas reiniciado OpenCode;
- que la ruta local, si usás una, sea absoluta y apunte a `dist/tui.js`.

### Instalé una versión nueva pero veo la vieja

OpenCode puede cachear paquetes.

Probá limpiar:

```txt
~/.cache/opencode/packages/
```

Después reiniciá OpenCode.

### No veo tokens/contexto

Eso puede ser normal. La disponibilidad depende de lo que OpenCode exponga en eventos, estado, SQLite o logs.

El plugin está diseñado para seguir funcionando aunque esa información falte.

## Siguiente lectura

Para entender cómo se ve y navega la UI, seguí con:

- [Interfaz TUI](./07-interfaz-tui.md)

Para configuración avanzada, debug y rutas:

- [Configuración avanzada](./08-configuracion-avanzada.md)
