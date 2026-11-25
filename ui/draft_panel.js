import { UNIT_ICON_URLS } from '../data/unit_icons.js';

export class DraftPanel {
  constructor(onChoose) {
    this.root = document.getElementById('draftScreen');
    this.onChoose = onChoose;
    this.pendingHeroId = null;
    window.addEventListener('resize', () => this.fitHeroNames());
  }
  fitHeroNames() {
    this.root.querySelectorAll('[data-hero]').forEach((card) => {
      const label = card.querySelector('.draft-card-caption b');
      if (!label) return;
      const available = Math.max(30, card.getBoundingClientRect().width - 42);
      const fontSize = Math.max(7, Math.min(12, available / (label.textContent.length * 0.62)));
      label.style.fontSize = `${fontSize}px`;
    });
  }
  render(game) {
    const draft = game.draft;
    if (!draft || game.phase !== 'draft') {
      this.root.classList.add('hidden');
      return;
    }
    this.signature = `${draft.stepIndex}:${draft.picksLeft}:${draft.currentTeam}:${[...draft.available].join(',')}`;
    this.pendingHeroId = null;
    this.root.classList.remove('hidden');
    const action = draft.currentAction === 'ban' ? 'BAN A HERO' : 'PICK YOUR HERO';
    const picks = (team) => draft.picks[team].map((id) => {
      const hero = game.stats[id];
      const icon = UNIT_ICON_URLS[id]
        ? `<img src="${UNIT_ICON_URLS[id]}" alt="${hero.name}">`
        : `<span>${hero.icon || hero.name[0]}</span>`;
      return `<div class="draft-picked"><span class="draft-picked-icon" style="--hero:${hero.color}">${icon}</span><span>${hero.name}</span></div>`;
    }).join('');
    const card = (id) => {
      const hero = game.stats[id];
      const icon = UNIT_ICON_URLS[id]
        ? `<img src="${UNIT_ICON_URLS[id]}" alt="">`
        : `<span class="draft-hero-fallback">${hero.icon || hero.name[0]}</span>`;
      return `<div class="draft-hero-wrap"><div class="draft-hero" data-hero="${id}" role="button" tabindex="0" aria-pressed="false"><span class="draft-hero-art" style="--hero:${hero.color}">${icon}</span><span class="draft-card-caption"><b>${hero.name}</b><button class="draft-info-button" data-info="${id}" aria-label="More about ${hero.name}">i</button></span></div></div>`;
    };
    const bannedCard = (id) => {
      const hero = game.stats[id];
      const icon = UNIT_ICON_URLS[id]
        ? `<img src="${UNIT_ICON_URLS[id]}" alt="">`
        : `<span>${hero.icon || hero.name[0]}</span>`;
      return `<span class="draft-ban-card" title="${hero.name}"><span class="draft-ban-icon" style="--hero:${hero.color}">${icon}<i></i></span><b>${hero.name}</b></span>`;
    };
    this.root.innerHTML = `<div class="draft-layout">
      <aside class="draft-team draft-team-red"><header><small>RED TEAM</small><b>${draft.picks[1].length}/7</b></header><div class="draft-team-picks">${picks(1)}${'<div class="draft-empty-slot"></div>'.repeat(7 - draft.picks[1].length)}</div></aside>
      <section class="draft-center"><div class="draft-action"><small>HERO SELECT · ${draft.currentTeam === 1 ? 'RED' : 'BLUE'} ${draft.currentAction.toUpperCase()}</small><h1>${draft.complete ? 'ENTERING THE ARENA' : action}</h1><strong>${draft.complete ? '…' : `${Math.ceil(draft.remainingSeconds)}s`}</strong></div><div class="draft-roster">${[...draft.available].map(card).join('')}</div><div class="draft-footer"><button class="draft-confirm" disabled>${draft.currentAction === 'ban' ? 'CONFIRM BAN' : 'CONFIRM PICK'}</button><div class="draft-bans"><b>BANNED</b><div class="draft-ban-list">${draft.banned.map(bannedCard).join('') || '<span>—</span>'}</div></div></div><div class="draft-hero-modal hidden"></div></section>
      <aside class="draft-team draft-team-blue"><header><small>BLUE TEAM</small><b>${draft.picks[0].length}/7</b></header><div class="draft-team-picks">${picks(0)}${'<div class="draft-empty-slot"></div>'.repeat(7 - draft.picks[0].length)}</div></aside>
    </div>`;
    this.root.querySelectorAll('[data-hero]').forEach((button) => {
      const select = () => {
        this.pendingHeroId = button.dataset.hero;
        this.root.querySelectorAll('[data-hero]').forEach((cardButton) => {
          const selected = cardButton.dataset.hero === this.pendingHeroId;
          cardButton.classList.toggle('selected', selected);
          cardButton.setAttribute('aria-pressed', String(selected));
        });
        this.root.querySelector('.draft-confirm').disabled = false;
      };
      button.onclick = select;
      button.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } };
    });
    this.root.querySelectorAll('[data-info]').forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        event.preventDefault();
        const id = button.dataset.info;
        const hero = game.stats[id];
        const abilities = Object.values(game.abilities).filter((ability) => ability.troop === id);
        const modal = this.root.querySelector('.draft-hero-modal');
        modal.innerHTML = `<div class="draft-hero-modal-card"><button class="draft-modal-close" aria-label="Close">×</button><h2>${hero.name}</h2><p>${hero.description || ''}</p><h3>Abilities</h3>${abilities.map((ability) => `<article><b>${ability.name}</b><small>${ability.darkCost} AP · ${ability.apCost} AC</small><p>${ability.description || 'Hero ability.'}</p></article>`).join('')}</div>`;
        modal.classList.remove('hidden');
        modal.querySelector('.draft-modal-close').onclick = () => modal.classList.add('hidden');
      };
    });
    this.root.querySelector('.draft-confirm').onclick = () => {
      if (!this.pendingHeroId) return;
      const heroId = this.pendingHeroId;
      this.pendingHeroId = null;
      this.onChoose(heroId);
    };
    this.fitHeroNames();
  }
  update(game) {
    if (game.phase !== 'draft') return;
    const draft = game.draft;
    const signature = `${draft.stepIndex}:${draft.picksLeft}:${draft.currentTeam}:${[...draft.available].join(',')}`;
    if (signature !== this.signature) {
      this.render(game);
      return true;
    }
    const timer = this.root.querySelector('.draft-action strong');
    if (timer) timer.textContent = `${Math.ceil(game.draft.remainingSeconds)}s`;
    return false;
  }
}
