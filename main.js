import { Game } from './engine/game.js';
import { Renderer } from './rendering/renderer.js';
import { Hud } from './ui/hud.js';
import { BottomPanel } from './ui/bottom_panel.js';
import { DraftPanel } from './ui/draft_panel.js';
import { MatchSummary } from './ui/match_summary.js';
import { applyResistance, scaleDamage } from './units/damage.js';
import { collisionRadiusOf, edgeDistanceBetween } from './units/stats.js';

const canvas = document.getElementById('battlefield');
const renderer = new Renderer(canvas);
const hud = new Hud();
const bottom = new BottomPanel();
const game = new Game();
const draftPanel = new DraftPanel((heroId) => {
  if (game.chooseDraftHero(heroId)) renderUI();
});
const matchSummary = new MatchSummary();
let selectedCard = null,
  selectedMode = 'select',
  activeTroop = null,
  hover = { x: 780, y: 285 },
  deploymentPreview = null;
let redrawMode = false,
  redrawResource = 'elixir',
  selectedRedraw = [];
const gameLogLines = [[], []];
window.activeTroop = activeTroop;
const $ = (id) => document.getElementById(id);
const toast = (s) => {
  const el = $('toast');
  el.textContent = s;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
};
function flushGameEvents() {
  if (!game.events.length) return;
  const logs = [ $('battleLogBlue'), $('battleLogRed') ];
  const wasAtBottom = logs.map((log) => log.scrollHeight - log.scrollTop - log.clientHeight < 20);
  for (const event of game.events.splice(0)) {
    const team = event.team === 0 || event.team === 1 ? event.team : game.turns.currentTeam;
    gameLogLines[team].push(event.message);
    while (gameLogLines[team].length > 200) gameLogLines[team].shift();
  }
  logs[0].textContent = gameLogLines[0].join('\n');
  logs[1].textContent = gameLogLines[1].join('\n');
  logs.forEach((log, team) => {
    if (wasAtBottom[team]) log.scrollTop = log.scrollHeight;
  });
}
const fieldPoint = (e) => {
  const r = canvas.getBoundingClientRect();
  const raw = {
    x: ((e.clientX - r.left) * canvas.width) / r.width,
    y: ((e.clientY - r.top) * canvas.height) / r.height,
  };
  return raw;
};
function updateDeploymentPreview() {
  deploymentPreview = selectedMode === 'deploy' && selectedCard
    ? game.getDeploymentPlan(selectedCard, hover.x, hover.y)
    : null;
}

function troopAt(p) {
  return game.board.troops.find((t) => !t.burrowed && !t.isUntargetable && Math.hypot(t.x - p.x, t.y - p.y) <= t.collisionRadius + 8);
}
function turretAt(p) {
  return game.board.turrets.find(
    (t) => t.hp > 0 && t.team !== game.turns.currentTeam && Math.hypot(t.x - p.x, t.y - p.y) <= t.radius + 8,
  );
}
function baseAt(p) {
  return game.board.towers.find(
    (t) => t.hp > 0 && t.team !== game.turns.currentTeam && Math.hypot(t.x - p.x, t.y - p.y) <= t.radius + 8,
  );
}

function abilityTargetAt(p, ability, caster = activeTroop) {
  let target = troopAt(p);
  if (!target && ability.targetTeam === 'enemy' &&
    (ability.damage || ability.damageFraction || ability.targetMaxHpFraction || (ability.scaling && ability.damageType))) {
    target = turretAt(p) || baseAt(p);
  }
  if (!target || target.hp <= 0 || (target.burrowed && game.board.troops.includes(target))) return null;
  if (!game.board.troops.includes(target) &&
    !game.board.turrets.includes(target) && !game.board.towers.includes(target)) return null;
  if (ability.targetTeam === 'ally' && (target.team !== caster.team || target === caster)) return null;
  if (ability.targetTeam === 'enemy' && target.team === caster.team) return null;
  if (ability.targetRange && edgeDistanceBetween(caster, target) > ability.targetRange) return null;
  return target;
}

function showTroopInspector() {
  const el = $('troopInspector');
  if (!activeTroop) {
    el.classList.add('hidden');
    return;
  }
  const s = activeTroop.stats;
  const abilities = Object.values(game.abilities).filter((a) => a.troop === s.id);
  const abilityNames = abilities
    .map((a) => `${a.name} (${a.darkCost} AP / ${a.apCost} AC)`)
    .join('  •  ');
  const effectNames = activeTroop.effects.map((effect) => {
    const duration = effect.remainingSeconds !== undefined
      ? `${effect.remainingSeconds.toFixed(1)}s`
      : `${effect.remainingTurns} turn ends`;
    const turns = duration;
    if (effect.stacks !== undefined) return `${effect.displayLabel || 'Stacks'} ${effect.stacks}/${effect.maxStacks || '∞'} (${turns})`;
    if (effect.displayLabel) return `${effect.displayLabel} (${turns})`;
    if (effect.type === 'attack-range') return `Attack range ×${effect.multiplier} (${turns})`;
    if (effect.type === 'defense') return `Defense +${effect.armor} / +${effect.magicResist} (${turns})`;
    if (effect.type === 'ac-generation') return `AC generation ×${effect.multiplier} (${turns})`;
    if (effect.type === 'shield') return `Shield ${effect.remainingAmount} HP (${turns})`;
    if (effect.type === 'momentum-shield') {
      const momentum = Math.hypot(effect.momentumX || 0, effect.momentumY || 0);
      const speedBonus = Math.min(effect.maxSpeedBonus || 0.5, momentum / (effect.maxSpeedMomentum || 272) * (effect.maxSpeedBonus || 0.5));
      return `Momentum Shield ${effect.remainingAmount} HP · ${Math.round(momentum)} momentum · +${Math.round(speedBonus * 100)}% move speed (${turns})`;
    }
    if (effect.type === 'fragile') return `Fragile (${turns})`;
    if (effect.type === 'move-speed') return `Move speed ×${effect.multiplier} (${turns})`;
    if (effect.type === 'damage-to-shield') return `Nearby enemy damage → ${Math.round(effect.multiplier * 100)}% shield (${turns})`;
    if (effect.type === 'silence') return `Silenced (${turns})`;
    if (effect.type === 'launch-next-hit') return `Next troop hit launches target (${turns})`;
    if (effect.type === 'airborne') return `Airborne (${turns})`;
    if (effect.type === 'magic-penetration') return `Magic penetration +${effect.amount}% (${turns})`;
    if (effect.type === 'protective-dome') return `Dome ${Math.ceil(effect.remainingAmount)} / ${effect.radius} range (${turns})`;
    if (effect.type === 'bleed') return `Bleed ${effect.intensity} raw damage per AC spend (${turns})`;
    if (effect.type === 'damage-reflect') return `Reflect ${Math.round(effect.multiplier * 100)}% within ${effect.radius} (${turns})`;
    if (effect.type === 'stun') return `Stunned (${turns})`;
    return `${effect.id} (${turns})`;
  }).join(' · ') || 'None';
  const resourceDisplay = s.resourceLabel
    ? `<span>${s.resourceLabel.toUpperCase()} <b>${activeTroop.energy.toFixed(1)}${s.resourceMaximum ? `/${s.resourceMaximum}` : ''}</b></span>${s.resourceDecayGraceTurns !== undefined ? `<span>DECAY GRACE <b>${Math.max(0, s.resourceDecayGraceTurns - activeTroop.energyIdleTurns)} turns</b></span>` : ''}`
    : '';
  const isOwner = activeTroop.team === game.turns.currentTeam;
  el.innerHTML = `<button class="inspector-close" id="closeInspector" aria-label="Close troop panel">×</button>
    <div class="inspector-heading"><strong>${s.name}</strong><span class="troop-state ${activeTroop.stunned ? 'stunned' : ''}">${activeTroop.burrowed ? 'UNDERGROUND' : activeTroop.stunned ? 'STUNNED' : 'ACTIVE'}</span><span class="troop-hp">HP <b>${activeTroop.hp}/${activeTroop.maxHp}</b></span></div>
    <div class="inspector-metrics"><span>HP <b>${activeTroop.hp}/${activeTroop.maxHp}</b></span>${s.isBuilding ? '<span>TYPE <b>BUILDING</b></span><span>DECAY <b>Each turn</b></span>' : `<span>FORCE <b>${s.force}</b></span><span>ATTACK <b>${s.atk}</b></span><span>POWER <b>${s.apt}</b></span><span>ARMOR <b>${activeTroop.armor.toFixed(1)}</b></span><span>MAGIC RESIST <b>${activeTroop.magicResist.toFixed(1)}</b></span><span>RANGE <b>${activeTroop.attackRange}</b></span><span>SIGHT <b>${activeTroop.sightRange}</b></span><span>${s.movementType === 'air' ? 'FLY MOVE' : 'MOVE'} <b>${Math.round(activeTroop.availableMovement)}/${s.movement}</b></span>`}${s.flatArmorPen ? `<span>ARMOR PEN <b>${s.flatArmorPen}</b></span>` : ''}${resourceDisplay}<span>AC <b>${activeTroop.ac}</b></span></div>
    <div class="inspector-abilities">ABILITIES · ${abilityNames}</div>
    <div class="inspector-effects">EFFECTS · ${effectNames}</div>
    <div class="inspector-actions"><button id="inspectorMove" class="inspector-action ${selectedMode === 'move' ? 'is-selected' : ''}" ${!isOwner || activeTroop.stunned || activeTroop.burrowed || s.isBuilding || activeTroop.isDrone ? 'disabled' : ''}>MOVE <small>${Math.round(activeTroop.availableMovement)} DIST</small></button><button id="inspectorAttack" class="inspector-action ${selectedMode === 'attack' ? 'is-selected' : ''}" ${!isOwner || activeTroop.stunned || activeTroop.burrowed || s.isBuilding || activeTroop.isDrone ? 'disabled' : ''}>ATTACK <small>${s.attackCost} AC</small></button></div>`;
  el.classList.remove('hidden');
  $('closeInspector').onclick = () => {
    el.classList.add('hidden');
    activeTroop = null;
    window.activeTroop = null;
    selectedMode = 'select';
    renderUI();
  };
  $('inspectorMove').onclick = () => {
    if (game.isMoving() || !isOwner || activeTroop.stunned) return;
    selectedMode = selectedMode === 'move' ? 'select' : 'move';
    selectedCard = null;
    renderUI();
  };
  $('inspectorAttack').onclick = () => {
    if (game.isMoving() || !isOwner || activeTroop.stunned) return;
    if (selectedMode === 'attack') {
      selectedMode = 'select';
    } else {
      selectedMode = 'attack';
      const enemies = game.targetsFor(activeTroop);
      activeTroop.validateFocus(enemies);
      if (!activeTroop.focus) activeTroop.updateFocus(enemies);
      if (activeTroop.focus && activeTroop.attackDistanceTo(activeTroop.focus) <= activeTroop.attackRange) {
        if (basicAttack()) selectedMode = 'select';
      } else toast('Choose a target in attack range');
    }
    selectedCard = null;
    renderUI();
  };
}

function showAbilityInfo(card) {
  const data = game.abilities[card.abilityId];
  const el = $('abilityModal');
  if (!data) return;
  const owner = game.stats[data.troop];
  const scaleText = Object.entries(data.scaling || {})
    .filter(([, ratio]) => ratio)
    .map(([stat, ratio]) => `${Math.round(ratio * 100)}% ${stat.toUpperCase()}`)
    .join(' + ');
  const damage = data.damagePerTurn
    ? `Damage: ${data.damagePerTurn} ${data.damageType || 'physical'} per turn`
    : data.damageFraction
    ? `Damage: ${Math.round(data.damageFraction * 100)}% max HP`
    : data.damage || scaleText
      ? `Damage: ${data.damage || 0}${scaleText ? ` + ${scaleText}` : ''}${data.damageType ? ` (${data.damageType})` : ''}`
      : 'Damage: None';
  const heal = data.heal ? `Healing: ${data.heal}` : '';
  const description = data.description || owner.name + "'s active ability.";
  const formula = data.damageFraction
    ? 'Fraction of target maximum HP'
    : scaleText || (data.damage ? 'Flat damage' : 'No damage scaling');
  const targeting = data.targeting || (data.heal ? 'self' : 'area');
  const targetText = data.summonBuilding
    ? 'Target: place the building anywhere on the arena'
    : targeting === 'unit'
    ? `Target: ${data.targetTeam || 'unit'} within ${data.targetRange} units`
    : targeting === 'self'
      ? 'Target: self (click anywhere on the arena)'
      : targeting === 'direction'
        ? data.arcAngle
          ? `Target: ${data.arcAngle}° arc within ${data.range} units`
          : `Target: direction, ${data.hitMode === 'first' ? 'first hit' : 'all hits'}`
        : data.burrowTurns
          ? 'Target: any point on the map'
          : `Target: area, radius ${data.radius}${data.castRange ? `; within ${data.castRange}` : ''}`;
  const duration = data.durationSeconds
    ? `Duration: ${data.durationSeconds} seconds`
    : data.duration ? `Duration: ${data.duration} turn ends` : '';
  el.innerHTML = `<button class="modal-close" id="closeAbilityModal">×</button><small>ABILITY CARD</small><h3>${data.name}</h3><p>${description}</p><div><span>Owner: ${owner.name}</span><span>AP cost: ${data.darkCost}</span><span>AC cost: ${data.apCost}</span><span>${targetText}</span><span>${damage}</span><span>${heal}</span><span>${duration}</span><span>Scaling: ${formula}</span></div>`;
  el.classList.remove('hidden');
  $('closeAbilityModal').onclick = () => el.classList.add('hidden');
}

function selectCard(card) {
  if (game.winner !== null) return;
  if (game.isMoving()) return;
  if (redrawMode) {
    if (card.kind === 'ability') {
      const index = selectedRedraw.indexOf(card);
      if (index >= 0) selectedRedraw.splice(index, 1);
      else if (selectedRedraw.length < 3) selectedRedraw.push(card);
      else toast('Select up to 3 cards');
      renderUI();
    } else toast('Only skill cards can be discarded');
    return;
  }
  selectedCard = card;
  selectedMode = card.kind === 'troop' ? 'deploy' : 'ability';
  updateDeploymentPreview();
  if (card.kind === 'ability' && (!activeTroop || activeTroop.team !== game.turns.currentTeam || activeTroop.stats.id !== card.troopId)) {
    toast('Select your matching troop on the battlefield');
    selectedCard = null;
    selectedMode = 'select';
    renderUI();
    return;
  }
  renderUI();
}

function basicAttack(target = null) {
  if (game.winner !== null) return;
  if (game.isMoving()) return;
  if (!activeTroop || activeTroop.team !== game.turns.currentTeam) {
    toast('Select one of your troops');
    return;
  }
  if (activeTroop.stunned) {
    toast('Troop is stunned');
    return;
  }
  if (activeTroop.isClone) {
    toast('Clones cannot be controlled');
    return;
  }
  const eligible = game.targetsFor(activeTroop);
  activeTroop.validateFocus(eligible);
  if (!activeTroop.focus) activeTroop.updateFocus(eligible);
  const resolvedTarget = target?.team !== undefined ? target : activeTroop.focus;
  const supportAttack = activeTroop.stats.targetPreference === 'allies';
  if (!resolvedTarget || (resolvedTarget.team === activeTroop.team && !supportAttack) || resolvedTarget.hp <= 0 || activeTroop.attackDistanceTo(resolvedTarget) > activeTroop.attackRange) {
    toast(supportAttack ? 'No ally in attack range' : 'No enemy in attack range');
    return;
  }
  if (!activeTroop.eligibleTargets(eligible).includes(resolvedTarget)) {
    toast(activeTroop.stats.targetPreference === 'structures'
      ? `${activeTroop.stats.name} prioritizes structures while one is in sight`
      : 'This troop cannot target that unit type');
    return;
  }
  if (activeTroop.ac < activeTroop.stats.attackCost) {
    toast('Not enough AC');
    return;
  }
  const damage = game.attack(activeTroop, resolvedTarget);
  if (damage !== false) {
    const targetName = resolvedTarget.stats?.name || (resolvedTarget.layer ? `${resolvedTarget.layer} turret` : 'base');
    const message = game.applyHeroHook(activeTroop, 'attackLog', targetName, damage) ||
      (supportAttack
        ? `${game.teamName(activeTroop.team)} ${activeTroop.stats.name} restored ${damage} HP to allies`
        : `${game.teamName(activeTroop.team)} ${activeTroop.stats.name} dealt ${damage} ${activeTroop.stats.basicAttack.damageType} damage`);
    game.addEvent(message, activeTroop.team);
    renderUI();
    return true;
  }
  return false;
}
function endTurn() {
  if (game.winner !== null) return;
  if (game.isMoving()) return;
  game.endTurn();
  activeTroop = null;
  window.activeTroop = null;
  selectedCard = null;
  selectedMode = 'select';
  renderUI();
}
function moveSelected(p) {
  if (game.winner !== null) return;
  if (game.isMoving()) return false;
  if (!activeTroop || activeTroop.team !== game.turns.currentTeam) {
    toast('Select one of your troops');
    return false;
  }
  if (activeTroop.stunned) {
    toast('Troop is stunned');
    return false;
  }
  if (game.move(activeTroop, p.x, p.y)) {
    game.addEvent(game.message, activeTroop.team);
    renderUI();
    return true;
  }
  toast(game.message);
  return false;
}
canvas.onmousemove = (e) => {
  hover = fieldPoint(e);
  updateDeploymentPreview();
};
canvas.onclick = (e) => {
  if (game.isMoving() || game.winner !== null) return;
  const p = fieldPoint(e);
  if (selectedMode === 'deploy' && selectedCard) {
    if (game.deploy(selectedCard, p.x, p.y)) {
      toast(`${selectedCard.name} deployed`);
      selectedCard = null;
      selectedMode = 'select';
      deploymentPreview = null;
    } else {
      toast(game.message);
      updateDeploymentPreview();
    }
  } else if (selectedMode === 'ability' && selectedCard && activeTroop) {
    const ability = game.abilities[selectedCard.abilityId];
    const target = ability.targeting === 'unit' ? abilityTargetAt(p, ability, activeTroop) : null;
    if (game.cast(selectedCard, activeTroop, p.x, p.y, target)) {
      toast(`${selectedCard.name} cast`);
      selectedCard = null;
      selectedMode = 'select';
    } else {
      toast(game.message);
    }
  } else if (selectedMode === 'move') {
    if (moveSelected(p)) selectedMode = 'select';
  } else if (selectedMode === 'attack') {
    const troopTarget = troopAt(p);
    const target = troopTarget && (activeTroop?.stats.targetPreference === 'allies'
      ? troopTarget.team === activeTroop.team
      : troopTarget.team !== game.turns.currentTeam)
      ? troopTarget
      : activeTroop?.stats.targetPreference === 'allies' ? null : turretAt(p) || baseAt(p);
    if (target && basicAttack(target)) selectedMode = 'select';
    else if (!target) toast('Choose an enemy in attack range');
  } else {
    const troop = troopAt(p);
    if (troop) {
      if (troop.isDrone) {
        activeTroop = troop;
        window.activeTroop = troop;
        selectedMode = 'select';
        toast('Drones cannot be controlled');
        showTroopInspector();
        renderUI();
        return;
      }
      if (troop.team === game.turns.currentTeam && troop.isClone) {
        activeTroop = null;
        window.activeTroop = null;
        selectedMode = 'select';
        toast('Clones cannot be controlled');
        showTroopInspector();
        renderUI();
        return;
      }
      activeTroop = troop;
      window.activeTroop = troop;
      if (troop.team === game.turns.currentTeam) {
        activeTroop.validateFocus(game.targetsFor(activeTroop));
        if (!activeTroop.focus) activeTroop.updateFocus(game.targetsFor(activeTroop));
      }
    } else {
      const structure = turretAt(p) || baseAt(p);
      if (structure && activeTroop && !activeTroop.burrowed && activeTroop.team === game.turns.currentTeam) {
        if (activeTroop.attackDistanceTo(structure) <= activeTroop.attackRange) {
          activeTroop.focus = structure;
        } else {
          toast('Structure is outside attack range');
        }
      }
    }
  }
  showTroopInspector();
  renderUI();
};
canvas.oncontextmenu = (e) => {
  e.preventDefault();
  if (game.isMoving() || game.winner !== null) return;
  const point = fieldPoint(e);
  const troopTarget = troopAt(point);
  const support = activeTroop?.stats.targetPreference === 'allies';
  const target = troopTarget && (support
    ? troopTarget.team === activeTroop?.team
    : troopTarget.team !== activeTroop?.team)
    ? troopTarget
    : support ? null : turretAt(point) || baseAt(point);
  if (target) basicAttack(target);
  else basicAttack();
};

function drawExtras() {
  const c = renderer.ctx;
  c.save();
  if (deploymentPreview && selectedCard) {
    const color = deploymentPreview.valid ? '#78f0ac' : '#ff6978';
    const radius = game.collisionRadiusForStats(game.stats[selectedCard.troopId]);
    const positions = deploymentPreview.positions.length
      ? deploymentPreview.positions
      : [{ x: hover.x, y: hover.y, radius }];
    c.save();
    c.globalAlpha = 0.68;
    c.fillStyle = deploymentPreview.valid ? '#55e1dd35' : '#ff697835';
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.setLineDash(deploymentPreview.valid ? [] : [5, 4]);
    for (const position of positions) {
      const unitRadius = position.radius || radius;
      c.beginPath();
      c.arc(position.x, position.y, unitRadius, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.beginPath();
      c.arc(position.x, position.y, 3, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      c.fillStyle = deploymentPreview.valid ? '#55e1dd35' : '#ff697835';
    }
    c.restore();
  }
  if (activeTroop && activeTroop.hp > 0 && !activeTroop.burrowed) {
    c.lineWidth = 2;
    c.setLineDash([7, 6]);
    c.strokeStyle = '#f5f7fa99';
    c.beginPath();
    c.arc(activeTroop.x, activeTroop.y, activeTroop.sightRange + activeTroop.collisionRadius, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#f4d35ecc';
    c.beginPath();
    c.arc(activeTroop.x, activeTroop.y, activeTroop.attackRange + activeTroop.collisionRadius, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
  }
  for (const terrain of game.board.terrains) {
    c.save();
    if (terrain.type === 'rock') {
      c.fillStyle = '#59616d';
      c.beginPath();
      c.arc(terrain.x, terrain.y, terrain.r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#9aa3ad';
      c.stroke();
    } else {
      c.fillStyle = '#3d4652';
      c.fillRect(terrain.x, terrain.y, terrain.w, terrain.h);
      c.strokeStyle = '#748091';
      c.strokeRect(terrain.x, terrain.y, terrain.w, terrain.h);
    }
    c.restore();
  }
  for (const troop of game.board.troops) {
    if (troop.hp <= 0 || troop.burrowed || !troop.isMoving()) continue;
    c.save();
    c.strokeStyle = troop.team === 0 ? '#55e1dd99' : '#ff697899';
    c.lineWidth = 2;
    c.setLineDash([6, 5]);
    c.beginPath();
    c.moveTo(troop.x, troop.y);
    for (const wp of troop.waypoints) {
      c.lineTo(wp.x, wp.y);
    }
    c.stroke();
    const dest = troop.waypoints[troop.waypoints.length - 1];
    if (dest) {
      c.fillStyle = troop.team === 0 ? '#55e1dd55' : '#ff697855';
      c.beginPath();
      c.arc(dest.x, dest.y, 5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
  for (const troop of game.board.troops) {
    if (troop.hp <= 0 || troop.burrowed) continue;
    renderer.drawTroop(troop);
  }
  for (const troop of game.board.troops) {
    const barrier = troop.effects.find((effect) => effect.type === 'line-barrier' && effect.remainingTurns > 0);
    if (!barrier || troop.hp <= 0) continue;
    const centerX = troop.x + Math.cos(barrier.angle) * (barrier.frontOffset || 0);
    const centerY = troop.y + Math.sin(barrier.angle) * (barrier.frontOffset || 0);
    const perpendicular = barrier.angle + Math.PI / 2;
    const halfLength = barrier.length / 2;
    const start = { x: centerX - Math.cos(perpendicular) * halfLength, y: centerY - Math.sin(perpendicular) * halfLength };
    const end = { x: centerX + Math.cos(perpendicular) * halfLength, y: centerY + Math.sin(perpendicular) * halfLength };
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = '#d5e1e8';
    c.shadowColor = '#e7f3ff';
    c.shadowBlur = 15;
    c.lineWidth = 13;
    c.beginPath();
    c.moveTo(start.x, start.y);
    c.lineTo(end.x, end.y);
    c.stroke();
    c.shadowBlur = 0;
    c.strokeStyle = '#76848d';
    c.lineWidth = 3;
    c.stroke();
    c.restore();
  }
  for (const effect of game.board.areaEffects) {
    const fade = Math.max(0, effect.remainingSeconds / effect.duration);
    const color = effect.team === 0 ? '#55e1dd' : '#ff6978';
    c.save();
    if (effect.kind === 'ricochet-path') {
      const points = effect.points || [];
      c.globalAlpha = Math.min(1, fade * 1.4);
      c.strokeStyle = color;
      c.lineWidth = 4;
      c.setLineDash([9, 5]);
      c.beginPath();
      points.forEach((point, index) => index === 0 ? c.moveTo(point.x, point.y) : c.lineTo(point.x, point.y));
      c.stroke();
      c.setLineDash([]);
      const segments = points.slice(1).map((point, index) => ({
        from: points[index], to: point,
        length: Math.hypot(point.x - points[index].x, point.y - points[index].y),
      }));
      let travel = segments.reduce((sum, segment) => sum + segment.length, 0) * (1 - fade);
      let projectile = points[0];
      for (const segment of segments) {
        if (travel <= segment.length) {
          const ratio = segment.length ? travel / segment.length : 1;
          projectile = {
            x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
            y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
          };
          break;
        }
        travel -= segment.length;
        projectile = segment.to;
      }
      c.fillStyle = '#fff3ac';
      c.shadowColor = '#ffd86b';
      c.shadowBlur = 18;
      c.beginPath();
      c.arc(projectile.x, projectile.y, 9, 0, Math.PI * 2);
      c.fill();
      c.restore();
      continue;
    }
    c.globalAlpha = fade * 0.55;
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.beginPath();
    if (effect.kind === 'arc') {
      const half = effect.arcAngle * Math.PI / 360;
      c.moveTo(effect.x, effect.y);
      c.arc(effect.x, effect.y, effect.range, effect.angle - half, effect.angle + half);
      c.closePath();
    } else {
      c.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
    }
    c.fill();
    c.stroke();
    c.restore();
  }
  for (const owner of game.board.troops) {
    const dome = owner.effects.find((effect) => effect.type === 'protective-dome' && effect.remainingAmount > 0);
    if (!dome || owner.hp <= 0) continue;
    c.save();
    c.fillStyle = owner.team === 0 ? '#55e1dd18' : '#ff697818';
    c.strokeStyle = owner.team === 0 ? '#55e1ddaa' : '#ff6978aa';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(owner.x, owner.y, dome.radius, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = '#eef3f7';
    c.font = 'bold 12px Segoe UI';
    c.textAlign = 'center';
    c.fillText(`DOME ${Math.ceil(dome.remainingAmount)} HP`, owner.x, owner.y - dome.radius - 8);
    c.restore();
  }
  for (const strike of game.board.strikes) {
    if (strike.team !== game.turns.currentTeam) continue;
    const data = game.abilities[strike.abilityId];
    c.save();
    c.strokeStyle = '#d2a8ffcc';
    c.fillStyle = '#b985ff14';
    c.lineWidth = 3;
    c.setLineDash([8, 6]);
    c.beginPath();
    c.arc(strike.x, strike.y, data.radius, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.setLineDash([4, 5]);
    c.strokeStyle = '#f6e7ffdd';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(strike.x, strike.y, data.centerRadius, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#f0e4ff';
    c.font = 'bold 13px Segoe UI';
    c.textAlign = 'center';
    c.fillText(`SKYFALL · ${strike.remainingTurns} turn ends`, strike.x, strike.y - data.radius - 10);
    c.restore();
  }
  for (const impact of game.board.impacts) {
    const progress = 1 - impact.remainingSeconds / impact.duration;
    c.save();
    if (impact.kind === 'skyfall') {
      const alpha = Math.max(0, 1 - progress);
      const expansion = 0.35 + progress;
      c.fillStyle = `rgba(243, 223, 255, ${0.2 * alpha})`;
      c.strokeStyle = `rgba(226, 189, 255, ${alpha})`;
      c.lineWidth = 5;
      c.beginPath();
      c.arc(impact.x, impact.y, impact.radius * expansion, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.strokeStyle = `rgba(255, 245, 205, ${alpha})`;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(impact.x, impact.y, impact.innerRadius * expansion, 0, Math.PI * 2);
      c.stroke();
      if (progress < 0.65) {
        const bombY = impact.y - 150 * (1 - progress / 0.65);
        c.fillStyle = '#f2d8ff';
        c.shadowColor = '#c78aff';
        c.shadowBlur = 24;
        c.beginPath();
        c.arc(impact.x, bombY, 13, 0, Math.PI * 2);
        c.fill();
        c.shadowBlur = 0;
        c.strokeStyle = '#efdfff';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(impact.x, bombY - 20);
        c.lineTo(impact.x, bombY - 44);
        c.stroke();
      }
      c.restore();
      continue;
    }
    if (impact.kind === 'drone-explosion' || impact.kind === 'momentum-burst') {
      const alpha = Math.max(0, 1 - progress);
      const momentumBurst = impact.kind === 'momentum-burst';
      c.fillStyle = momentumBurst
        ? `rgba(93, 194, 255, ${0.32 * alpha})`
        : `rgba(255, 174, 74, ${0.42 * alpha})`;
      c.strokeStyle = momentumBurst
        ? `rgba(191, 237, 255, ${alpha})`
        : `rgba(255, 229, 164, ${alpha})`;
      c.lineWidth = 4;
      c.beginPath();
      c.arc(impact.x, impact.y, impact.radius * (0.25 + progress), 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
      continue;
    }
    c.fillStyle = `rgba(243, 223, 255, ${0.25 * (1 - progress)})`;
    c.strokeStyle = `rgba(226, 189, 255, ${1 - progress})`;
    c.lineWidth = 5;
    c.beginPath();
    c.arc(impact.x, impact.y, impact.radius * Math.max(0.2, progress), 0, Math.PI * 2);
    c.fill();
    c.stroke();
    if (progress < 0.65) {
      const bombY = impact.y - 150 * (1 - progress / 0.65);
      c.fillStyle = '#f2d8ff';
      c.shadowColor = '#c78aff';
      c.shadowBlur = 24;
      c.beginPath();
      c.arc(impact.x, bombY, 13, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#efdfff';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(impact.x, bombY - 20);
      c.lineTo(impact.x, bombY - 44);
      c.stroke();
    }
    c.restore();
  }
  for (const turret of game.board.turrets) {
    if (turret.hp <= 0) continue;
    c.save();
    c.translate(turret.x, turret.y);
    const radius = turret.radius;
    const sizeScale = radius / 27;
    const color = turret.team === 0 ? '#55e1dd' : '#ff6978';
    c.fillStyle = color;
    c.shadowColor = c.fillStyle;
    c.shadowBlur = 18;
    c.beginPath();
    c.arc(0, 0, radius, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#151923';
    c.beginPath();
    c.arc(0, 0, radius * (15 / 27), 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#eef2f7';
    c.fillRect(-18 * sizeScale, -4.5 * sizeScale, 36 * sizeScale, 9 * sizeScale);
    const gap = 4 * Math.sqrt(turret.size);
    const barHeight = 5 * Math.sqrt(turret.size);
    const barWidth = radius * 1.7;
    const barY = -radius - gap - barHeight;
    renderer.drawHealthBar(turret, -barWidth / 2, barY, barWidth, barHeight, color);
    c.fillStyle = '#eef3f7';
    c.font = `bold ${11 * Math.sqrt(turret.size)}px Segoe UI`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillText(String(turret.hp), 0, barY - 3);
    c.restore();
  }
  for (const tower of game.board.towers) {
    if (tower.hp <= 0) continue;
    c.save();
    c.translate(tower.x, tower.y);
    const color = tower.team === 0 ? '#55e1dd' : '#ff6978';
    const radius = tower.radius;
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 22;
    c.fillRect(-radius, -radius, radius * 2, radius * 2);
    c.fillStyle = '#10141b';
    c.fillRect(-radius * 0.75, -radius * 0.75, radius * 1.5, radius * 1.5);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -radius * 0.5);
    c.lineTo(radius * 0.5, radius / 3);
    c.lineTo(-radius * 0.5, radius / 3);
    c.closePath();
    c.fill();
    c.shadowBlur = 0;
    const gap = 4 * Math.sqrt(tower.size);
    const barHeight = 5 * Math.sqrt(tower.size);
    const barWidth = radius * 1.7;
    const barY = -radius - gap - barHeight;
    renderer.drawHealthBar(tower, -barWidth / 2, barY, barWidth, barHeight, color);
    c.fillStyle = '#eef3f7';
    c.font = `bold ${11 * Math.sqrt(tower.size)}px Segoe UI`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillText(String(tower.hp), 0, barY - 3);
    c.restore();
  }
  for (const structure of [...game.board.turrets, ...game.board.towers]) {
    if (structure.hp <= 0) continue;
    c.save();
    c.strokeStyle = structure.team === 0 ? '#55e1dd55' : '#ff697855';
    c.lineWidth = 2;
    c.setLineDash([8, 7]);
    c.beginPath();
    c.arc(structure.x, structure.y, structure.range + structure.radius, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }
  c.restore();

  c.save();
  for (const projectile of game.board.projectiles) {
    const target = projectile.targetUnit || projectile.targetPoint || projectile.to;
    if (!target) continue;
    const dx = target.x - projectile.from.x;
    const dy = target.y - projectile.from.y;
    const distance = Math.hypot(dx, dy) || 1;
    const sourceRadius = projectile.source?.collisionRadius || projectile.source?.radius || 0;
    const targetRadius = target.collisionRadius || target.radius || 0;
    const startX = projectile.from.x + dx / distance * sourceRadius;
    const startY = projectile.from.y + dy / distance * sourceRadius;
    const endX = target.x - dx / distance * targetRadius;
    const endY = target.y - dy / distance * targetRadius;
    const x = startX + (endX - startX) * projectile.progress;
    const y = startY + (endY - startY) * projectile.progress;
    c.save();
    c.fillStyle = projectile.abilityId ? '#c0afff' : '#ffd875';
    c.shadowColor = projectile.abilityId ? '#a08cff' : '#ffad66';
    c.shadowBlur = 12;
    c.beginPath();
    c.arc(x, y, 7, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.restore();

  if (activeTroop && !activeTroop.burrowed && activeTroop.focus) {
    const screenX = activeTroop.focus.x;
    const screenY = activeTroop.focus.y;
    c.save();
    c.strokeStyle = '#f4d35e';
    c.lineWidth = 3;
    c.setLineDash([7, 5]);
    c.beginPath();
    c.arc(screenX, screenY, collisionRadiusOf(activeTroop.focus), 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }
  if (selectedMode === 'ability' && selectedCard && activeTroop) {
    const ability = game.abilities[selectedCard.abilityId];
    if (ability.targeting === 'area') {
      c.save();
      c.fillStyle = '#a08cff20';
      c.strokeStyle = '#c0afffdd';
      c.lineWidth = 2;
      c.setLineDash([8, 6]);
      c.beginPath();
      c.arc(hover.x, hover.y, ability.radius || (ability.burrowTurns ? 22 : ability.summonBuilding ? 26 : 0), 0, Math.PI * 2);
      c.fill();
      c.stroke();
      if (ability.castRange) {
        c.strokeStyle = '#8be9ff99';
        c.setLineDash([6, 6]);
        c.beginPath();
        c.arc(activeTroop.x, activeTroop.y, ability.castRange + activeTroop.collisionRadius, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
    } else if (ability.targeting === 'unit') {
      if (ability.targetRange) {
        c.save();
        c.strokeStyle = '#70f0a855';
        c.lineWidth = 2;
        c.setLineDash([6, 6]);
        c.beginPath();
        c.arc(activeTroop.x, activeTroop.y, ability.targetRange + activeTroop.collisionRadius, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
      const target = abilityTargetAt(hover, ability, activeTroop);
      if (target) {
        c.save();
        const targetColor = ability.targetTeam === 'enemy' ? '#ff7486' : '#70f0a8';
        c.strokeStyle = targetColor;
        c.fillStyle = `${targetColor}22`;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(target.x, target.y, collisionRadiusOf(target), 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.restore();
      }
    } else if (ability.targeting === 'direction') {
      c.save();
      c.strokeStyle = '#c0afffbb';
      if (ability.arcAngle) {
        const center = Math.atan2(hover.y - activeTroop.y, hover.x - activeTroop.x);
        const halfArc = ability.arcAngle * Math.PI / 360;
        c.fillStyle = '#c0afff22';
        c.beginPath();
        c.moveTo(activeTroop.x, activeTroop.y);
        c.arc(activeTroop.x, activeTroop.y, ability.range + activeTroop.collisionRadius, center - halfArc, center + halfArc);
        c.closePath();
        c.fill();
        c.stroke();
      } else {
        c.lineWidth = (ability.lineWidth || 24) * 2;
        c.lineCap = 'round';
        const dx = hover.x - activeTroop.x;
        const dy = hover.y - activeTroop.y;
        const distance = Math.hypot(dx, dy);
        const maxDistance = ability.range + activeTroop.collisionRadius;
        const scale = ability.range && distance > maxDistance ? maxDistance / distance : 1;
        c.beginPath();
        c.moveTo(activeTroop.x, activeTroop.y);
        c.lineTo(activeTroop.x + dx * scale, activeTroop.y + dy * scale);
        c.stroke();
      }
      c.restore();
      const targets = game.directionalAbilityTargets(ability, activeTroop, hover.x, hover.y);
      for (const target of targets) {
        c.save();
        c.strokeStyle = '#70f0a8';
        c.fillStyle = '#70f0a822';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(target.x, target.y, collisionRadiusOf(target), 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.restore();
      }
    } else if (ability.targeting === 'self') {
      c.save();
      c.strokeStyle = '#70f0a8cc';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(activeTroop.x, activeTroop.y, 22, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
  }
  renderer.drawAttackAnimations(game);
  renderer.drawDamageNumbers(game);
}

function renderUI() {
  renderedPhase = game.phase;
  flushGameEvents();
  draftPanel.render(game);
  matchSummary.render(game);
  hud.update(game);
  draftPanel.update(game);
  bottom.render(game, selectCard, activeTroop, showAbilityInfo, selectedRedraw);
  updateDeploymentPreview();
  renderer.draw(game, hover, selectedMode);
  drawExtras();
  showTroopInspector();
}

$('endTurn').onclick = endTurn;
$('surrender').onclick = () => {
  if (!game.surrender()) return;
  selectedCard = null;
  selectedMode = 'select';
  deploymentPreview = null;
  activeTroop = null;
  window.activeTroop = null;
  redrawMode = false;
  selectedRedraw = [];
  $('redrawModal').classList.add('hidden');
  renderUI();
};
$('arenaZoom').oninput = (event) => setArenaZoom(Number(event.target.value));
$('zoomOut').onclick = () => setArenaZoom(Number($('arenaZoom').value) - 10);
$('zoomIn').onclick = () => setArenaZoom(Number($('arenaZoom').value) + 10);
$('zoomReset').onclick = () => setArenaZoom(100);
function setArenaZoom(percent) {
  const value = Math.max(65, Math.min(150, percent));
  const zoom = value / 100;
  const arena = document.querySelector('.arena-layout');
  arena.style.setProperty('--arena-zoom', zoom);
  arena.style.setProperty('--arena-stage-width', `${1560 * zoom}px`);
  arena.style.setProperty('--arena-stage-height', `${570 * zoom}px`);
  $('arenaZoom').value = value;
  $('arenaZoomValue').value = `${value}%`;
  $('arenaZoomValue').textContent = `${value}%`;
}
setArenaZoom(100);
$('cancelAction').onclick = () => {
  if (game.isMoving()) return;
  selectedCard = null;
  selectedMode = 'select';
  deploymentPreview = null;
  redrawMode = false;
  selectedRedraw = [];
  $('redrawModal').classList.add('hidden');
  renderUI();
};

function openRedraw(resource) {
  if (game.isMoving() || game.winner !== null) return;
  const player = game.activePlayer();
  const enough = resource === 'elixir' ? player.elixir >= 100 : player.ap >= 100;
  if (!enough) {
    toast('Not enough resource');
    return;
  }
  redrawMode = true;
  redrawResource = resource;
  selectedRedraw = [];
  const el = $('redrawModal');
  el.classList.remove('hidden');
  el.querySelector('strong').textContent =
    `Discard skills for 100 ${resource === 'elixir' ? 'Elixir' : 'AP'}`;
  el.querySelector('span').textContent = 'Select up to 3 skill cards';
  renderUI();
}

$('discardAp').onclick = () => openRedraw('ap');
$('discardElixir').onclick = () => openRedraw('elixir');
$('confirmRedraw').onclick = () => {
  if (game.isMoving()) return;
  if (!selectedRedraw.length) {
    toast('Select at least 1 skill card');
    return;
  }
  if (game.discardAbilities(redrawResource, selectedRedraw)) toast(game.message);
  else toast(game.message);
  selectedRedraw = [];
  redrawMode = false;
  $('redrawModal').classList.add('hidden');
  renderUI();
};
$('cancelRedraw').onclick = () => {
  selectedRedraw = [];
  redrawMode = false;
  $('redrawModal').classList.add('hidden');
  renderUI();
};

document.addEventListener('keydown', (e) => {
  if (game.isMoving() || game.winner !== null) return;
  if (e.key === 'Enter' && !redrawMode) endTurn();
  if (e.key === 'Escape') {
    $('abilityModal').classList.add('hidden');
    $('troopInspector').classList.add('hidden');
    $('redrawModal').classList.add('hidden');
    redrawMode = false;
    selectedRedraw = [];
    renderUI();
  }
});

let wasMoving = false;
let lastTime = performance.now();
let renderedPhase = game.phase;

function loop(timestamp = performance.now()) {
  const dt = Math.max(0, Math.min((timestamp - lastTime) / 1000, 0.1));
  lastTime = timestamp;

  const isMovingNow = game.isMoving();
  game.update(dt);
  if (game.shakeTimer > 0) {
    const amount = 10 * (game.shakeTimer / 2);
    canvas.style.transform = `translate(${(Math.random() - 0.5) * amount}px, ${(Math.random() - 0.5) * amount}px)`;
  } else canvas.style.transform = '';
  flushGameEvents();
  hud.update(game);
  const draftChanged = draftPanel.update(game);
  if (renderedPhase !== game.phase) {
    renderedPhase = game.phase;
    renderUI();
  }
  else if (draftChanged) bottom.render(game, selectCard, activeTroop, showAbilityInfo, selectedRedraw);

  renderer.draw(game, hover, selectedMode);
  drawExtras();

  if (!isMovingNow && wasMoving) {
    for (const troop of game.board.troops) {
      troop.validateFocus(game.targetsFor(troop));
      if (!troop.focus) troop.updateFocus(game.targetsFor(troop));
    }
    renderUI();
  }
  wasMoving = isMovingNow;

  requestAnimationFrame(loop);
}
renderUI();
requestAnimationFrame(loop);
