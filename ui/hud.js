export class Hud {
  update(game) {
    const player = game.activePlayer();
    document.getElementById('battlefield').style.transform = 'none';
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
  }
}
