import { GAME_PARAMS } from '../data/game_parameters.js';

const DRAFT_STEPS = GAME_PARAMS.draft.order;

export class Draft {
  constructor(heroIds, { onPick, onComplete, secondsPerPick = GAME_PARAMS.draft.secondsPerChoice } = {}) {
    this.available = new Set(heroIds);
    this.banned = [];
    this.picks = [[], []];
    this.onPick = onPick;
    this.onComplete = onComplete;
    this.secondsPerPick = secondsPerPick;
    this.stepIndex = 0;
    this.picksLeft = DRAFT_STEPS[0].count;
    this.remainingSeconds = secondsPerPick;
    this.complete = false;
  }
  get step() { return DRAFT_STEPS[this.stepIndex] || null; }
  get currentTeam() { return this.step?.team ?? null; }
  get currentAction() { return this.step?.kind ?? 'complete'; }
  tick(seconds) {
    if (this.complete) return;
    this.remainingSeconds -= seconds;
    if (this.remainingSeconds <= 0) this.choose(this.firstAvailable());
  }
  choose(heroId) {
    if (this.complete || !this.step || !this.available.has(heroId)) return false;
    this.available.delete(heroId);
    if (this.step.kind === 'ban') this.banned.push(heroId);
    else {
      this.picks[this.step.team].push(heroId);
      this.onPick?.(this.step.team, heroId);
    }
    this.picksLeft -= 1;
    if (this.picksLeft > 0) this.remainingSeconds = this.secondsPerPick;
    else this.advance();
    return true;
  }
  firstAvailable() { return this.available.values().next().value ?? null; }
  advance() {
    this.stepIndex += 1;
    if (!this.step) {
      this.complete = true;
      this.remainingSeconds = 0;
      this.onComplete?.(this.picks);
      return;
    }
    this.picksLeft = this.step.count;
    this.remainingSeconds = this.secondsPerPick;
  }
}
