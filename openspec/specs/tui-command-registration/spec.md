# tui-command-registration Specification

## Purpose

Define compatibility command registration behavior so focus-sidebar remains discoverable in the command palette, keeps `Alt+B` support, degrades safely across API availability, and always cleans up created registrations.

## Requirements

### Requirement: Dual registration when both APIs are available

The system MUST register the focus-sidebar action through both keymap-layer registration and legacy command registration when both APIs are available in the runtime.

#### Scenario: Palette visibility plus modern dispatch

- GIVEN a runtime exposing `api.keymap.registerLayer` and `api.command.register`
- WHEN TUI commands are registered
- THEN the focus-sidebar action is registered in the keymap layer
- AND the same action is also registered through the legacy command API for palette discoverability

### Requirement: Alt+B keybinding continuity

The system MUST keep `Alt+B` bound through the keymap layer to `subagent-statusline.focus-sidebar-list`.

#### Scenario: Keybinding survives compatibility mode

- GIVEN keymap-layer registration is available
- WHEN commands are registered in compatibility mode
- THEN `Alt+B` remains mapped to `subagent-statusline.focus-sidebar-list`

### Requirement: Safe degradation across partial API availability

The system SHALL register through any available API and SHALL NOT throw when one or both APIs are missing.

#### Scenario: Only keymap available

- GIVEN only `api.keymap.registerLayer` is available
- WHEN commands are registered
- THEN keymap registration succeeds
- AND no legacy registration call is required

#### Scenario: Only legacy command API available

- GIVEN only `api.command.register` is available
- WHEN commands are registered
- THEN legacy command registration succeeds
- AND no keymap registration call is required

#### Scenario: Neither API available

- GIVEN neither API is available
- WHEN commands are registered
- THEN registration completes without throwing
- AND a safe no-op disposer is still returned

### Requirement: Complete and safe disposal

The system MUST return a disposer that cleans up every registration created in that invocation and SHOULD remain safe if called after partial registration outcomes.

#### Scenario: Cleanup of all created registrations

- GIVEN both registrations were created
- WHEN the returned disposer is invoked
- THEN keymap registration cleanup is executed
- AND legacy command registration cleanup is executed

#### Scenario: Cleanup with partial registration

- GIVEN only one registration was created
- WHEN the returned disposer is invoked
- THEN only the created registration is cleaned up
- AND no error is raised for missing counterparts

### Requirement: Bounded compatibility duplication behavior

The system SHOULD keep compatibility registration identifiers and labels aligned across APIs, and compatibility duplicate visibility behavior MUST be documented or explicitly bounded by the runtime contract.

#### Scenario: Compatibility behavior is explicit

- GIVEN a runtime where both APIs are registered
- WHEN command palette duplication behavior is evaluated
- THEN the behavior is either documented as acceptable compatibility tradeoff
- OR constrained by explicit runtime guarantees referenced by project documentation/tests
