import './style.css';
import { Game } from './game/game';
import { loadSettings } from './settings';
import { Ui } from './ui/ui';

const container = document.getElementById('app');
if (!container) throw new Error('#app missing');

const settings = loadSettings();
let ui: Ui | null = null;

try {
  const game = new Game(container, settings, {
    onPause: () => ui?.showPause(),
    onFinish: (results) => ui?.showResults(results),
    onToast: (text) => ui?.toast(text),
  });
  ui = new Ui(container, game, settings);
  // Expose for debugging and automated checks.
  (window as unknown as { fpv: Game }).fpv = game;
} catch (err) {
  console.error(err);
  container.innerHTML = `<div class="fatal"><h1>无法启动 3D 渲染</h1><p>请使用支持 WebGL 的现代浏览器（Chrome / Edge / Safari / Firefox）。</p></div>`;
}
