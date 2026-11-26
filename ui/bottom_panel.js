import { UNIT_ICON_URLS } from '../data/unit_icons.js';
import { GAME_PARAMS } from '../data/game_parameters.js';

function makeCard(card, {
  preview = false,
  activeTroop = null,
  selectedRedraw = [],
  heroesInPlay = new Set(),
  resourceAmount = 0,
  onInfo = null,
  onSelect = null,
} = {}) {
  if (!card) return null;
  const el = document.createElement(preview ? 'div' : 'button');
  el.className = `card ${card.kind}${preview ? ' next-card' : ''}`;
  if (!preview && card.kind === 'ability' && activeTroop && card.troopId === activeTroop.stats.id)
    el.classList.add('highlight-ability');
  if (!preview && selectedRedraw.includes(card)) el.classList.add('selected-redraw');
  const cost = card.kind === 'troop' ? card.elixirCost : card.apCost || card.darkCost;
  const heroMissing = !preview && card.kind === 'ability' && !heroesInPlay.has(card.troopId);
  if (!preview) {
    const ratio = cost > 0 ? Math.max(0, Math.min(1, resourceAmount / cost)) : 1;
    if (ratio < 1) el.classList.add('resource-locked');
    el.style.setProperty('--blocked-portion', `${(1 - ratio) * 100}%`);
  }
  if (heroMissing) el.classList.add('no-hero');
  el.innerHTML = `<div class="card-cost">${cost}</div><div class="card-art" style="--card:${card.color}">${card.kind === 'troop' && !UNIT_ICON_URLS[card.troopId] ? card.icon || 'V' : card.kind === 'ability' ? '✦' : ''}</div><div class="card-name">${card.name}</div><div class="card-type">${card.kind === 'troop' ? 'HERO' : 'SKILL'}</div>`;
  if (heroMissing) {
    const cross = document.createElement('span');
    cross.className = 'card-no-hero';
    cross.textContent = '×';
    cross.setAttribute('aria-hidden', 'true');
    el.appendChild(cross);
  }
  const iconUrl = card.kind === 'troop' ? UNIT_ICON_URLS[card.troopId] : null;
  if (iconUrl) {
    const image = document.createElement('img');
    image.src = iconUrl;
    image.alt = `${card.name} icon`;
    el.querySelector('.card-art').appendChild(image);
  }
  if (!preview) {
    el.onclick = () => onSelect?.(card);
    if (onInfo) {
      const info = document.createElement('span');
      info.className = 'card-info';
      info.textContent = 'i';
      info.setAttribute('role', 'button');
      info.setAttribute('aria-label', `More about ${card.name}`);
      info.tabIndex = 0;
      const openInfo = (e) => {
        e.stopPropagation();
        onInfo(card);
      };
      info.onclick = openInfo;
      info.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openInfo(e);
        }
      };
      el.appendChild(info);
    }
  }
  return el;
}

export class BottomPanel {
  render(game, onSelect, activeTroop = null, onInfo = null, selectedRedraw = []) {
    const player = game.activePlayer();
    const heroesInPlay = new Set(game.board.troops
      .filter((troop) => troop.hp > 0 && troop.team === player.team && !troop.isClone && !troop.isMinion && !troop.isSummon)
      .map((troop) => troop.stats.id));
    const rows = [
      { hand: player.heroHand, target: 'heroHand', next: 'nextHeroCard', resource: player.elixir },
      { hand: player.abilityHand, target: 'abilityHand', next: 'nextAbilityCard', resource: player.ap },
    ];
    for (const { hand, target, next, resource } of rows) {
      const container = document.getElementById(target);
      container.replaceChildren();
      hand.cards.forEach((card) => {
        const el = makeCard(card, {
          activeTroop,
          selectedRedraw,
          heroesInPlay,
          resourceAmount: resource,
          onInfo,
          onSelect,
        });
        container.appendChild(el);
      });
      const preview = makeCard(hand.deck.peek(), { preview: true });
      document.getElementById(next).replaceChildren(...(preview ? [preview] : []));
    }
    this.updateResourceMeters(player.elixir, player.ap);
  }
  updateResourceMeters(elixir, ap) {
    const meters = [
      { fill: 'elixirMeterFill', value: 'elixirMeterValue', amount: elixir, maximum: GAME_PARAMS.economy.maxElixir },
      { fill: 'apMeterFill', value: 'apMeterValue', amount: ap, maximum: GAME_PARAMS.economy.maxAP },
    ];
    for (const item of meters) {
      const fill = document.getElementById(item.fill);
      const value = document.getElementById(item.value);
      const meter = fill?.closest('[role="meter"]');
      if (!fill || !value || !meter) continue;
      const amount = Math.max(0, item.amount);
      fill.style.width = `${Math.min(100, (amount / item.maximum) * 100)}%`;
      value.textContent = String(amount);
      meter.setAttribute('aria-valuemax', String(item.maximum));
      meter.setAttribute('aria-valuenow', String(amount));
    }
  }
}
