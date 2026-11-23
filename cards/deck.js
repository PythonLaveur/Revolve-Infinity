export class Deck {
  constructor(cards) {
    this.cards = [...cards];
    this.shuffle();
  }
  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }
  draw() {
    return this.cards.shift() || null;
  }
  recycle(card) {
    if (!card) return false;
    if (!this.cards.includes(card)) this.cards.push(card);
    return true;
  }
  get remaining() {
    return this.cards.length;
  }
}
