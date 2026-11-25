import { GAME_PARAMS } from '../data/game_parameters.js';

export class Hud {
  update(game) {
    const player = game.activePlayer();
    document.getElementById('battlefield').style.transform = 'none';
    document.getElementById('elixirValue').textContent = player.elixir;
    document.getElementById('apValue').textContent = player.ap;
    const winnerName = game.winner === 0 ? 'BLUE' : 'RED';
    document.getElementById('turnLabel').textContent = game.winner === null
      ? `${player.team === 0 ? 'BLUE' : 'RED'} TURN`
      : `${winnerName} WINS`;
    document.getElementById('blueScore').textContent = `BLUE ${game.score[0]}`;
    document.getElementById('redScore').textContent = `RED ${game.score[1]}`;
    const gameOver = game.winner !== null;
    document.querySelectorAll('button').forEach((button) => {
      if (button.classList.contains('match-summary-close')) return;
      if (button.disabled !== gameOver) button.disabled = gameOver;
    });
    const squadCount = (team) => game.board.troopsFor(team).filter((troop) =>
      !troop.isSummon && !troop.isMinion && !troop.isDrone && !troop.isClone &&
      !troop.stats.isSummon && !troop.stats.isMinion,
    ).length;
    document.getElementById('troopCount').textContent = `${squadCount(player.team)}/${GAME_PARAMS.teamSize}`;
    document.getElementById('enemyCount').textContent = `${squadCount(1 - player.team)}/${GAME_PARAMS.teamSize}`;
    const a = game.board.troopsFor(player.team).length,
      b = game.board.troopsFor(1 - player.team).length;
    document.getElementById('controlValue').textContent =
      `${Math.round((a / (a + b || 1)) * 100)}%`;
    document.getElementById('heroHandCount').textContent = `${player.heroHand.cards.length}/${GAME_PARAMS.hands.heroCards}`;
    document.getElementById('abilityHandCount').textContent = `${player.abilityHand.cards.length}/${GAME_PARAMS.hands.abilityCards}`;
  }
}
