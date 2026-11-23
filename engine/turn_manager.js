export class TurnManager {
  constructor() {
    this.currentTeam = 0;
    this.turnNumber = 1;
  }
  end() {
    this.currentTeam = 1 - this.currentTeam;
    this.turnNumber++;
  }
}
