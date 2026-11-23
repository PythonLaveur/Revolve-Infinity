export class Hand {
  constructor(deck, size = 10) {
    this.cards = [];
    this.size = size;
    for (let i = 0; i < size; i++) {
      const card = deck.draw();
      if (card) this.cards.push(card);
    }
    this.ensureTroopAvailable(deck, 3);
  }
  hasTroop() {
    return this.cards.some((card) => card.kind === 'troop');
  }
  abilityCards() {
    return this.cards.filter((card) => card.kind === 'ability');
  }
  ensureTroopAvailable(deck, attempts = 3) {
    for (let i = 0; i < attempts && !this.hasTroop(); i++) {
      const abilities = this.abilityCards().slice(0, 3);
      if (!abilities.length) return;
      for (const card of abilities) this.play(card, deck);
    }
  }
  drawReplacement(deck) {
    const card = deck.draw();
    if (card) this.cards.push(card);
  }
  play(card, deck) {
    const i = this.cards.indexOf(card);
    if (i < 0) return false;
    this.cards.splice(i, 1);
    this.drawReplacement(deck);
    deck.recycle(card);
    return true;
  }
  discardAbilities(deck, count = 3) {
    const abilities = this.abilityCards().slice(0, count);
    for (const card of abilities) this.play(card, deck);
    return abilities.length;
  }
  discardSelected(deck, cards) {
    let count = 0;
    for (const card of cards) {
      if (card && card.kind === 'ability' && this.cards.includes(card) && count < 3) {
        if (this.play(card, deck)) count++;
      }
    }
    return count;
  }
}
