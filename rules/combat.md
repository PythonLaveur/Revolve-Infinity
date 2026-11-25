# Combat and effects

Basic attacks and abilities use their catalog damage type, scaling and target rules. Damage, healing, mitigation, deployment, eliminations and effect applications are recorded in the shared combat history.

Timed effects are handled by the common effect lifecycle. Hero-specific reactions, such as marked hits or a shield detonation, live in the owning module and subscribe to generic hooks. Hard control can interrupt movement; collision displacement from ordinary crowd pushing preserves the unit's current order.

Arena structures are separate targets from troop buildings. Abilities that damage structures use their configured structure multiplier. Turrets and bases are immune to bleed unless a future rule explicitly changes this.

The match summary reports damage dealt, healing, damage taken and reduced, deployments and eliminations. Summoned units contribute to combat records but are not listed as drafted heroes.
