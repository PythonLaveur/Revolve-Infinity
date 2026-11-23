export class TroopCard {
  constructor(stats) {
    this.kind = 'troop';
    this.troopId = stats.id;
    this.name = stats.name;
    this.elixirCost = stats.elixirCost;
    this.color = stats.color;
    this.icon = stats.icon;
  }
}
