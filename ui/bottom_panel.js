import { UNIT_ICON_URLS } from '../data/unit_icons.js';

function makeCard(card, { preview = false, activeTroop = null, selectedRedraw = [], onInfo = null, onSelect = null } = {}) {
  if (!card) return null;
  const el = document.createElement(preview ? 'div' : 'button');
  el.className = `card ${card.kind}${preview ? ' next-card' : ''}`;
  if (!preview && card.kind === 'ability' && activeTroop && card.troopId === activeTroop.stats.id)
    el.classList.add('highlight-ability');
  if (!preview && card.kind === 'ability' && activeTroop && card.troopId !== activeTroop.stats.id)
    el.classList.add('dim-ability');
  if (!preview && selectedRedraw.includes(card)) el.classList.add('selected-redraw');
  const cost = card.kind === 'troop' ? card.elixirCost : card.apCost || card.darkCost;
  el.innerHTML = `<div class="card-cost">${cost}</div><div class="card-art" style="--card:${card.color}">${card.kind === 'troop' && !UNIT_ICON_URLS[card.troopId] ? card.icon || 'V' : card.kind === 'ability' ? '✦' : ''}</div><div class="card-name">${card.name}</div><div class="card-type">${card.kind === 'troop' ? 'HERO' : 'SKILL'}</div>`;
  const iconUrl = card.kind === 'troop' ? UNIT_ICON_URLS[card.troopId] : null;
  if (iconUrl) {
    const image = document.createElement('img');
    image.src = iconUrl;
    image.alt = `${card.name} icon`;
    el.querySelector('.card-art').appendChild(image);
  }
  if (!preview) {
    el.onclick = () => onSelect?.(card);
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
  }
  return el;
}

export class BottomPanel {
  render(game, onSelect, activeTroop = null, onInfo = null, selectedRedraw = []) {
    const player = game.activePlayer();
    const rows = [
      { hand: player.heroHand, target: 'heroHand', next: 'nextHeroCard' },
      { hand: player.abilityHand, target: 'abilityHand', next: 'nextAbilityCard' },
    ];
    for (const { hand, target, next } of rows) {
      const container = document.getElementById(target);
      container.replaceChildren();
      hand.cards.forEach((card) => {
        const el = makeCard(card, { activeTroop, selectedRedraw, onInfo, onSelect });
        container.appendChild(el);
      });
      const preview = makeCard(hand.deck.peek(), { preview: true });
      document.getElementById(next).replaceChildren(...(preview ? [preview] : []));
    }
  }
}
