# Desarrollo y testing

Esta guía explica cómo preparar el proyecto localmente, qué comandos usar y cómo pensar los tests de `opencode-subagent-statusline`.

La regla práctica:

> El núcleo determinístico se prueba con Vitest. La UI completa dentro del host OpenCode/OpenTUI se valida con smoke tests manuales cuando hay cambios visuales.

## Requisitos

Según `CONTRIBUTING.md`, el proyecto espera:

- Node.js 20+
- pnpm 9+

Nota: el CI de PR usa pnpm 10, mientras que la documentación de contribución pide pnpm 9+. Para desarrollo normal, usá pnpm 9+ y respetá el lockfile.

## Instalación local

Desde la raíz del repo:

```sh
pnpm install
```

## Comandos principales

| Comando               | Para qué sirve                           |
| --------------------- | ---------------------------------------- |
| `pnpm build`          | Compila el paquete con `tsup`.           |
| `pnpm dev`            | Corre `tsup --watch`.                    |
| `pnpm typecheck`      | Ejecuta TypeScript sin emitir archivos.  |
| `pnpm test`           | Corre la suite Vitest una vez.           |
| `pnpm test:watch`     | Corre Vitest en modo watch.              |
| `pnpm test:coverage`  | Genera cobertura con V8.                 |
| `pnpm pack --dry-run` | Simula el paquete npm que se publicaría. |

Checklist recomendado antes de abrir PR:

```sh
pnpm typecheck
pnpm test
pnpm build
```

Si tocaste packaging o archivos publicados:

```sh
pnpm pack --dry-run
```

## Build

El build usa `tsup.config.ts` y genera dos salidas principales:

| Fuente         | Salida                  | Uso                        |
| -------------- | ----------------------- | -------------------------- |
| `src/tui.tsx`  | `dist/tui.js` + tipos   | Plugin TUI principal.      |
| `src/index.ts` | `dist/index.js` + tipos | Runtime plugin file-based. |

El paquete publica estos entrypoints:

```txt
opencode-subagent-statusline
opencode-subagent-statusline/tui
opencode-subagent-statusline/runtime
```

## TypeScript

Archivos relevantes:

| Archivo              | Rol                                                                               |
| -------------------- | --------------------------------------------------------------------------------- |
| `tsconfig.json`      | Config base del source. Usa NodeNext, ES2022, strict y JSX para `@opentui/solid`. |
| `tsconfig.test.json` | Config para tests, Vitest y archivos de setup.                                    |
| `tsup.config.ts`     | Config de build para runtime y TUI.                                               |

## Estrategia de tests

El proyecto usa Vitest.

Hay dos capas principales:

1. **Unit tests** para lógica determinística.
2. **Runtime integration tests** para filesystem y manejo de eventos estilo OpenCode.

La UI visual completa se deja fuera de E2E profundo por ahora para evitar tests frágiles contra el host.

## Mapa de tests

| Archivo                           | Qué valida                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `src/events.test.ts`              | Parsing de eventos, extracción de IDs, correlación y tolerancia a payloads malformados. |
| `src/state.test.ts`               | Estado, contadores, transiciones, poda, persistencia y normalización.                   |
| `src/render.test.ts`              | Render textual, collapse, visibilidad, duración, tokens y color/no-color.               |
| `src/reconcile.test.ts`           | Normalización de estados, stale-running, backoff y fail-closed.                         |
| `src/text-width.test.ts`          | Ancho de columnas para texto CJK/full-width, marcas combinantes y truncado.              |
| `src/tui.test.ts`                 | Registro de comandos, keybinding `Alt+B` y fallback legacy.                             |
| `test/index.integration.test.ts`  | Plugin runtime, `state.json`, `status.txt`, preserve-state y errores de filesystem.     |
| `test/helpers/runtime-harness.ts` | Helpers para temp dirs, fixtures, env vars y fake time.                                 |
| `test/setup.ts`                   | Limpieza global de timers, mocks, env vars y temp dirs.                                 |

## Coverage

La cobertura se configura en `vitest.config.ts`:

```ts
coverage: {
  provider: "v8",
  reporter: ["text", "lcov"],
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/tui.tsx"],
}
```

Punto importante:

> `src/tui.tsx` está excluido de coverage. No digas que la TUI visual completa está cubierta por tests automáticos.

La cobertura actual se enfoca en módulos `.ts` determinísticos: eventos, estado, render, reconcile, helpers de ancho textual, comandos y runtime.

## Patrón Arrange / Act / Assert

Los tests deberían seguir esta estructura:

```ts
it("persists a supported event", async () => {
  // Arrange
  const harness = await createRuntimeHarness();
  const plugin = await SubagentStatusline(
    {} as Parameters<typeof SubagentStatusline>[0],
  );
  const event = await readJsonFixture("session-created");

  // Act
  await plugin.event?.({ event } as never);

  // Assert
  const state = await readRuntimeState(harness.statePath);
  expect(state.children.ses_child_1.status).toBe("running");
});
```

Preferí asserts semánticos antes que snapshots grandes.

Bueno:

```ts
expect(output).toContain("1 running");
expect(output).toContain("Review auth changes");
```

Más frágil:

```ts
expect(output).toMatchSnapshot();
```

## Cómo agregar un unit test

1. Identificá el comportamiento a proteger.
2. Elegí el archivo co-localizado:
   - `src/events.test.ts`
   - `src/state.test.ts`
   - `src/render.test.ts`
   - `src/reconcile.test.ts`
   - `src/tui.test.ts`
3. Armá inputs mínimos.
4. Ejecutá la función pública o helper bajo test.
5. Afirmá comportamiento visible, no detalles accidentales.

Ejemplo conceptual:

```ts
it("does not count tool wrappers", () => {
  const state = createEmptyState();

  upsertRunningChild(state, {
    id: "tool:prt_1",
    source: "tool",
  });

  expect(state.totalExecuted).toBe(0);
});
```

## Cómo agregar un integration test runtime

Los integration tests viven en `test/**/*.integration.test.ts`.

Usá el harness para aislar filesystem y env vars:

```ts
it("writes runtime output after an event", async () => {
  const harness = await createRuntimeHarness();
  const plugin = await SubagentStatusline(
    {} as Parameters<typeof SubagentStatusline>[0],
  );
  const event = await readJsonFixture("session-created");

  await plugin.event?.({ event } as never);

  expect(await readStatusText(harness.textPath)).toContain(
    "Review auth changes",
  );
});
```

Helpers útiles:

| Helper                   | Uso                                                 |
| ------------------------ | --------------------------------------------------- |
| `createRuntimeHarness()` | Crea temp dir y configura estado aislado.           |
| `readJsonFixture(name)`  | Lee fixtures de `test/fixtures/events/<name>.json`. |
| `readRuntimeState(path)` | Lee `state.json`.                                   |
| `readStatusText(path)`   | Lee `status.txt`.                                   |
| `pathExists(path)`       | Verifica existencia sin throw.                      |
| `useFrozenTime(iso)`     | Congela tiempo con fake timers.                     |

## Fixtures

Los fixtures viven en:

```txt
test/fixtures/events/
```

Usalos cuando un payload se reutiliza o cuando conviene documentar una forma conocida de evento OpenCode.

Mantenelos chicos y representativos. No metas dumps enormes salvo que el tamaño sea parte del comportamiento a proteger.

## Fake timers

Si un test depende del tiempo:

- congelá explícitamente el tiempo en Arrange;
- evitá estado global compartido;
- dejá que `test/setup.ts` restaure timers reales después del test.

Ejemplo:

```ts
useFrozenTime("2026-01-01T00:00:00.000Z");
```

## Variables de entorno en tests

`test/setup.ts` restaura env vars del plugin después de cada test.

Si agregás una nueva variable que los tests modifican, agregala a la lista de cleanup en `test/setup.ts`.

## Qué no testear todavía

No agregues todavía automatización profunda para:

- snapshots visuales completos de OpenTUI;
- navegación host-driven completa dentro de OpenCode;
- E2E amplio de `src/tui.tsx`.

Para cambios de UI real, preferí:

1. tests unitarios para lógica extraíble;
2. tests de comandos si cambia keybinding/registro;
3. smoke test manual en OpenCode.

## Smoke test manual TUI

Cuando tocás `src/tui.tsx`, `src/render.ts` o comportamiento visible:

1. Compilá:

   ```sh
   pnpm build
   ```

2. Configurá OpenCode con ruta absoluta:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["/absolute/path/to/sub-agent-statusline/dist/tui.js"]
   }
   ```

3. Reiniciá OpenCode.
4. Ejecutá una delegación/subagente.
5. Verificá sidebar, estados y duración.
6. Probá `Alt+B`, `j/k`, flechas, `Enter` y `Esc`.
7. Si hay tokens/contexto, confirmá que se muestran sin romper la fila.
8. Revisá logs si el plugin no carga.

## CI

El workflow de PR está en `.github/workflows/ci.yml`.

Corre:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

No corre `pnpm build` ni `pnpm pack --dry-run`.

Por eso, si tu cambio toca build, package exports, assets publicados o `package.json.files`, corré esos comandos manualmente.

## Buenas prácticas de contribución

Según `CONTRIBUTING.md`:

- preferí issue-first para cambios no triviales;
- mantené PRs chicos y revisables;
- usá Conventional Commits;
- nunca commitees secretos;
- explicá qué cambió, por qué y cómo lo validaste.

Ejemplos de commits:

```txt
feat: add runtime summary grouping
fix: handle missing token metadata
docs: clarify local setup
```

## Checklist rápido por tipo de cambio

| Cambio                | Validación mínima recomendada                |
| --------------------- | -------------------------------------------- |
| Solo docs             | Revisar links y formato Markdown.            |
| Eventos/estado/render | `pnpm test`, tests focalizados.              |
| TypeScript/API        | `pnpm typecheck`, `pnpm test`.               |
| TUI visual            | `pnpm build`, smoke test manual en OpenCode. |
| Packaging             | `pnpm build`, `pnpm pack --dry-run`.         |
| CI/release            | Revisar workflows y documentar impacto.      |
