const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const aggregateHeroRows = (game) => {
  const totals = new Map();
  for (const entry of game.matchSummary()) {
    if (!entry.heroId || entry.isClone || entry.isSummon) continue;
    const key = `${entry.team}:${entry.heroId}`;
    let row = totals.get(key);
    if (!row) {
      row = { ...entry, damageDealt: 0, healingDone: 0, damageTaken: 0, damageReduced: 0, deployments: 0, kills: 0 };
      totals.set(key, row);
    }
    for (const field of ['damageDealt', 'healingDone', 'damageTaken', 'damageReduced', 'deployments', 'kills'])
      row[field] += Number(entry[field]) || 0;
  }
  return [...totals.values()].sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
};

export class MatchSummary {
  constructor() {
    this.root = document.getElementById('matchSummary');
    this.renderedGame = null;
    this.renderedWinner = null;
  }
  render(game) {
    if (game.winner === null) {
      this.root.classList.add('hidden');
      this.renderedGame = game;
      this.renderedWinner = null;
      return;
    }
    if (this.renderedGame === game && this.renderedWinner === game.winner && this.root.querySelector('.download-match-report'))
      return;
    const rows = aggregateHeroRows(game);
    const diagnostics = game.movementDiagnostics || [];
    const diagnosticJson = JSON.stringify(diagnostics, null, 2);
    this.root.innerHTML = `<div class="match-summary-card"><button class="match-summary-close" aria-label="Close">×</button><small>MATCH REPORT</small><h2>${game.teamName(game.winner)} wins</h2><div class="summary-table-wrap"><table><thead><tr><th>Hero</th><th>Team</th><th>Dealt</th><th>Healed</th><th>Taken</th><th>Reduced</th><th>Deploys</th><th>Kills</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="team-${row.team}">${game.teamName(row.team)}</td><td>${Math.round(row.damageDealt)}</td><td>${Math.round(row.healingDone)}</td><td>${Math.round(row.damageTaken)}</td><td>${Math.round(row.damageReduced)}</td><td>${row.deployments}</td><td>${row.kills}</td></tr>`).join('')}</tbody></table></div><div class="match-report-actions"><button type="button" class="download-match-report">Download match report</button><span class="download-report-status" role="status"></span></div><details class="movement-diagnostics"><summary>Movement diagnostics (${diagnostics.length})</summary>${diagnostics.length ? `<pre>${escapeHtml(diagnosticJson)}</pre>` : '<p>No pathfinding or movement exceptions.</p>'}</details></div>`;
    this.root.classList.remove('hidden');
    this.renderedGame = game;
    this.renderedWinner = game.winner;
    this.root.querySelector('.match-summary-close').onclick = () => this.root.classList.add('hidden');
    this.root.querySelector('.download-match-report').onclick = () => {
      const report = {
        winner: game.teamName(game.winner),
        heroSummary: aggregateHeroRows(game),
        movementDiagnostics: diagnostics,
      };
      try {
        const payload = JSON.stringify(report, null, 2);
        const url = window.URL.createObjectURL(new Blob([payload], { type: 'application/json;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'match-report.json';
        link.style.position = 'fixed';
        link.style.left = '-10000px';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
        this.root.querySelector('.download-report-status').textContent = 'Report download started.';
      } catch (error) {
        this.root.querySelector('.download-report-status').textContent = `Download failed: ${error.message}`;
      }
    };
  }
}
