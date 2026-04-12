import './styles.css';
import { Game } from './game/Game';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app mount point.');
}

const game = new Game(root);
game.start();

window.addEventListener('beforeunload', () => {
  game.destroy();
});
