import type { Game, GameMode, Results } from '../game/game';
import { formatTime } from '../game/race';
import { DEFAULT_SETTINGS, loadRecord, type AxisBinding, type Settings } from '../settings';

type Panel = 'menu' | 'pause' | 'settings' | 'help' | 'results' | null;

const MODE_INFO: Record<GameMode, { title: string; desc: string; tag: string }> = {
  race: { title: '竞速赛', desc: '按顺序穿越 13 道门，计时完成多圈比赛', tag: 'RACE' },
  freestyle: { title: '花飞挑战', desc: '120 秒内用翻滚、穿洞、俯冲、贴近飞行刷分', tag: 'FREESTYLE' },
  free: { title: '自由练习', desc: '不限时练习，赛道门可见并记录单圈', tag: 'PRACTICE' },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class Ui {
  private readonly root: HTMLElement;
  private readonly toastEl: HTMLElement;
  private panel: Panel = null;
  private returnTo: Panel = 'menu';
  private settingsTab: 'flight' | 'video' | 'controls' | 'audio' = 'flight';
  private detecting: { channel: keyof Pick<Settings['gamepad'], 'throttle' | 'yaw' | 'pitch' | 'roll'>; base: number[] } | null = null;
  private liveRaf = 0;
  private toastTimer = 0;
  private lastResults: Results | null = null;

  constructor(
    container: HTMLElement,
    private readonly game: Game,
    private settings: Settings,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ui';
    container.appendChild(this.root);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    container.appendChild(this.toastEl);

    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('input', (e) => this.onInput(e));
    this.root.addEventListener('change', (e) => this.onInput(e));
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.panel === 'pause') this.resume();
      else if (this.panel === 'settings' || this.panel === 'help') this.show(this.returnTo);
    });
    window.addEventListener('gamepadconnected', (e) => this.toast(`已连接：${(e as GamepadEvent).gamepad.id.slice(0, 40)}`));
    window.addEventListener('gamepaddisconnected', () => this.toast('手柄/遥控器已断开'));
    this.show('menu');
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }

  showPause(): void {
    this.show('pause');
  }

  showResults(results: Results): void {
    this.lastResults = results;
    this.show('results');
  }

  private resume(): void {
    this.show(null);
    this.game.resume();
  }

  private show(panel: Panel): void {
    this.panel = panel;
    cancelAnimationFrame(this.liveRaf);
    this.detecting = null;
    this.root.classList.toggle('open', panel !== null);
    this.root.innerHTML = panel ? this.render(panel) : '';
    if (panel === 'settings' && this.settingsTab === 'controls') this.liveLoop();
  }

  private render(panel: Exclude<Panel, null>): string {
    switch (panel) {
      case 'menu':
        return this.renderMenu();
      case 'pause':
        return `<div class="card narrow">
          <h2>已暂停</h2>
          <div class="stack">
            <button class="primary" data-act="resume">继续飞行</button>
            <button data-act="restart">重新开始</button>
            <button data-act="settings">设置</button>
            <button data-act="help">操作说明</button>
            <button class="ghost" data-act="menu">返回主菜单</button>
          </div></div>`;
      case 'settings':
        return this.renderSettings();
      case 'help':
        return this.renderHelp();
      case 'results':
        return this.renderResults();
    }
  }

  private renderMenu(): string {
    const lap = loadRecord('best-lap');
    const race = loadRecord(`best-race-${this.settings.laps}`);
    const fs = loadRecord('best-freestyle');
    const pad = this.game.input.connectedGamepad();
    const modes = (Object.keys(MODE_INFO) as GameMode[])
      .map(
        (m) => `<button class="mode-card" data-start="${m}">
          <span class="tag">${MODE_INFO[m].tag}</span>
          <strong>${MODE_INFO[m].title}</strong>
          <span>${MODE_INFO[m].desc}</span></button>`,
      )
      .join('');
    const fm = this.settings.flightMode;
    return `<div class="card menu">
      <div class="brand"><span class="logo">◢◤</span><div><h1>FPV RUSH</h1><p>穿越机模拟飞行 · 竞速 & 花飞</p></div></div>
      <div class="seg" role="group" aria-label="飞行模式">
        <button class="${fm === 'angle' ? 'on' : ''}" data-flight="angle"><strong>自稳 Angle</strong><span>新手：自动回平${this.settings.altitudeAssist ? ' + 定高' : ''}</span></button>
        <button class="${fm === 'acro' ? 'on' : ''}" data-flight="acro"><strong>手动 Acro</strong><span>硬核：角速度控制，可翻滚</span></button>
      </div>
      <div class="modes">${modes}</div>
      <div class="records">
        <div><span>最快单圈</span><b>${formatTime(lap)}</b></div>
        <div><span>${this.settings.laps} 圈总成绩</span><b>${formatTime(race)}</b></div>
        <div><span>花飞最高分</span><b>${fs ?? '—'}</b></div>
      </div>
      <div class="row">
        <button data-act="settings">⚙ 设置</button>
        <button data-act="help">⌨ 操作说明</button>
      </div>
      <p class="device">${pad ? `🎮 ${esc(pad.id.slice(0, 48))}` : '键盘 + 鼠标 · 可连接手柄 / USB 遥控器 · 手机可用触屏摇杆'}</p>
    </div>`;
  }

  private renderHelp(): string {
    return `<div class="card">
      <h2>操作说明</h2>
      <div class="help-grid">
        <section><h3>键盘</h3>
          <table>
            <tr><td><kbd>W</kbd>/<kbd>S</kbd></td><td>油门 加/减（定高模式下为升/降）</td></tr>
            <tr><td><kbd>A</kbd>/<kbd>D</kbd></td><td>偏航 左/右转</td></tr>
            <tr><td><kbd>↑</kbd>/<kbd>↓</kbd> 或 <kbd>I</kbd>/<kbd>K</kbd></td><td>俯仰 前/后</td></tr>
            <tr><td><kbd>←</kbd>/<kbd>→</kbd> 或 <kbd>J</kbd>/<kbd>L</kbd></td><td>横滚 左/右</td></tr>
            <tr><td><kbd>Space</kbd></td><td>满油门（按住）</td></tr>
            <tr><td><kbd>X</kbd></td><td>油门归零（手动油门时）</td></tr>
            <tr><td><kbd>R</kbd></td><td>复位到上一道门</td></tr>
            <tr><td><kbd>M</kbd></td><td>切换 自稳 / 手动 模式</td></tr>
            <tr><td><kbd>C</kbd></td><td>切换视角 FPV / 追尾 / 视距</td></tr>
            <tr><td><kbd>[</kbd>/<kbd>]</kbd></td><td>调整 FPV 相机仰角</td></tr>
            <tr><td><kbd>Esc</kbd>/<kbd>P</kbd></td><td>暂停</td></tr>
          </table>
          <p class="muted">点击画面锁定鼠标后，移动鼠标即可控制横滚/俯仰（松开自动回中）。</p>
        </section>
        <section><h3>手柄 / 遥控器（美国手 Mode 2）</h3>
          <table>
            <tr><td>左摇杆 ↕</td><td>油门</td></tr>
            <tr><td>左摇杆 ↔</td><td>偏航</td></tr>
            <tr><td>右摇杆 ↕</td><td>俯仰</td></tr>
            <tr><td>右摇杆 ↔</td><td>横滚</td></tr>
            <tr><td>A / B / Y / Start</td><td>复位 / 视角 / 模式 / 暂停</td></tr>
          </table>
          <p class="muted">USB 遥控器（EdgeTX / OpenTX 的 Joystick 模式）各通道顺序不同，请到 设置 → 控制 用「检测」自动绑定。</p>
          <h3>飞行模式</h3>
          <p><b>自稳 Angle</b>：摇杆控制倾斜角度，松杆自动回平；开启「定高辅助」后油门回中即悬停。</p>
          <p><b>手动 Acro</b>：摇杆控制旋转角速度，松杆保持当前姿态，需要自己控制油门，是真实穿越机的飞法。</p>
          <h3>花飞得分</h3>
          <p>横滚/空翻 360°、倒飞、俯冲、贴近障碍高速飞行、穿越窗口/桥下/电塔/塔架等。连续动作组成连招倍率，炸机会丢失当前连招。</p>
        </section>
      </div>
      <div class="row end"><button class="primary" data-act="back">返回</button></div>
    </div>`;
  }

  private renderResults(): string {
    const r = this.lastResults;
    if (!r) return '';
    if (r.mode === 'freestyle') {
      return `<div class="card narrow">
        <h2>花飞挑战结束</h2>
        <div class="big">${r.score}<small>分</small></div>
        ${r.newRecordScore ? '<p class="record">🏆 新纪录！</p>' : `<p class="muted">最高分 ${r.recordScore ?? 0}</p>`}
        <p>最佳连招：${r.bestCombo}</p>
        <div class="stack"><button class="primary" data-start="freestyle">再来一次</button><button class="ghost" data-act="menu">主菜单</button></div>
      </div>`;
    }
    const rows = r.laps
      .map((t, i) => `<tr class="${t === r.best ? 'best' : ''}"><td>第 ${i + 1} 圈</td><td>${formatTime(t)}</td></tr>`)
      .join('');
    return `<div class="card narrow">
      <h2>完赛！</h2>
      <div class="big">${formatTime(r.total)}</div>
      ${r.newRecordTotal ? '<p class="record">🏆 总成绩新纪录！</p>' : `<p class="muted">纪录 ${formatTime(r.recordTotal)}</p>`}
      <table class="laps">${rows}</table>
      ${r.newRecordLap ? `<p class="record">⚡ 最快单圈新纪录 ${formatTime(r.best)}</p>` : ''}
      <div class="stack"><button class="primary" data-start="race">再比一场</button><button class="ghost" data-act="menu">主菜单</button></div>
    </div>`;
  }

  private range(path: string, label: string, min: number, max: number, step: number, value: number, unit = ''): string {
    return `<label class="field"><span>${label}</span>
      <input type="range" data-set="${path}" min="${min}" max="${max}" step="${step}" value="${value}">
      <output>${value}${unit}</output></label>`;
  }

  private toggle(path: string, label: string, value: boolean, hint = ''): string {
    return `<label class="field toggle"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span>
      <input type="checkbox" data-set="${path}" ${value ? 'checked' : ''}></label>`;
  }

  private renderSettings(): string {
    const s = this.settings;
    const tabs = [
      ['flight', '飞行'],
      ['video', '画面'],
      ['controls', '控制'],
      ['audio', '声音'],
    ]
      .map(([id, name]) => `<button class="${this.settingsTab === id ? 'on' : ''}" data-tab="${id}">${name}</button>`)
      .join('');
    let body = '';
    if (this.settingsTab === 'flight') {
      body = `
        <label class="field"><span>飞行模式</span>
          <select data-set="flightMode">
            <option value="angle" ${s.flightMode === 'angle' ? 'selected' : ''}>自稳 Angle（新手）</option>
            <option value="acro" ${s.flightMode === 'acro' ? 'selected' : ''}>手动 Acro（硬核）</option>
          </select></label>
        ${this.toggle('altitudeAssist', '定高辅助', s.altitudeAssist, '仅自稳模式：油门回中=悬停')}
        ${this.range('maxAngle', '自稳最大倾角', 25, 80, 1, s.maxAngle, '°')}
        <h3>Acro 速率（Betaflight Actual）</h3>
        ${this.range('rollPitchRates.center', '横滚/俯仰 中心灵敏度', 70, 400, 5, s.rollPitchRates.center, '°/s')}
        ${this.range('rollPitchRates.max', '横滚/俯仰 最大速率', 200, 1200, 10, s.rollPitchRates.max, '°/s')}
        ${this.range('rollPitchRates.expo', '横滚/俯仰 Expo', 0, 1, 0.01, s.rollPitchRates.expo)}
        ${this.range('yawRates.center', '偏航 中心灵敏度', 70, 400, 5, s.yawRates.center, '°/s')}
        ${this.range('yawRates.max', '偏航 最大速率', 150, 1000, 10, s.yawRates.max, '°/s')}
        <h3>机体</h3>
        ${this.range('thrustToWeight', '推重比', 2.5, 10, 0.1, s.thrustToWeight, ':1')}
        ${this.range('crashSpeed', '抗撞强度（撞击速度阈值）', 3, 20, 0.5, s.crashSpeed, ' m/s')}
        ${this.range('laps', '竞速圈数', 1, 10, 1, s.laps, ' 圈')}`;
    } else if (this.settingsTab === 'video') {
      body = `
        ${this.range('cameraTilt', 'FPV 相机仰角', 0, 60, 1, s.cameraTilt, '°')}
        ${this.range('fov', 'FPV 视场角（垂直）', 60, 130, 1, s.fov, '°')}
        <label class="field"><span>画质<small>刷新页面后生效</small></span>
          <select data-set="quality">
            <option value="low" ${s.quality === 'low' ? 'selected' : ''}>低（无阴影）</option>
            <option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>中</option>
            <option value="high" ${s.quality === 'high' ? 'selected' : ''}>高</option>
          </select></label>
        ${this.toggle('showHorizon', 'OSD 人工地平线', s.showHorizon)}
        ${this.toggle('analogEffect', '模拟图传噪点', s.analogEffect, '远离起飞点时雪花增多')}
        <div class="row"><button data-act="reload">刷新以应用画质</button></div>`;
    } else if (this.settingsTab === 'controls') {
      const g = s.gamepad;
      const chan = (key: 'throttle' | 'yaw' | 'pitch' | 'roll', name: string, hint: string) => {
        const b: AxisBinding = g[key];
        return `<div class="chan">
          <span class="cname">${name}</span>
          <select data-set="gamepad.${key}.axis">${Array.from({ length: 8 }, (_, i) => `<option value="${i}" ${b.axis === i ? 'selected' : ''}>轴 ${i}</option>`).join('')}</select>
          <label class="inv"><input type="checkbox" data-set="gamepad.${key}.invert" ${b.invert ? 'checked' : ''}>反向</label>
          <div class="meter"><i data-meter="${key}"></i></div>
          <button class="small" data-detect="${key}" title="${hint}">检测</button>
        </div>`;
      };
      body = `
        <h3>键盘 / 鼠标</h3>
        ${this.range('keyboardStick', '键盘杆量', 0.2, 1, 0.05, s.keyboardStick)}
        ${this.toggle('mouseControl', '鼠标控制横滚/俯仰', s.mouseControl, '点击画面锁定鼠标')}
        ${this.range('mouseSensitivity', '鼠标灵敏度', 0.2, 3, 0.1, s.mouseSensitivity)}
        <h3>手柄 / USB 遥控器</h3>
        <p class="muted" data-pad>${this.padStatus()}</p>
        <div class="axes" data-axes></div>
        ${chan('throttle', '油门', '把油门杆推到最高')}
        ${chan('yaw', '偏航', '把偏航杆推到最右')}
        ${chan('pitch', '俯仰', '把俯仰杆推到最前（向上）')}
        ${chan('roll', '横滚', '把横滚杆推到最右')}
        <p class="muted" data-detect-msg>点击「检测」后，按提示把对应摇杆推到底即可自动绑定轴与方向。</p>
        ${this.range('gamepad.deadzone', '摇杆死区', 0, 0.2, 0.01, g.deadzone)}
        <div class="row"><button data-act="reset-pad">恢复默认手柄映射</button></div>`;
    } else {
      body = `${this.range('volume', '音量', 0, 1, 0.05, s.volume)}`;
    }
    return `<div class="card settings">
      <h2>设置</h2>
      <div class="tabs">${tabs}</div>
      <div class="settings-body">${body}</div>
      <div class="row end">
        <button class="ghost" data-act="defaults">恢复全部默认</button>
        <button class="primary" data-act="back">完成</button>
      </div>
    </div>`;
  }

  private padStatus(): string {
    const pad = this.game.input.connectedGamepad();
    return pad
      ? `已连接：${esc(pad.id)}（${pad.mapping === 'standard' ? '标准映射' : '非标准映射，建议检测'}）`
      : '未检测到设备：连接后按任意键/拨动摇杆以唤醒。';
  }

  private liveLoop(): void {
    const tick = () => {
      if (this.panel !== 'settings' || this.settingsTab !== 'controls') return;
      const pad = this.game.input.connectedGamepad();
      const status = this.root.querySelector('[data-pad]');
      if (status) status.innerHTML = this.padStatus();
      const axesEl = this.root.querySelector('[data-axes]');
      if (axesEl) {
        axesEl.innerHTML = pad
          ? pad.axes
              .slice(0, 8)
              .map((v, i) => `<div class="axis"><span>${i}</span><div class="meter"><i style="left:${((v + 1) / 2) * 100}%"></i></div><em>${v.toFixed(2)}</em></div>`)
              .join('')
          : '';
      }
      const sticks = this.game.input.sticks;
      for (const key of ['throttle', 'yaw', 'pitch', 'roll'] as const) {
        const el = this.root.querySelector<HTMLElement>(`[data-meter="${key}"]`);
        if (!el) continue;
        const v = key === 'throttle' ? sticks.throttle : (sticks[key] + 1) / 2;
        el.style.left = `${v * 100}%`;
      }
      if (pad && this.detecting) {
        const { base, channel } = this.detecting;
        let best = -1;
        let delta = 0;
        pad.axes.forEach((v, i) => {
          const d = v - (base[i] ?? 0);
          if (Math.abs(d) > Math.abs(delta)) {
            delta = d;
            best = i;
          }
        });
        if (best >= 0 && Math.abs(delta) > 0.5) {
          // Pushed up/right should read positive (throttle up, yaw/roll right, pitch forward).
          this.settings.gamepad[channel] = { axis: best, invert: delta < 0 };
          this.detecting = null;
          this.commit();
          this.toast(`已绑定：轴 ${best}${delta < 0 ? '（反向）' : ''}`);
          this.show('settings');
          return;
        }
      }
      this.liveRaf = requestAnimationFrame(tick);
    };
    this.liveRaf = requestAnimationFrame(tick);
  }

  private commit(): void {
    this.game.applySettings(this.settings);
  }

  private onClick(e: Event): void {
    const target = (e.target as HTMLElement).closest('button');
    if (!target) return;
    const { act, start, flight, tab, detect } = target.dataset;
    if (start) {
      this.game.audio.unlock();
      this.show(null);
      this.game.start(start as GameMode);
      return;
    }
    if (flight) {
      this.settings.flightMode = flight as Settings['flightMode'];
      this.commit();
      this.show('menu');
      return;
    }
    if (tab) {
      this.settingsTab = tab as typeof this.settingsTab;
      this.show('settings');
      return;
    }
    if (detect) {
      const pad = this.game.input.connectedGamepad();
      if (!pad) {
        this.toast('请先连接手柄或遥控器');
        return;
      }
      this.detecting = { channel: detect as 'throttle' | 'yaw' | 'pitch' | 'roll', base: [...pad.axes] };
      const msg = this.root.querySelector('[data-detect-msg]');
      if (msg) msg.textContent = `检测中：${target.title}…`;
      return;
    }
    switch (act) {
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.show(null);
        this.game.start(this.game.mode);
        break;
      case 'menu':
        this.game.toMenu();
        this.show('menu');
        break;
      case 'settings':
        this.returnTo = this.panel === 'pause' ? 'pause' : 'menu';
        this.show('settings');
        break;
      case 'help':
        this.returnTo = this.panel === 'pause' ? 'pause' : 'menu';
        this.show('help');
        break;
      case 'back':
        this.show(this.returnTo);
        break;
      case 'reload':
        location.reload();
        break;
      case 'reset-pad':
        this.settings.gamepad = structuredClone(DEFAULT_SETTINGS.gamepad);
        this.commit();
        this.show('settings');
        break;
      case 'defaults':
        Object.assign(this.settings, structuredClone(DEFAULT_SETTINGS));
        this.commit();
        this.show('settings');
        break;
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const path = el.dataset.set;
    if (!path) return;
    let value: unknown;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') value = el.checked;
    else if (el instanceof HTMLInputElement && el.type === 'range') value = Number(el.value);
    else if (path.endsWith('.axis')) value = Number(el.value);
    else value = el.value;
    const keys = path.split('.');
    let obj = this.settings as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
    obj[keys[keys.length - 1]] = value;
    const out = el.parentElement?.querySelector('output');
    if (out && el instanceof HTMLInputElement) {
      const unit = out.textContent?.replace(/^[-\d.]+/, '') ?? '';
      out.textContent = `${el.value}${unit}`;
    }
    this.commit();
  }
}
