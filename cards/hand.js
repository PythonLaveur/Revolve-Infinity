export class Hand {
  constructor(deck, size = 0) {
    this.cards = [];
    this.deck = deck;
    this.size = size;
    this.fill();
  }
  fill() {
    while (this.cards.length < this.size) {
      const card = this.deck.draw();
      if (!card) break;
      this.cards.push(card);
    }
  }
  drawReplacement() {
    const card = this.deck.draw();
    if (card) this.cards.push(card);
  }
  play(card) {
    const i = this.cards.indexOf(card);
    if (i < 0) return false;
    this.cards.splice(i, 1);
    this.drawReplacement();
    this.deck.recycle(card);
    return true;
  }
  discardSelected(cards, maxCount = 3) {
    let count = 0;
    for (const card of cards) {
      if (card && this.cards.includes(card) && count < maxCount) {
        if (this.play(card)) count++;
      }
    }
    return count;
  }
}
