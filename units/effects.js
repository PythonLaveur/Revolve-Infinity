export class Effect {
  constructor(data, duration = 0) {
    if (typeof data === 'object') {
      Object.assign(this, data);
    } else {
      this.name = data;
      this.remainingTurns = duration;
    }
  }
  tick() {
    if (this.remainingTurns === undefined) return true;
    this.remainingTurns -= 1;
    return this.remainingTurns > 0;
  }
}
