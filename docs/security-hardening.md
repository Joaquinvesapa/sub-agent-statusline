# Security hardening aplicado

Este documento explica las medidas tomadas en la rama `security/npm-plugin-hardening`, por qué se aplicaron y qué efecto tienen.

## 1. Worktree limpio desde `origin/main`

**Qué se hizo**

Se creó un worktree separado en:

```text
/home/joaquinvesapa/work/sub-agent-statusline-security-hardening
```

con la rama:

```text
security/npm-plugin-hardening
```

**Por qué**

Había cambios locales de documentación en el worktree original. Para no mezclarlos con cambios de seguridad, se aisló el trabajo en una copia limpia basada en `origin/main`.

**Qué protege**

- Evita arrastrar cambios no relacionados.
- Reduce riesgo de commitear documentación accidentalmente.
- Hace que el diff de seguridad sea revisable.

---

## 2. `packageManager: pnpm@11.1.2`

**Qué se hizo**

En `package.json` se declaró:

```json
"packageManager": "pnpm@11.1.2"
```

También se actualizó CI y release para usar pnpm `11.1.2`.

**Por qué**

La versión del package manager forma parte de la cadena de suministro. Si cada entorno usa una versión distinta de pnpm, puede haber diferencias en resolución de dependencias, lockfile, instalación o comportamiento de seguridad.

**Qué protege**

- Builds más reproducibles.
- Menos drift entre desarrollo local, CI y release.
- Facilita investigar problemas porque todos usan la misma versión.

---

## 3. `engines.node: >=20`

**Qué se hizo**

En `package.json` se declaró:

```json
"engines": {
  "node": ">=20"
}
```

**Por qué**

El proyecto ya apunta a Node 20 en build/CI. Declararlo explícitamente evita que usuarios o CI corran el plugin en runtimes no probados.

**Qué protege**

- Evita incompatibilidades silenciosas con versiones viejas de Node.
- Reduce superficie de bugs por APIs modernas no disponibles.
- Documenta el runtime soportado para consumidores del paquete.

---

## 4. Peer dependencies con rangos semver, no `*`

**Qué se hizo**

Se reemplazaron peers abiertos:

```json
"@opencode-ai/plugin": "*"
```

por rangos compatibles probados, por ejemplo:

```json
"@opencode-ai/plugin": ">=1.14.50 <2"
```

**Por qué**

Un peer dependency con `*` acepta cualquier versión, incluso versiones no probadas, incompatibles o con vulnerabilidades conocidas.

**Qué protege**

- Limita combinaciones no testeadas.
- Evita que el plugin se instale junto con majors potencialmente incompatibles.
- Hace explícita la matriz de compatibilidad.

---

## 5. Installs en CI/release con `--ignore-scripts`

**Qué se hizo**

Los workflows ahora instalan dependencias con:

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

**Por qué**

Los lifecycle scripts de npm/pnpm (`preinstall`, `install`, `postinstall`) ejecutan código arbitrario durante la instalación. Son un vector clásico de supply-chain attacks.

**Qué protege**

- Bloquea ejecución automática de scripts de dependencias durante CI/release.
- Reduce impacto si una dependencia o transitive dependency fue comprometida.
- Sigue la práctica recomendada por Liran Tal y Gentle AI v1.28.3.

**Trade-off**

Si una dependencia legítima requiere scripts de instalación, el build podría fallar. En ese caso hay que permitirlo explícitamente y justificarlo.

---

## 6. Installs determinísticos con `--frozen-lockfile`

**Qué se hizo**

CI/release usan:

```sh
pnpm install --frozen-lockfile
```

**Por qué**

El lockfile debe ser la fuente de verdad en CI. Si CI puede modificar o regenerar el lockfile, se pierde reproducibilidad.

**Qué protege**

- Evita drift de dependencias.
- Detecta cuando `package.json` y `pnpm-lock.yaml` no están sincronizados.
- Hace que PRs con cambios de dependencias sean visibles y revisables.

---

## 7. Audit productivo bloqueante

**Qué se hizo**

Se agregó en CI y release:

```sh
pnpm audit --prod --audit-level moderate
```

También se agregó script:

```json
"audit:prod": "pnpm audit --prod --audit-level moderate"
```

**Por qué**

Queremos que vulnerabilidades moderadas o superiores en el árbol productivo bloqueen publicación/release.

**Qué protege**

- Evita publicar una versión con vulnerabilidades conocidas en dependencias runtime/peer instaladas.
- Convierte vulnerabilidades en una señal visible y obligatoria antes del release.
- Fuerza una decisión explícita: actualizar, esperar upstream o aceptar riesgo.

**Estado actual**

Este gate inicialmente fallaba por advisories upstream en `file-type` y `uuid`. Se resolvió actualizando las dependencias host/peer de desarrollo a versiones más nuevas y refrescando el lockfile para tomar el parche transitive de `uuid`:

- `@opencode-ai/plugin >=1.14.50 <2`
- `@opentui/core >=0.2.10 <0.3`
- `@opentui/solid >=0.2.10 <0.3`
- `uuid@13.0.2` en el lockfile transitivo de `effect`

Después de esa actualización, tanto `pnpm audit --prod --audit-level moderate` como `pnpm audit --audit-level moderate` pasan sin vulnerabilidades conocidas. El gate queda bloqueante para evitar regressions en futuros cambios.

---

## 8. Verificación de contenido del paquete con `pnpm pack --dry-run`

**Qué se hizo**

Se agregó en CI/release:

```sh
pnpm pack --dry-run
```

También se agregó script:

```json
"pack:dry-run": "pnpm pack --dry-run"
```

**Por qué**

No alcanza con mirar el repo: lo que importa es qué entra realmente en el tarball publicado a npm.

**Qué protege**

- Detecta archivos inesperados antes de publicar.
- Ayuda a evitar subir secretos, artifacts locales o archivos de desarrollo.
- Verifica que `files` en `package.json` limite correctamente el paquete.

---

## 9. `files` como superficie de publicación limitada

**Qué existe / se preservó**

El paquete publica solo:

```json
"files": [
  "dist",
  "assets",
  "README.md"
]
```

**Por qué**

El allowlist de `files` es más seguro que depender de `.npmignore` o defaults implícitos.

**Qué protege**

- Reduce riesgo de publicar archivos internos.
- Mantiene el paquete chico y auditable.
- Hace más predecible el contenido publicado.

---

## 10. Provenance npm / OIDC

**Qué se hizo**

En release workflow:

```yaml
permissions:
  id-token: write
```

Y:

```yaml
NPM_CONFIG_PROVENANCE: "true"
```

En `package.json`:

```json
"publishConfig": {
  "access": "public",
  "provenance": true
}
```

**Por qué**

La provenance permite que npm publique attestations que vinculan el paquete con el workflow de GitHub que lo generó. OIDC/trusted publishing reduce dependencia de tokens largos.

**Qué protege**

- Mejora trazabilidad del paquete publicado.
- Permite verificar que el artifact salió del repo/workflow esperado.
- Reduce riesgo asociado a tokens npm persistentes cuando trusted publishing esté configurado.

**Acción externa pendiente**

Esto prepara el repo, pero npm trusted publishing requiere configuración en npm/GitHub por parte de maintainers.

---

## 11. Recomendaciones para maintainers: 2FA, tokens y branch protection

**Qué se documentó**

Se agregaron notas para maintainers sobre:

- activar 2FA en npm;
- configurar trusted publishing/OIDC;
- revocar o restringir tokens viejos una vez que OIDC esté activo;
- proteger `main` con branch protection.

**Por qué**

Parte de la seguridad de npm no vive en el código: vive en cuentas, permisos y configuración del registry.

**Qué protege**

- Reduce riesgo de account takeover.
- Reduce impacto de tokens filtrados.
- Evita releases desde ramas o cambios no revisados.

---

## 12. Escritura atómica de `state.json` y `status.txt`

**Qué se hizo**

`saveState` y `saveStatusText` ahora escriben así:

1. crear directorio si hace falta;
2. escribir un archivo temporal en el mismo directorio;
3. hacer `rename` al archivo final;
4. limpiar el temporal si falla.

**Por qué**

Antes se sobrescribía directamente el archivo final. Si el proceso se interrumpía durante la escritura, podía quedar un JSON corrupto o un status parcial.

**Qué protege**

- Reduce riesgo de archivos parcialmente escritos.
- Hace la actualización casi atómica dentro del mismo filesystem.
- Mejora resiliencia ante interrupciones o errores de I/O.

---

## 13. Permisos owner-only para estado local

**Qué se hizo**

Los directorios se crean con modo aproximado:

```text
0700
```

Los archivos de estado/status con:

```text
0600
```

**Por qué**

El estado local puede incluir títulos o resúmenes derivados de prompts/tareas. Eso puede ser sensible.

**Qué protege**

- Evita que otros usuarios locales lean el estado, si el sistema respeta permisos POSIX.
- Reduce exposición accidental de fragmentos de prompts.
- Alinea persistencia local con una postura privacy-first.

**Nota**

Los permisos son best-effort: dependen del sistema operativo, filesystem y umask.

---

## 14. Nombre temporal con `randomUUID()`

**Qué se hizo**

El archivo temporal incluye:

- basename del archivo final;
- PID;
- timestamp;
- `randomUUID()`.

**Por qué**

PID + timestamp puede colisionar en escrituras concurrentes muy rápidas. `randomUUID()` vuelve esa colisión prácticamente irrelevante.

**Qué protege**

- Evita que dos escrituras simultáneas pisen el mismo temp file.
- Hace más segura la escritura atómica bajo concurrencia local.

---

## 15. `saveStatusText` compartido

**Qué se hizo**

Se reemplazaron escrituras directas de `status.txt` por un helper común:

```ts
saveStatusText(...)
```

**Por qué**

Si `state.json` se escribía de forma segura pero `status.txt` seguía con `writeFile` directo, quedaba una brecha inconsistente.

**Qué protege**

- Aplica permisos y atomicidad también al snapshot de texto.
- Evita duplicar lógica de filesystem.
- Mantiene runtime y TUI con la misma política de escritura.

---

## 16. Límite de lectura para logs de OpenCode

**Qué se hizo**

Se agregó `src/logs.ts` con un helper que revisa tamaño antes de leer:

```ts
readOpenCodeLogFileIfSmall(...)
```

Si el log supera 1 MiB, se saltea.

**Por qué**

La TUI leía logs locales de forma síncrona para reconstruir tokens/contexto. Un log enorme podía bloquear la UI o consumir memoria innecesaria.

**Qué protege**

- Evita bloqueos por archivos muy grandes.
- Reduce riesgo de degradación por logs locales anómalos.
- Mantiene el backfill como best-effort: si el log es grande, se omite.

---

## 17. Documentación de privacidad local

**Qué se documentó**

En README se explicó que el plugin persiste:

- `state.json`;
- `status.txt`;
- títulos/resúmenes derivados de eventos, prompts o tareas.

También se explicó que:

```text
OPENCODE_SUBAGENT_STATUSLINE_STATE
```

es una variable confiable porque permite elegir dónde escribir estado.

**Por qué**

La seguridad no es solo bloquear ataques: también es hacer visibles los límites de privacidad.

**Qué protege**

- Evita sorpresas sobre datos persistidos localmente.
- Ayuda a usuarios a elegir rutas seguras.
- Deja claro que la variable de entorno no debe venir de fuentes no confiables.

---

## 18. Recomendaciones npm para desarrollo local

**Qué se hizo**

Se alinearon los comandos de documentación para preferir:

```sh
pnpm install --ignore-scripts
```

También se documentaron recomendaciones explícitas inspiradas en Gentle AI v1.28.3 y Liran Tal:

```sh
npm config set min-release-age 3
npm config set allow-git none
```

Y herramientas opcionales de screening como:

- `npq`
- Socket Firewall

**Por qué**

La seguridad de supply chain no termina en CI. Los contributors también instalan dependencias localmente, y ese paso puede ejecutar código de terceros o incorporar releases demasiado recientes.

**Qué protege**

- Reduce ejecución accidental de lifecycle scripts durante desarrollo.
- Da tiempo a que releases maliciosos o rotos sean detectados antes de ser adoptados.
- Desalienta dependencias git/tarball/URL que saltean controles normales del registry.
- Promueve revisar salud y riesgo de paquetes nuevos antes de agregarlos.

**Nota**

Estas recomendaciones son controles de maintainer/desarrollador. No son enforcement runtime del plugin.

---

## 19. Tests enfocados

**Qué se hizo**

Se agregaron/actualizaron tests para:

- escritura de estado/status;
- permisos esperados;
- ausencia de temp files sobrantes;
- skip de logs mayores a 1 MiB.

**Por qué**

Las medidas de seguridad deben quedar protegidas contra regresiones.

**Qué protege**

- Evita volver accidentalmente a `writeFile` directo.
- Verifica que el helper de logs no lea archivos enormes.
- Hace que los cambios sean mantenibles.

---

## 20. Limpieza de artifacts accidentales

**Qué se hizo**

Se eliminaron artifacts locales generados durante el trabajo y se agregaron a `.gitignore` para evitar que reaparezcan en un `git add .` accidental:

- `.pi/`
- `.pi-chain/`
- `security-audit/`

**Por qué**

Eran archivos de harness/subagentes, no parte del plugin.

**Qué protege**

- Evita commitear ruido o archivos internos accidentalmente.
- Mantiene el diff enfocado en seguridad real.

---

## Resumen ejecutivo

Las medidas tomadas apuntan a cuatro áreas:

1. **Supply chain npm**: pnpm fijo, installs determinísticos, `--ignore-scripts`, audit bloqueante, provenance.
2. **Publicación segura**: tarball verificado, `publishConfig`, package contents limitado.
3. **Runtime local seguro**: escrituras atómicas, permisos restrictivos, menos riesgo de corrupción o lectura local.
4. **Privacidad/resiliencia TUI**: disclosure de estado persistido y límite para logs grandes.
5. **Higiene de desarrollo local**: installs con scripts deshabilitados, cooldown de dependencias, bloqueo/revisión de dependencias exóticas y screening opcional.

El audit productivo bloqueante queda activo y actualmente pasa sin vulnerabilidades conocidas después de actualizar las dependencias host/peer de desarrollo y refrescar transitivas parcheadas en el lockfile. Si vuelve a fallar en el futuro, la release debe detenerse hasta actualizar, justificar un override seguro o tomar una decisión explícita de riesgo.
