# Adding a hero

Keep balance values and mechanics separate: hero-specific numbers belong in data/stats/<id>.js, while behavior belongs in heroes/<id>.js.

## 1. Add balance data

Create a stat module that exports HERO_STATS and an ABILITIES array. Include all combat, movement, collision, resource, presentation and ability fields needed at runtime. Include three abilities for a draft-ready hero. Use data/stats/turrets.js as the pattern for shared arena structure values.

## 2. Register the stat module

Add the module import to data/troops.js and data/abilities.js, and include its HERO_STATS and ABILITIES in their aggregate arrays. The shared draft takes its hero pool from TROOPS and grants the picked hero's cards from ABILITIES.

## 3. Add hero behavior

Create heroes/<id>.js and export heroId plus a default behavior factory. The behavior factory returns only the generic lifecycle hooks this hero needs. The registry imports a module when that hero is drafted; do not add hero-name conditionals to engine, UI or rendering code.

Hooks include ability validation/activation/casting, basic attack reactions, incoming damage reactions, turn and frame callbacks, zone reactions, and effect lifecycle callbacks. Check engine/game.js for current generic hook names and call signatures.

Use game.applyDamage and game.history for combat transactions. Use unit.addEffect for timed effects and shared movement functions for routes and collision. Keep unique presentation declarative through stat fields and effect/zone metadata.

## 4. Document and review

Add or update data/unit-descriptions/<id>.md for the hero overview and ability details. Put shared gameplay rules in rules/ and technical authoring notes in docs/. Verify the catalog ID, module ID, filenames, and ability ownership all match.
