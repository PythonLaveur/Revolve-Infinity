const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export class MatchSummary {
  constructor() { this.root = document.getElementById('matchSummary'); }
  render(game) {
    if (game.winner === null) {
      this.root.classList.add('hidden');
      return;
    }
    const rows = game.matchSummary()
      .filter((entry) => entry.heroId && !entry.isClone && !entry.isSummon)
      .sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
    const diagnostics = game.movementDiagnostics || [];
    this.root.innerHTML = `<div class="match-summary-card"><button class="match-summary-close" aria-label="Close">×</button><small>MATCH REPORT</small><h2>${game.teamName(game.winner)} wins</h2><div class="summary-table-wrap"><table><thead><tr><th>Hero</th><th>Team</th><th>Dealt</th><th>Healed</th><th>Taken</th><th>Reduced</th><th>Deploys</th><th>Kills</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="team-${row.team}">${game.teamName(row.team)}</td><td>${Math.round(row.damageDealt)}</td><td>${Math.round(row.healingDone)}</td><td>${Math.round(row.damageTaken)}</td><td>${Math.round(row.damageReduced)}</td><td>${row.deployments}</td><td>${row.kills}</td></tr>`).join('')}</tbody></table></div><section class="movement-diagnostics"><h3>Movement diagnostics (${diagnostics.length})</h3>${diagnostics.length ? `<ul>${diagnostics.map((item) => `<li>[${escapeHtml(item.type)}] ${escapeHtml(item.unit)}${item.target ? ` → ${escapeHtml(item.target)}` : ''}${item.error ? ` — ${escapeHtml(item.error)}` : ''}</li>`).join('')}</ul>` : '<p>No pathfinding or movement exceptions.</p>'}</section><button class="download-match-report">Download match report</button></div>`;
    this.root.classList.remove('hidden');
    this.root.querySelector('.match-summary-close').onclick = () => this.root.classList.add('hidden');
    this.root.querySelector('.download-match-report').onclick = () => {
      const report = {
        winner: game.teamName(game.winner),
        heroSummary: game.matchSummary().filter((entry) => entry.heroId && !entry.isClone && !entry.isSummon),
        movementDiagnostics: diagnostics,
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'match-report.json';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  }
}
