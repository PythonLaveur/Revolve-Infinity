import { UNIT_ICON_IMAGES } from '../data/unit_icons.js';
import { RADIUS_PER_SIZE } from '../units/stats.js';
import { applyArenaTransform, arenaTransformScale } from './arena_coordinates.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.arenaBackground = new Image();
    this.arenaBackground.src = new URL('../data/game-icons/rec_legends_arena_1512x560_narrow_river.png', import.meta.url).href;
  }
  draw(game, hover, selectedMode) {
    const c = this.ctx,
      w = this.canvas.width,
      h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    if (this.arenaBackground.complete && this.arenaBackground.naturalWidth > 0) {
      // Contain the full illustration without cropping its decorative border.
      const scale = Math.min(w / this.arenaBackground.naturalWidth, h / this.arenaBackground.naturalHeight);
      const imageWidth = this.arenaBackground.naturalWidth * scale;
      const imageHeight = this.arenaBackground.naturalHeight * scale;
      c.drawImage(
        this.arenaBackground,
        (w - imageWidth) / 2,
        (h - imageHeight) / 2,
        imageWidth,
        imageHeight,
      );
    } else {
      c.fillStyle = '#18212c';
      c.fillRect(0, 0, w, h);
    }
    c.save();
    applyArenaTransform(c, game.board.width, game.board.height);
    for (const patch of game.board.grassPatches) {
      c.fillStyle = patch.team === 0 ? '#70b85a45' : '#8dcc5545';
      c.strokeStyle = patch.team === 0 ? '#9de87988' : '#c2f28e88';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(patch.x, patch.y, patch.radius, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    for (const structure of [...game.board.turrets, ...game.board.towers]) {
      if (structure.hp <= 0) continue;
      const inhibitionRange = structure.radius + structure.range * 1.3;
      c.fillStyle = structure.team === 0 ? '#55e1dd10' : '#ff697810';
      c.beginPath();
      c.arc(structure.x, structure.y, inhibitionRange, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = structure.team === 0 ? '#55e1dd88' : '#ff697888';
      c.lineWidth = 2;
      c.setLineDash([10, 8]);
      c.beginPath();
      c.arc(structure.x, structure.y, inhibitionRange, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    for (const zone of game.board.zones) {
      c.save();
      if (zone.visual) {
        const visual = zone.visual;
        c.fillStyle = visual.fill || '#7be7ff20';
        c.beginPath();
        c.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = visual.stroke || '#8cecffbb';
        c.lineWidth = visual.lineWidth || 2;
        c.setLineDash(visual.dash || []);
        c.beginPath();
        c.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        if (visual.innerRadiusMultiplier) {
          c.globalAlpha = 0.75;
          c.beginPath();
          c.arc(zone.x, zone.y, zone.radius * visual.innerRadiusMultiplier, 0, Math.PI * 2);
          c.stroke();
          c.globalAlpha = 1;
        }
        const label = visual.label ? `${visual.label} · ` : '';
        c.fillStyle = visual.textColor || '#eafaff';
        c.font = 'bold 12px Segoe UI';
        c.textAlign = 'center';
        c.fillText(`${label}${zone.remainingTurns} TURNS`, zone.x, zone.y - zone.radius - 7);
        c.restore();
        continue;
      }
      c.fillStyle = '#7be7ff20';
      c.strokeStyle = '#8cecffbb';
      c.lineWidth = 2;
      c.setLineDash([7, 5]);
      c.beginPath();
      c.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#eafaff';
      c.font = 'bold 12px Segoe UI';
      c.textAlign = 'center';
      c.fillText(`⚡ ${zone.remainingTurns}`, zone.x, zone.y - zone.radius - 6);
      c.restore();
    }
    c.restore();
  }
  drawTower(t) {
    if (t.hp <= 0) return;
    const c = this.ctx;
    c.save();
    c.translate(t.x, t.y);
    const arenaScale = arenaTransformScale(this.canvas.width, this.canvas.height);
    c.scale(1 / arenaScale.x, 1 / arenaScale.y);
    const color = t.team === 0 ? '#55e1dd' : '#ff6978';
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 22;
    const radius = t.radius || RADIUS_PER_SIZE * (t.size || 3);
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
    const gap = 4 * Math.sqrt(t.size || 3);
    const barHeight = 5 * Math.sqrt(t.size || 3);
    const barWidth = radius * 1.6;
    const barY = -radius - gap - barHeight;
    this.drawHealthBar(t, -barWidth / 2, barY, barWidth, barHeight, color);
    c.fillStyle = '#eef3f7';
    c.font = 'bold 11px Segoe UI';
    c.textAlign = 'center';
    c.fillText(t.hp, 0, barY - 3);
    c.restore();
  }
  drawTroop(t) {
    if (t.burrowed) return;
    const c = this.ctx;
    c.save();
    const airborne = t.effects.some((effect) => effect.type === 'airborne');
    c.translate(t.x, t.y - (airborne ? 25 * t.size : 0));
    const arenaScale = arenaTransformScale(this.canvas.width, this.canvas.height);
    c.scale(1 / arenaScale.x, 1 / arenaScale.y);
    c.scale(t.size, t.size);
    const color = t.team === 0 ? '#55e1dd' : '#ff6978';
    if (t.stats.movementType === 'air' || airborne) {
      c.fillStyle = '#07111b88';
      c.beginPath();
      c.ellipse(0, airborne ? 47 : 22, 18, 7, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#d8f5ff';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-15, -7);
      c.quadraticCurveTo(-23, -17, -26, -9);
      c.moveTo(15, -7);
      c.quadraticCurveTo(23, -17, 26, -9);
      c.stroke();
    }
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = t === window.activeTroop ? 10 : (t.isMoving && t.isMoving() ? 8 : 3.5);
    c.beginPath();
    if (t.stats.isBuilding) c.rect(-RADIUS_PER_SIZE, -RADIUS_PER_SIZE, RADIUS_PER_SIZE * 2, RADIUS_PER_SIZE * 2);
    else c.arc(0, 0, RADIUS_PER_SIZE, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#171b24';
    c.beginPath();
    if (t.stats.isBuilding) c.rect(-RADIUS_PER_SIZE * 0.946, -RADIUS_PER_SIZE * 0.946, RADIUS_PER_SIZE * 1.892, RADIUS_PER_SIZE * 1.892);
    else c.arc(0, 0, RADIUS_PER_SIZE * 0.946, 0, Math.PI * 2);
    c.fill();
    const icon = UNIT_ICON_IMAGES[t.stats.id];
    if (icon?.complete && icon.naturalWidth > 0) {
      c.save();
      c.beginPath();
      if (t.stats.isBuilding) c.rect(-RADIUS_PER_SIZE * 0.946, -RADIUS_PER_SIZE * 0.946, RADIUS_PER_SIZE * 1.892, RADIUS_PER_SIZE * 1.892);
      else c.arc(0, 0, RADIUS_PER_SIZE * 0.946, 0, Math.PI * 2);
      c.clip();
      c.drawImage(icon, -RADIUS_PER_SIZE * 0.96, -RADIUS_PER_SIZE * 0.96, RADIUS_PER_SIZE * 1.92, RADIUS_PER_SIZE * 1.92);
      c.restore();
      c.strokeStyle = color;
      c.lineWidth = 0.55;
      c.beginPath();
      if (t.stats.isBuilding) c.rect(-RADIUS_PER_SIZE * 0.946, -RADIUS_PER_SIZE * 0.946, RADIUS_PER_SIZE * 1.892, RADIUS_PER_SIZE * 1.892);
      else c.arc(0, 0, RADIUS_PER_SIZE * 0.946, 0, Math.PI * 2);
      c.stroke();
    } else {
      c.fillStyle = color;
      c.font = '900 16px Segoe UI';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(t.stats.icon || t.stats.name?.[0] || '?', 0, 0);
    }
    if (!t.stats.isBuilding) {
      c.save();
      c.scale(1 / Math.sqrt(t.size), 1 / Math.sqrt(t.size));
      c.rotate(t.facing || 0);
      c.fillStyle = '#f4f6fa';
      c.strokeStyle = '#10141b';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(19, 0);
      c.lineTo(12, -5);
      c.lineTo(12, 5);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
    c.shadowBlur = 0;
    const barWidth = t.stats.isBuilding ? 52 : 44;
    const bodyRadius = RADIUS_PER_SIZE;
    const barHeight = 5;
    const gap = 4 * Math.sqrt(t.size);
    const barY = -bodyRadius - gap / t.size - barHeight;
    this.drawHealthBar(t, -barWidth / 2, barY, barWidth, barHeight, color);
    c.restore();
  }
  drawHealthBar(target, x, y, width, height, color) {
    const c = this.ctx;
    const ratio = Math.max(0, Math.min(1, target.hp / Math.max(1, target.maxHp)));
    const now = Date.now();
    const lagRatio = target.damageBarUntil > now
      ? Math.max(ratio, Math.min(1, (target.damageBarHp || target.hp) / Math.max(1, target.maxHp)))
      : ratio;
    c.fillStyle = '#080b10';
    c.fillRect(x, y, width, height);
    if (lagRatio > ratio) {
      const fade = target.damageBarUntil > now
        ? Math.min(0.88, (target.damageBarUntil - now) / 500)
        : 0;
      c.globalAlpha = fade;
      c.fillStyle = '#ffd34e';
      c.fillRect(x + width * ratio, y, width * (lagRatio - ratio), height);
      c.globalAlpha = 1;
    } else if (target.damageBarUntil <= now) target.damageBarHp = target.hp;
    c.fillStyle = color;
    c.fillRect(x, y, width * ratio, height);
  }
  drawAttackAnimations(game) {
    const c = this.ctx;
    for (const animation of game.board.attackAnimations) {
      const progress = Math.max(0, Math.min(1, animation.elapsed / animation.duration));
      const attacker = animation.attacker;
      const target = animation.target;
      if (animation.kind === 'projectile') {
        const start = animation.from;
        const dx = target.x - start.x;
        const dy = target.y - start.y;
        const distance = Math.hypot(dx, dy) || 1;
        const sourceRadius = attacker.collisionRadius || attacker.radius || 0;
        const targetRadius = target.collisionRadius || target.radius || 0;
        const startX = start.x + sourceRadius * dx / distance;
        const startY = start.y + sourceRadius * dy / distance;
        const endX = target.x - targetRadius * dx / distance;
        const endY = target.y - targetRadius * dy / distance;
        const x = startX + (endX - startX) * progress;
        const y = startY + (endY - startY) * progress;
        const color = animation.damageType === 'heal'
          ? '#79f2ae'
          : animation.damageType === 'magic' ? '#81aaff' : '#ffd875';
        const tail = 15 * Math.sqrt(attacker.size || 1);
        c.save();
        c.globalAlpha = 1 - progress * 0.25;
        c.strokeStyle = color;
        c.lineWidth = 3 * Math.sqrt(attacker.size || 1);
        c.lineCap = 'round';
        c.shadowColor = color;
        c.shadowBlur = 12;
        c.beginPath();
        c.moveTo(x - dx / distance * tail, y - dy / distance * tail);
        c.lineTo(x, y);
        c.stroke();
        c.fillStyle = '#fff7dc';
        c.beginPath();
        c.arc(x, y, 4.5 * Math.sqrt(attacker.size || 1), 0, Math.PI * 2);
        c.fill();
        c.restore();
        continue;
      }

      const angle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
      const visualScale = Math.sqrt(attacker.size || 1);
      const color = attacker.team === 0 ? '#b9fbff' : '#ffe0e4';
      const fade = Math.sin(Math.PI * progress);
      c.save();
      c.globalAlpha = Math.max(0, fade);
      c.translate(attacker.x, attacker.y);
      c.rotate(angle);
      c.scale(visualScale, visualScale);
      c.strokeStyle = color;
      c.fillStyle = color;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.shadowColor = attacker.team === 0 ? '#55e1dd' : '#ff6978';
      c.shadowBlur = 10;
      if (animation.style === 'swing' || animation.style === 'hook') {
        c.lineWidth = animation.style === 'swing' ? 5 : 7;
        const radius = animation.style === 'swing' ? 27 : 20;
        const startAngle = animation.style === 'swing' ? -1.65 : 1.45;
        const sweep = (animation.style === 'swing' ? 2.5 : -2.15) * progress;
        c.beginPath();
        c.arc(9, 0, radius, startAngle, startAngle + sweep, sweep < 0);
        c.stroke();
      } else {
        const reach = animation.style === 'stab' ? 50 : animation.style === 'shove' ? 38 : 34;
        const end = 12 + reach * progress;
        c.lineWidth = animation.style === 'shove' ? 10 : animation.style === 'punch' ? 8 : 4;
        c.beginPath();
        c.moveTo(8, animation.style === 'hook' ? 4 : 0);
        c.lineTo(end, animation.style === 'hook' ? 4 : 0);
        c.stroke();
        c.beginPath();
        c.arc(end, 0, (animation.style === 'shove' ? 8 : 5), 0, Math.PI * 2);
        c.fill();
        if (animation.style === 'stab') {
          c.beginPath();
          c.moveTo(end + 8, 0);
          c.lineTo(end - 1, -5);
          c.lineTo(end - 1, 5);
          c.closePath();
          c.fill();
        }
      }
      c.restore();
    }
  }
  drawDamageNumbers(game) {
    const c = this.ctx;
    const now = Date.now();
    game.damageNumbers = game.damageNumbers.filter((number) => now - number.createdAt < 1800);
    for (const number of game.damageNumbers) {
      const progress = Math.max(0, Math.min(1, (now - number.createdAt) / 1800));
      const height = -132 * progress + 132 * progress * progress;
      const horizontal = number.direction * 28 * progress;
      const alpha = progress < 0.72 ? 1 : Math.max(0, (1 - progress) / 0.28);
      const vivid = number.damageType === 'magic' ? [77, 157, 255] : number.damageType === 'mixed' ? [197, 178, 255] : [255, 74, 72];
      const dull = [142, 148, 158];
      const intensity = Math.max(0, Math.min(1, number.intensity));
      const rgb = vivid.map((channel, index) => Math.round(dull[index] + (channel - dull[index]) * intensity));
      c.save();
      const arenaScale = arenaTransformScale(this.canvas.width, this.canvas.height);
      c.translate(number.x, number.y);
      c.scale(1 / arenaScale.x, 1 / arenaScale.y);
      c.globalAlpha = alpha;
      c.font = '900 17px Segoe UI, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 3;
      c.strokeStyle = '#11151dcc';
      const text = String(number.amount);
      const textX = horizontal + (number.shield ? 7 : 0);
      const textY = height;
      c.strokeText(text, textX, textY);
      c.fillStyle = `rgb(${rgb.join(',')})`;
      c.fillText(text, textX, textY);
      if (number.shield) {
        const shieldX = textX - c.measureText(text).width / 2 - 9;
        c.fillStyle = '#bdeaff';
        c.strokeStyle = '#152333';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(shieldX - 5, textY - 7);
        c.lineTo(shieldX + 5, textY - 7);
        c.lineTo(shieldX + 4, textY + 1);
        c.lineTo(shieldX, textY + 6);
        c.lineTo(shieldX - 4, textY + 1);
        c.closePath();
        c.fill();
        c.stroke();
      }
      c.restore();
    }
  }
}
