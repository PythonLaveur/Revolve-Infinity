import { UNIT_ICON_URLS } from '../data/unit_icons.js';

export class BottomPanel {
  render(game, onSelect, activeTroop = null, onInfo = null, selectedRedraw = []) {
    const hand = document.getElementById('hand');
    hand.innerHTML = '';
    game.activePlayer().hand.cards.forEach((card, index) => {
      const el = document.createElement('button');
      el.className = `card ${card.kind}`;
      if (card.kind === 'ability' && activeTroop && card.troopId === activeTroop.stats.id)
        el.classList.add('highlight-ability');
      if (card.kind === 'ability' && activeTroop && card.troopId !== activeTroop.stats.id)
        el.classList.add('dim-ability');
      if (selectedRedraw.includes(card)) el.classList.add('selected-redraw');
      const cost = card.kind === 'troop' ? card.elixirCost : card.apCost || card.darkCost;
      el.innerHTML = `<div class="card-cost">${cost}</div><div class="card-art" style="--card:${card.color}">${card.kind === 'troop' && !UNIT_ICON_URLS[card.troopId] ? card.icon || 'V' : card.kind === 'ability' ? '✦' : ''}</div><div class="card-name">${card.name}</div><div class="card-type">${card.kind.toUpperCase()}</div>`;
      const iconUrl = card.kind === 'troop' ? UNIT_ICON_URLS[card.troopId] : null;
      if (iconUrl) {
        const image = document.createElement('img');
        image.src = iconUrl;
        image.alt = `${card.name} icon`;
        el.querySelector('.card-art').appendChild(image);
      }
      el.onclick = () => onSelect(card, index);
      if (card.kind === 'ability' && onInfo) {
        const info = document.createElement('span');
        info.className = 'card-info';
        info.textContent = 'i';
        info.onclick = (e) => {
          e.stopPropagation();
          onInfo(card);
        };
        el.appendChild(info);
      }
      hand.appendChild(el);
    });
  }
}
