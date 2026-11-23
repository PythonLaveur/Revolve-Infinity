export class BaseAbility {
  constructor(data) {
    this.data = data;
  }
  get apCost() {
    return this.data.darkCost || this.data.apCost;
  }
  get acCost() {
    return this.data.apCost;
  }
}
