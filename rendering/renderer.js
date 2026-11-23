import { SPRITES } from './sprites.js';
import { UNIT_ICON_IMAGES } from '../data/unit_icons.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }
  draw(game, hover, selectedMode) {
    const c = this.ctx,
      w = this.canvas.width,
      h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#202a38');
    g.addColorStop(0.5, '#18212c');
    g.addColorStop(1, '#252c30');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#657184';
    c.globalAlpha = 0.14;
    c.lineWidth = 1;
    for (let x = 0; x < w; x += 50) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = 0; y < h; y += 50) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.save();
    for (const patch of game.board.grassPatches) {
      c.fillStyle = patch.team === 0 ? '#70b85a45' : '#8dcc5545';
      c.strokeStyle = patch.team === 0 ? '#9de87988' : '#c2f28e88';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(patch.x, patch.y, patch.radius, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    const river = game.board.river;
    c.fillStyle = '#28779a';
    c.fillRect(river.x, river.y, river.w, river.h);
    c.fillStyle = '#5ec8df55';
    for (let y = river.y + 12; y < river.y + river.h; y += 18)
      c.fillRect(river.x + 8, y, river.w - 16, 3);
    for (const bridge of game.board.bridges) {
      c.fillStyle = '#c79b63';
      c.fillRect(bridge.x, bridge.y, bridge.w, bridge.h);
      c.strokeStyle = '#f1d29c';
      c.lineWidth = 3;
      c.strokeRect(bridge.x + 4, bridge.y + 4, bridge.w - 8, bridge.h - 8);
    }
    for (const structure of [...game.board.turrets, ...game.board.towers]) {
      if (structure.hp <= 0) continue;
      const inhibitionRange = structure.range * 1.2;
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
      if (zone.isRaykaStorm) {
        const pulse = 0.72 + 0.12 * Math.sin((4 - zone.remainingTurns) * Math.PI / 2);
        c.fillStyle = `rgba(41, 153, 223, ${0.17 * pulse})`;
        c.beginPath();
        c.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#ffe27a';
        c.lineWidth = 4;
        c.setLineDash([14, 7]);
        c.beginPath();
        c.arc(zone.x, zone.y, zone.radius - 2, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.strokeStyle = '#75e8ffcc';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(zone.x, zone.y, zone.radius * 0.72, 0, Math.PI * 2);
        c.stroke();
        for (let i = 0; i < 3; i++) {
          const angle = i * Math.PI * 2 / 3 + (4 - zone.remainingTurns) * 0.2;
          const bx = zone.x + Math.cos(angle) * zone.radius * 0.52;
          const by = zone.y + Math.sin(angle) * zone.radius * 0.52;
          c.strokeStyle = '#fff5b0';
          c.lineWidth = 3;
          c.shadowColor = '#65dfff';
          c.shadowBlur = 12;
          c.beginPath();
          c.moveTo(bx + 4, by - 10);
          c.lineTo(bx - 3, by + 1);
          c.lineTo(bx + 3, by + 1);
          c.lineTo(bx - 4, by + 11);
          c.stroke();
        }
        c.shadowBlur = 0;
        c.fillStyle = '#fff3bd';
        c.strokeStyle = '#173447';
        c.lineWidth = 3;
        c.font = 'bold 13px Segoe UI';
        c.textAlign = 'center';
        c.strokeText(`THUNDERSTORM · ${zone.remainingTurns} TURNS`, zone.x, zone.y - zone.radius - 9);
        c.fillText(`THUNDERSTORM · ${zone.remainingTurns} TURNS`, zone.x, zone.y - zone.radius - 9);
        c.restore();
        continue;
      }
      if (zone.isSmokeField) {
        c.fillStyle = 'rgba(147, 157, 171, 0.23)';
        c.beginPath();
        c.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#c4cedaaa';
        c.lineWidth = 3;
        c.setLineDash([10, 7]);
        c.beginPath();
        c.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#eef2f7';
        c.font = 'bold 12px Segoe UI';
        c.textAlign = 'center';
        c.fillText(`SMOKE · ${zone.remainingTurns} TURNS`, zone.x, zone.y - zone.radius - 7);
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
    const color = t.team === 0 ? '#55e1dd' : '#ff6978';
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 22;
    c.fillRect(-36, -36, 72, 72);
    c.fillStyle = '#10141b';
    c.fillRect(-27, -27, 54, 54);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(0, -18);
    c.lineTo(18, 12);
    c.lineTo(-18, 12);
    c.closePath();
    c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#080b10';
    c.fillRect(-38, 40, 76, 7);
    c.fillStyle = color;
    c.fillRect(-38, 40, 76 * Math.max(0, t.hp / t.maxHp), 7);
    c.fillStyle = '#eef3f7';
    c.font = 'bold 11px Segoe UI';
    c.textAlign = 'center';
    c.fillText(t.hp, 0, 56);
    c.restore();
  }
  drawTroop(t) {
    if (t.burrowed) return;
    const c = this.ctx;
    c.save();
    const airborne = t.effects.some((effect) => effect.type === 'airborne');
    c.translate(t.x, t.y - (airborne ? 25 : 0));
    const summoned = t.isSummon || t.isMinion || t.isClone || t.isDrone || t.stats.isSummon || t.stats.isMinion;
    const smallUnit = summoned || t.stats.id === 'ninja';
    c.scale(t.isDrone ? 0.78 : smallUnit ? 0.72 : 1, t.isDrone ? 0.78 : smallUnit ? 0.72 : 1);
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
    if (t.stats.isBuilding) c.rect(-22, -22, 44, 44);
    else c.arc(0, 0, t.isDrone ? 9 : 14, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#171b24';
    c.beginPath();
    if (t.stats.isBuilding) c.rect(-20, -20, 40, 40);
    else c.arc(0, 0, t.isDrone ? 8 : 13, 0, Math.PI * 2);
    c.fill();
    const icon = UNIT_ICON_IMAGES[t.stats.id];
    if (icon?.complete && icon.naturalWidth > 0) {
      c.save();
      c.beginPath();
      if (t.stats.isBuilding) c.rect(-20, -20, 40, 40);
      else c.arc(0, 0, t.isDrone ? 8 : 13, 0, Math.PI * 2);
      c.clip();
      c.drawImage(icon, t.stats.isBuilding ? -20 : -15, t.stats.isBuilding ? -20 : -15,
        t.stats.isBuilding ? 40 : 30, t.stats.isBuilding ? 40 : 30);
      c.restore();
      c.strokeStyle = color;
      c.lineWidth = 0.8;
      c.beginPath();
      if (t.stats.isBuilding) c.rect(-20, -20, 40, 40);
      else c.arc(0, 0, t.isDrone ? 8 : 13, 0, Math.PI * 2);
      c.stroke();
    } else {
      c.fillStyle = color;
      c.font = '900 16px Segoe UI';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(SPRITES[t.stats.id] || '?', 0, 0);
    }
    if (!t.stats.isBuilding) {
      c.save();
      c.rotate(t.facing || 0);
      c.fillStyle = '#f4f6fa';
      c.strokeStyle = '#10141b';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(t.isDrone ? 13 : 19, 0);
      c.lineTo(t.isDrone ? 8 : 12, -5);
      c.lineTo(t.isDrone ? 8 : 12, 5);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
    c.shadowBlur = 0;
    c.fillStyle = '#080b10';
    const barWidth = t.stats.isBuilding ? 52 : t.isDrone ? 26 : 44;
    const barY = t.stats.isBuilding ? 31 : t.isDrone ? 16 : 24;
    c.fillRect(-barWidth / 2, barY, barWidth, 5);
    c.fillStyle = color;
    c.fillRect(-barWidth / 2, barY, barWidth * Math.max(0, t.hp / t.maxHp), 5);
    c.restore();
  }
}
