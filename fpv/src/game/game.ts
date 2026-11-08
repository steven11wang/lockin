import {
  ACESFilmicToneMapping,
  Euler,
  MathUtils,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GameAudio } from '../audio';
import { Osd, type OsdState, type ScreenPoint } from '../hud/osd';
import { InputManager } from '../input/input';
import { loadRecord, saveRecord, saveSettings, type Settings } from '../settings';
import type { Contact } from '../sim/collision';
import { crossesPortal, portalDirection } from '../sim/gates';
import { FlightController, Quad, type Sticks } from '../sim/quad';
import { thrustToThrottle } from '../sim/rates';
import { createDroneModel, type DroneModel } from '../world/drone-model';
import { buildWorld, type World } from '../world/world';
import { FreestyleScorer } from './freestyle';
import { formatTime, RaceTracker } from './race';

export type GameMode = 'race' | 'freestyle' | 'free';
type Phase = 'menu' | 'countdown' | 'flying' | 'crashed' | 'finished';
type CameraView = 'fpv' | 'chase' | 'los';

export interface Results {
  mode: GameMode;
  laps: number[];
  total: number;
  best: number | null;
  recordLap: number | null;
  recordTotal: number | null;
  newRecordLap: boolean;
  newRecordTotal: boolean;
  score: number;
  bestCombo: number;
  recordScore: number | null;
  newRecordScore: boolean;
}

export interface GameHooks {
  onPause(): void;
  onFinish(results: Results): void;
  onToast(text: string): void;
}

const PHYSICS_DT = 1 / 240;
const FREESTYLE_TIME = 120;
const CAMERA_LABEL: Record<CameraView, string> = { fpv: 'FPV', chase: '追尾', los: '视距' };

export class Game {
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly world: World;
  readonly input: InputManager;
  readonly audio = new GameAudio();
  private readonly osd: Osd;
  private readonly quad = new Quad();
  private readonly fc = new FlightController();
  private readonly drone: DroneModel;

  mode: GameMode = 'race';
  phase: Phase = 'menu';
  paused = false;
  private view: CameraView = 'fpv';
  private race: RaceTracker | null = null;
  private scorer: FreestyleScorer | null = null;
  private countdown = 0;
  private crashTimer = 0;
  private frozen = false;
  private captureFreeze = false;
  private freezeSticks: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  private flightTime = 0;
  private battery = 1;
  private freestyleLeft = FREESTYLE_TIME;
  private message: { title: string; subtitle?: string; color?: string; until: number } | null = null;
  private hint: string | null = null;
  private time = 0;
  private last = performance.now();
  private accumulator = 0;
  private readonly prevPos = new Vector3();
  private readonly contact: Contact = { normal: new Vector3(), depth: 0, collider: null };
  private proximity = 99;
  private grounded = false;
  private turtleTime = 0;
  private readonly noiseEl: HTMLElement;
  private noiseLevel = 0;
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly tiltQ = new Quaternion();
  private readonly shake = new Euler();
  private readonly chasePos = new Vector3();

  constructor(
    container: HTMLElement,
    private settings: Settings,
    private readonly hooks: GameHooks,
  ) {
    this.renderer = new WebGLRenderer({ antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
    const maxDpr = settings.quality === 'high' ? 2 : settings.quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'gl';
    container.appendChild(this.renderer.domElement);

    const osdCanvas = document.createElement('canvas');
    osdCanvas.className = 'osd';
    container.appendChild(osdCanvas);
    this.osd = new Osd(osdCanvas);

    this.noiseEl = document.createElement('div');
    this.noiseEl.className = 'analog';
    container.appendChild(this.noiseEl);
    const vignette = document.createElement('div');
    vignette.className = 'vignette';
    container.appendChild(vignette);

    this.camera = new PerspectiveCamera(settings.fov, 1, 0.03, 3000);
    this.world = buildWorld(settings.quality);
    this.drone = createDroneModel(settings.quality !== 'low');
    this.world.scene.add(this.drone.root);
    this.world.scene.add(this.camera);

    this.input = new InputManager(this.renderer.domElement, () => this.settings);
    this.input.mountTouch(container);
    this.renderer.domElement.addEventListener('click', () => {
      if (this.phase !== 'menu' && !this.paused) this.input.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      // Leaving pointer lock with Esc pauses the run so the cursor is usable.
      if (!this.input.pointerLocked && this.isRunning() && this.input.source === 'keyboard' && this.settings.mouseControl) {
        this.pause();
      }
    });

    this.quad.reset(this.world.spawn.pos, this.world.spawn.yaw);
    this.applySettings(settings);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.world.highlightGates(null);
    requestAnimationFrame(() => this.frame());
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    this.quad.thrustToWeight = settings.thrustToWeight;
    this.audio.setVolume(settings.volume);
    this.noiseEl.style.display = settings.analogEffect ? '' : 'none';
    this.input.setSpringThrottle(this.springThrottle());
    saveSettings(settings);
  }

  private springThrottle(): boolean {
    return this.settings.flightMode === 'angle' && this.settings.altitudeAssist;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.osd.resize(w, h, window.devicePixelRatio);
  }

  isRunning(): boolean {
    return this.phase !== 'menu' && this.phase !== 'finished' && !this.paused;
  }

  // ---------- Session control ----------

  start(mode: GameMode): void {
    this.audio.unlock();
    this.mode = mode;
    this.paused = false;
    this.race = mode === 'freestyle' ? null : new RaceTracker(this.world.gates.length, mode === 'race' ? this.settings.laps : null);
    this.scorer = mode === 'freestyle' ? new FreestyleScorer() : null;
    this.freestyleLeft = FREESTYLE_TIME;
    this.flightTime = 0;
    this.battery = 1;
    this.frozen = false;
    this.quad.reset(this.world.spawn.pos, this.world.spawn.yaw);
    this.fc.reset();
    this.input.resetThrottle(this.springThrottle());
    this.world.highlightGates(this.race ? 0 : null);
    for (const g of this.world.gates) g.label.visible = this.race !== null;
    if (this.view === 'los' && mode !== 'free') this.view = 'fpv';
    this.phase = 'countdown';
    this.countdown = 3.2;
    this.message = null;
    this.input.requestPointerLock();
  }

  pause(): void {
    if (!this.isRunning()) return;
    this.paused = true;
    this.input.exitPointerLock();
    this.audio.motor(0, 0, false);
    this.hooks.onPause();
  }

  resume(): void {
    this.paused = false;
    this.input.consumeActions();
    this.last = performance.now();
    this.audio.unlock();
    this.input.requestPointerLock();
  }

  toMenu(): void {
    this.phase = 'menu';
    this.paused = false;
    this.input.exitPointerLock();
    this.audio.motor(0, 0, false);
    this.world.highlightGates(null);
    this.quad.reset(this.world.spawn.pos, this.world.spawn.yaw);
  }

  private flash(title: string, subtitle?: string, color?: string, seconds = 1.6): void {
    this.message = { title, subtitle, color, until: this.time + seconds };
  }

  // ---------- Main loop ----------

  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    const sticks = this.input.update(dt);
    this.handleActions();

    if (this.phase === 'menu') {
      this.menuCamera();
      this.world.update(this.time, this.quad.pos);
      this.drone.root.visible = true;
      this.syncDrone(dt);
      this.renderer.render(this.world.scene, this.camera);
      this.osd.draw(null);
      this.noiseLevel = 0;
      this.updateNoise();
      return;
    }

    if (!this.paused && this.phase !== 'finished') this.simulate(dt, sticks);

    this.world.update(this.time, this.quad.pos);
    this.syncDrone(this.paused ? 0 : dt);
    this.updateCamera(dt);
    this.renderer.render(this.world.scene, this.camera);
    this.osd.draw(this.buildOsd());
    this.updateNoise();
    const active = this.isRunning() && this.phase !== 'crashed';
    this.audio.motor(this.quad.throttleOut, this.quad.vel.length(), active);
  }

  private handleActions(): void {
    for (const action of this.input.consumeActions()) {
      if (action === 'pause') {
        if (this.paused) continue; // closing the menu is handled by the UI
        this.pause();
        continue;
      }
      if (!this.isRunning()) continue;
      if (action === 'reset') {
        if (this.phase === 'flying' || this.phase === 'crashed') this.respawn();
      } else if (action === 'camera') {
        const order: CameraView[] = ['fpv', 'chase', 'los'];
        this.view = order[(order.indexOf(this.view) + 1) % order.length];
        this.hooks.onToast(`视角：${CAMERA_LABEL[this.view]}`);
      } else if (action === 'mode') {
        this.settings.flightMode = this.settings.flightMode === 'angle' ? 'acro' : 'angle';
        this.applySettings(this.settings);
        this.hooks.onToast(this.settings.flightMode === 'angle' ? '自稳模式 ANGLE' : '手动模式 ACRO');
      } else if (action === 'tiltUp' || action === 'tiltDown') {
        const d = action === 'tiltUp' ? 5 : -5;
        this.settings.cameraTilt = MathUtils.clamp(this.settings.cameraTilt + d, 0, 60);
        this.applySettings(this.settings);
        this.hooks.onToast(`相机仰角 ${this.settings.cameraTilt}°`);
      }
    }
  }

  private simulate(dt: number, sticks: Sticks): void {
    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0 && after <= 3) this.audio.beep(660, 0.15, 'square', 0.15);
      if (this.countdown <= 0) {
        this.phase = 'flying';
        this.audio.beep(1320, 0.35, 'square', 0.18);
        this.flash('GO!', this.mode === 'race' ? '穿过起点门开始计时' : this.mode === 'freestyle' ? '120 秒，做出你的最佳动作！' : undefined, '#3dff7a', 1.2);
      }
      this.stepPhysics(dt, { throttle: this.springThrottle() ? 0.5 : 0, yaw: 0, pitch: 0, roll: 0 }, false);
      return;
    }

    if (this.phase === 'crashed') {
      this.crashTimer -= dt;
      this.stepPhysics(dt, { throttle: 0, yaw: 0, pitch: 0, roll: 0 }, false);
      if (this.crashTimer <= 0) this.respawn();
      return;
    }

    // Flying.
    if (this.frozen) {
      if (this.captureFreeze) {
        this.freezeSticks = { ...sticks };
        this.captureFreeze = false;
      }
      const f = this.freezeSticks;
      const moved =
        Math.abs(sticks.throttle - f.throttle) > 0.12 ||
        Math.abs(sticks.pitch) > 0.25 ||
        Math.abs(sticks.roll) > 0.25 ||
        Math.abs(sticks.yaw) > 0.25;
      if (!moved) {
        this.race?.tick(dt);
        return;
      }
      this.frozen = false;
      this.hint = null;
    }

    this.flightTime += dt;
    this.race?.tick(dt);
    this.battery = Math.max(0, this.battery - dt * (0.0015 + 0.009 * this.quad.throttleOut));
    this.stepPhysics(dt, sticks, true);

    if (this.scorer) {
      const upY = this.quad.up(this.tmpV).y;
      const events = this.scorer.update({
        dt,
        omega: this.quad.omega,
        altitude: this.quad.pos.y,
        speed: this.quad.vel.length(),
        verticalSpeed: this.quad.vel.y,
        upY,
        proximity: this.proximity,
      });
      if (events.length) this.audio.trick();
      this.freestyleLeft -= dt;
      if (this.freestyleLeft <= 0) this.finishFreestyle();
    }

    // Turtle: resting upside down.
    const upY = this.quad.up(this.tmpV).y;
    if (this.grounded && upY < 0.2 && this.quad.vel.length() < 0.5) this.turtleTime += dt;
    else this.turtleTime = 0;
    if (this.turtleTime > 0.8) this.hint = '翻车了 — 按 R / 手柄 A 复位';
    else if (!this.frozen && this.hint?.startsWith('翻车')) this.hint = null;

    // Out of bounds.
    if (Math.abs(this.quad.pos.x) > 450 || Math.abs(this.quad.pos.z) > 450 || this.quad.pos.y > 300) {
      this.flash('超出范围', '已返回', '#ffcc00');
      this.respawn();
    }
  }

  private stepPhysics(dt: number, sticks: Sticks, live: boolean): void {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < 20) {
      this.accumulator -= PHYSICS_DT;
      steps++;
      const ctrl = this.fc.compute(sticks, this.settings, this.quad, PHYSICS_DT);
      this.prevPos.copy(this.quad.pos);
      this.quad.step(PHYSICS_DT, ctrl.throttle, ctrl.rates);
      this.collide(live);
      if (live && this.phase === 'flying') this.checkPortals();
      if (this.phase !== 'flying' && live) break;
    }
    if (steps >= 20) this.accumulator = 0;
    if (live) this.proximity = this.world.collision.nearest(this.quad.pos, 3);
  }

  private collide(live: boolean): void {
    const q = this.quad;
    this.grounded = false;
    for (let iter = 0; iter < 3; iter++) {
      if (!this.world.collision.contact(q.pos, q.radius, this.contact)) break;
      const n = this.contact.normal;
      q.pos.addScaledVector(n, this.contact.depth);
      const vn = q.vel.dot(n);
      if (n.y > 0.6) this.grounded = true;
      if (vn < 0) {
        const impact = -vn;
        if (live && this.phase === 'flying' && impact > this.settings.crashSpeed) {
          this.crash();
        }
        q.vel.addScaledVector(n, -vn * 1.25);
        // Friction on the tangential part.
        const vnAfter = q.vel.dot(n);
        this.tmpV.copy(n).multiplyScalar(vnAfter);
        q.vel.sub(this.tmpV).multiplyScalar(n.y > 0.6 ? 0.9 : 0.96).add(this.tmpV);
        q.omega.multiplyScalar(0.85);
        if (impact > 2 && live) {
          // Prop strike knocks the craft around a little.
          q.omega.x += (Math.random() - 0.5) * impact * 0.8;
          q.omega.z += (Math.random() - 0.5) * impact * 0.8;
        }
      }
    }
    if (this.grounded && q.throttleOut < 0.05 && q.vel.lengthSq() < 0.5) {
      q.vel.multiplyScalar(0.8);
    }
  }

  private checkPortals(): void {
    const a = this.prevPos;
    const b = this.quad.pos;
    if (this.race) {
      const gate = this.world.gates[this.race.next];
      if (crossesPortal(gate.portal, a, b)) {
        const result = this.race.passGate(gate.index);
        this.world.highlightGates(this.race.finished ? null : this.race.next);
        if (result === 'start') {
          this.audio.gate();
          this.flash('计时开始', undefined, '#3dff7a', 1);
        } else if (result === 'gate') {
          this.audio.gate();
        } else if (result === 'lap' || result === 'finish') {
          this.audio.lap();
          const lapTime = this.race.laps[this.race.laps.length - 1];
          const best = this.race.bestLap === lapTime;
          this.flash(`第 ${this.race.laps.length} 圈 ${formatTime(lapTime)}`, best ? '本场最快圈！' : undefined, best ? '#3dff7a' : '#ffffff', 2);
          if (this.mode === 'free') this.saveLapRecord(lapTime);
          if (result === 'finish') this.finishRace();
        }
      }
      return;
    }
    if (this.scorer) {
      for (const gap of this.world.gaps) {
        if (crossesPortal(gap.portal, a, b)) {
          this.scorer.gap(gap.name);
          this.audio.trick();
        }
      }
      for (const g of this.world.gates) {
        if (crossesPortal(g.portal, a, b) || crossesPortal(g.portal, b, a)) {
          this.scorer.gap(g.index === 0 ? '起点门' : `${g.index} 号门`);
          this.audio.gate();
        }
      }
    }
  }

  private saveLapRecord(lap: number): boolean {
    const prev = loadRecord('best-lap');
    if (prev === null || lap < prev) {
      saveRecord('best-lap', lap);
      return true;
    }
    return false;
  }

  private crash(): void {
    if (this.phase !== 'flying') return;
    this.phase = 'crashed';
    this.crashTimer = 1.3;
    this.audio.crash();
    this.scorer?.crash();
    this.flash('炸机 CRASH', '即将复位…', '#ff4d4d', 1.3);
    this.noiseLevel = 1;
  }

  private respawn(): void {
    const q = this.quad;
    let pos = this.world.spawn.pos.clone();
    let yaw = this.world.spawn.yaw;
    if (this.race && this.race.lastPassed >= 0) {
      const gate = this.world.gates[this.race.lastPassed];
      const dir = portalDirection(gate.portal, new Vector3());
      pos = gate.portal.center.clone().addScaledVector(dir, 2.2);
      pos.y = Math.max(pos.y, 1.2);
      const next = this.world.gates[this.race.next].portal.center;
      yaw = Math.atan2(-(next.x - pos.x), -(next.z - pos.z));
    }
    q.reset(pos, yaw);
    this.fc.reset();
    this.battery = 1;
    this.input.resetThrottle(this.springThrottle(), thrustToThrottle(1 / q.thrustToWeight));
    this.phase = 'flying';
    this.grounded = false;
    this.turtleTime = 0;
    const airborne = pos.y > 0.5;
    this.frozen = airborne;
    if (airborne) {
      // Hover thrust so the craft does not drop the moment it unfreezes.
      q.thrust = q.mass * 9.81;
      this.captureFreeze = true;
      this.hint = '推动摇杆继续飞行';
    } else {
      this.hint = null;
    }
  }

  private finishRace(): void {
    if (!this.race) return;
    const race = this.race;
    const total = race.time;
    const best = race.bestLap;
    const recordLap = loadRecord('best-lap');
    const recordTotal = loadRecord(`best-race-${race.totalLaps}`);
    const newRecordLap = best !== null && (recordLap === null || best < recordLap);
    const newRecordTotal = recordTotal === null || total < recordTotal;
    if (newRecordLap && best !== null) saveRecord('best-lap', best);
    if (newRecordTotal) saveRecord(`best-race-${race.totalLaps}`, total);
    this.phase = 'finished';
    this.input.exitPointerLock();
    this.audio.motor(0, 0, false);
    window.setTimeout(() => {
      this.hooks.onFinish({
        mode: 'race',
        laps: [...race.laps],
        total,
        best,
        recordLap: newRecordLap ? recordLap : recordLap,
        recordTotal,
        newRecordLap,
        newRecordTotal,
        score: 0,
        bestCombo: 0,
        recordScore: null,
        newRecordScore: false,
      });
    }, 900);
  }

  private finishFreestyle(): void {
    const scorer = this.scorer;
    if (!scorer) return;
    scorer.finish();
    const recordScore = loadRecord('best-freestyle');
    const newRecordScore = recordScore === null || scorer.score > recordScore;
    if (newRecordScore) saveRecord('best-freestyle', scorer.score);
    this.phase = 'finished';
    this.input.exitPointerLock();
    this.audio.motor(0, 0, false);
    this.flash('时间到！', `得分 ${scorer.score}`, '#ffcc00', 2);
    window.setTimeout(() => {
      this.hooks.onFinish({
        mode: 'freestyle',
        laps: [],
        total: FREESTYLE_TIME,
        best: null,
        recordLap: null,
        recordTotal: null,
        newRecordLap: false,
        newRecordTotal: false,
        score: scorer.score,
        bestCombo: scorer.bestCombo,
        recordScore,
        newRecordScore,
      });
    }, 900);
  }

  // ---------- Presentation ----------

  private syncDrone(dt: number): void {
    this.drone.root.position.copy(this.quad.pos);
    this.drone.root.quaternion.copy(this.quad.quat);
    const spinning = this.phase !== 'menu' && this.phase !== 'crashed' && !this.frozen;
    this.drone.animate(dt, spinning ? Math.max(0.05, this.quad.throttleOut) : 0);
  }

  private menuCamera(): void {
    const t = this.time * 0.05;
    this.camera.fov = 60;
    this.camera.position.set(Math.cos(t) * 95, 32 + Math.sin(t * 2) * 6, Math.sin(t) * 95 - 20);
    this.camera.lookAt(-10, 4, -30);
    this.camera.updateProjectionMatrix();
  }

  private updateCamera(dt: number): void {
    const q = this.quad;
    const cam = this.camera;
    this.drone.root.visible = this.view !== 'fpv';
    if (this.view === 'fpv') {
      cam.fov = this.settings.fov;
      this.tiltQ.setFromAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(this.settings.cameraTilt));
      cam.position.set(0, 0.03, -0.06).applyQuaternion(q.quat).add(q.pos);
      cam.quaternion.copy(q.quat).multiply(this.tiltQ);
      // Frame vibration from motors and airflow.
      if (this.isRunning() && this.phase === 'flying' && !this.frozen) {
        const amp = 0.0012 + q.throttleOut * 0.0025 + Math.min(0.004, q.vel.length() * 0.00008);
        this.shake.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
        cam.quaternion.multiply(this.tmpQ.setFromEuler(this.shake));
      }
    } else if (this.view === 'chase') {
      cam.fov = 75;
      const heading = q.heading();
      const back = this.tmpV.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(1.9);
      const target = back.add(q.pos).add(new Vector3(0, 0.75, 0));
      const k = 1 - Math.exp(-dt * 7);
      if (this.chasePos.distanceToSquared(target) > 400) this.chasePos.copy(target);
      this.chasePos.lerp(target, k);
      if (this.chasePos.y < 0.3) this.chasePos.y = 0.3;
      cam.position.copy(this.chasePos);
      cam.lookAt(q.pos.x, q.pos.y + 0.2, q.pos.z);
    } else {
      const p = this.world.pilotPosition;
      cam.position.copy(p);
      cam.lookAt(q.pos);
      const dist = p.distanceTo(q.pos);
      cam.fov = MathUtils.clamp(MathUtils.radToDeg(2 * Math.atan(12 / Math.max(1, dist))), 8, 70);
    }
    cam.updateProjectionMatrix();
  }

  private project(p: Vector3): ScreenPoint {
    const v = this.tmpV.copy(p).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = v.z > 0;
    const ndc = p.clone().project(this.camera);
    return { x: ndc.x, y: ndc.y, behind };
  }

  private updateNoise(): void {
    if (!this.settings.analogEffect) return;
    let target = 0.05;
    if (this.phase !== 'menu') {
      const range = this.quad.pos.distanceTo(this.world.pilotPosition);
      target += MathUtils.clamp((range - 220) / 200, 0, 0.6);
      if (this.view !== 'fpv') target = 0.02;
    } else {
      target = 0;
    }
    this.noiseLevel += (target - this.noiseLevel) * 0.08;
    this.noiseEl.style.opacity = this.noiseLevel.toFixed(3);
  }

  private buildOsd(): OsdState | null {
    const q = this.quad;
    const s = this.settings;
    const cam = this.camera;
    cam.updateMatrixWorld();

    let horizon: [ScreenPoint, ScreenPoint] | null = null;
    if (s.showHorizon) {
      const f = cam.getWorldDirection(new Vector3()).setY(0);
      if (f.lengthSq() > 1e-4) {
        f.normalize();
        const right = new Vector3(-f.z, 0, f.x);
        const base = cam.position.clone().addScaledVector(f, 1000);
        base.y = cam.position.y;
        horizon = [this.project(base.clone().addScaledVector(right, -200)), this.project(base.clone().addScaledVector(right, 200))];
      }
    }

    const topLeft: string[] = [];
    const topRight: string[] = [];
    let nextGate: OsdState['nextGate'] = null;
    const race = this.race;
    if (race) {
      const n = this.world.gates.length;
      if (this.mode === 'race') topLeft.push(`LAP ${Math.min(race.currentLap, race.totalLaps ?? 99)}/${race.totalLaps}`);
      else topLeft.push(`LAP ${race.currentLap}`);
      topLeft.push(`GATE ${race.next === 0 ? (race.started ? n : 0) : race.next}/${n}`);
      topLeft.push(this.mode === 'race' ? `TIME ${formatTime(race.time)}` : `LAP ${formatTime(race.currentLapTime)}`);
      if (race.started) topLeft.push(`CUR  ${formatTime(race.currentLapTime)}`);
      topRight.push(`BEST ${formatTime(race.bestLap)}`);
      if (race.laps.length) topRight.push(`LAST ${formatTime(race.laps[race.laps.length - 1])}`);
      topRight.push(`PB   ${formatTime(loadRecord('best-lap'))}`);
      if (!race.finished) {
        const gate = this.world.gates[race.next];
        const p = this.project(gate.portal.center);
        nextGate = { ...p, distance: q.pos.distanceTo(gate.portal.center), label: race.next === 0 ? 'S' : `#${race.next}` };
      }
    }
    if (this.scorer) {
      topLeft.push(`SCORE ${this.scorer.score}`);
      topLeft.push(`TIME  ${formatTime(Math.max(0, this.freestyleLeft)).slice(0, 5)}`);
      topRight.push(`PB ${loadRecord('best-freestyle') ?? 0}`);
    }
    topRight.push(`CAM ${CAMERA_LABEL[this.view]}${this.view === 'fpv' ? ` ${s.cameraTilt}°` : ''}`);

    let center: OsdState['center'] = null;
    if (this.phase === 'countdown') {
      const c = Math.ceil(this.countdown);
      center = { title: c > 3 ? '准备' : String(c), subtitle: s.flightMode === 'angle' ? '自稳模式 ANGLE' : '手动模式 ACRO', color: '#ffcc00' };
    } else if (this.message && this.time < this.message.until) {
      center = { title: this.message.title, subtitle: this.message.subtitle, color: this.message.color };
    }

    const voltage = 14 + 2.8 * this.battery - q.throttleOut * 1.1;
    const scorer = this.scorer;
    return {
      mode: s.flightMode === 'angle' ? 'ANGLE' : 'ACRO',
      assist: s.altitudeAssist,
      throttle: q.throttleOut,
      speed: q.vel.length(),
      altitude: q.pos.y,
      voltage,
      flightTime: this.flightTime,
      horizon,
      topLeft,
      topRight,
      nextGate: this.phase === 'flying' || this.phase === 'countdown' ? nextGate : null,
      center,
      feed: scorer ? scorer.feed : [],
      combo: scorer && scorer.combo > 0 ? `COMBO ${Math.round(scorer.combo)} x${scorer.multiplier}` : null,
      hint: this.hint,
      fpv: this.view === 'fpv',
    };
  }
}
