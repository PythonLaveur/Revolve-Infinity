# Technical architecture

The client runs as native browser ES modules. Serve it over HTTP with npm start, or without Node.js using py -m http.server 8000. The root README links to player-facing rules; implementation notes live in docs/.

## Main boundaries

- engine/game.js coordinates match state, turns and generic lifecycle events. Ability resolution, movement/collision, effect lifecycles and combat history live in engine/ability_system.js, engine/movement.js, engine/effect_system.js and engine/combat_history.js.
- engine/draft.js owns the timed draft state machine; ui/draft_panel.js renders it and manages pending selections, confirmations and hero detail cards.
- data/game_parameters.js is the source of truth for match-wide settings: draft order and timing, team and hand sizes, economy, arena dimensions, river/bridge geometry, tower depths and global movement budgets. Gameplay and UI modules import these settings instead of keeping separate copies.
- data/stats/<hero>.js is the balance source of truth for one hero and its ability records. data/troops.js and data/abilities.js aggregate those records for runtime consumers. data/stats/turrets.js defines arena structure combat stats and generates mirrored positions from data/game_parameters.js.
- heroes/<id>.js owns unique gameplay behavior and imports its hero's stats. heroes/registry.js dynamically loads the selected hero modules. Adding a hero requires a stats file, a behavior module, and entries in the two aggregate catalogs; it does not require hero-specific branches in the engine, renderer or UI.
- units/ contains unit state, generic effect handling and damage formulas. ui/ and rendering/ present shared game state without hero-id-specific behavior.
- rules/ contains gameplay-facing rules. data/unit-descriptions/ contains individual hero descriptions and ability summaries.

## Combat history

Central combat paths record damage, healing, mitigation, deployment, elimination and effect events. Unit totals are keyed by unit instance. Game exposes queries for a unit's history, its leading damage source, nearby attacks on allies and match summary data.
