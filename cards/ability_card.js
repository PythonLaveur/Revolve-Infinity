export class AbilityCard {
  constructor(data) {
    this.kind = 'ability';
    this.abilityId = data.id;
    this.troopId = data.troop;
    this.name = data.name;
    this.apCost = data.darkCost;
    this.darkCost = data.darkCost;
    this.color = '#a08cff';
  }
}
