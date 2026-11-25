# Revolve Infinity

Revolve Infinity is a turn based arena game inspired by Clash Royale style lanes, structures, elixir, and troop combat. Players draft seven heroes, then cycle separate hero and skill decks while fighting to destroy the opposing base.

## Play

Serve the project locally with `npm start` and open the displayed address in a browser. If Node.js is not installed, run `py -m http.server 8000` and open `http://localhost:8000`. Do not open `index.html` directly because the game uses browser modules. The match begins with a timed hero draft: bans remove heroes from the pool and picks give each player that hero's troop card and ability cards.

## Documentation

- [Gameplay reference](rules/gameplay-reference.md)
- [Draft rules](rules/draft.md)
- [Combat and effects](rules/combat.md)
- [Movement and arena](rules/movement.md)
- [Technical architecture](docs/architecture.md)
- [Adding a hero](docs/adding-a-hero.md)
- [Development notes](docs/development.md)
- [Hero descriptions and ability summaries](data/unit-descriptions/README.md)

Hero and ability data is in `data/`; combat, movement, and presentation code is organized under `engine/`, `units/`, `heroes/`, and `ui/`.

Global match, economy, hand, draft, arena geometry and tower placement parameters live in data/game_parameters.js. Hero balance values live in data/stats/, one file per hero. Hero mechanics live separately in heroes/. Arena base and turret combat stats are in data/stats/turrets.js.
