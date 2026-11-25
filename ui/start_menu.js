export class StartMenu {
  constructor(root, { onAllRandom, onDraft }) {
    this.root = root;
    this.root.querySelector('#startAllRandom').addEventListener('click', onAllRandom);
    this.root.querySelector('#startDraft').addEventListener('click', onDraft);
  }
  render(game) {
    const visible = game.phase === 'menu' || game.phase === 'loading';
    this.root.classList.toggle('hidden', !visible);
    this.root.querySelector('.start-menu-options').classList.toggle('hidden', game.phase !== 'menu');
    this.root.querySelector('.start-menu-loading').classList.toggle('hidden', game.phase !== 'loading');
    if (game.phase === 'loading') {
      const { loaded, total } = game.loadingProgress || { loaded: 0, total: 0 };
      const percent = total ? Math.round((loaded / total) * 100) : 100;
      const bar = this.root.querySelector('.start-loading-progress i');
      bar.style.width = `${percent}%`;
      this.root.querySelector('.start-loading-count').textContent = `${loaded} / ${total} heroes loaded`;
      this.root.querySelector('.start-loading-progress').setAttribute('aria-valuenow', String(percent));
    }
  }
}
