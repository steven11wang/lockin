# FPV Rush 穿越机

A browser FPV drone (quadcopter) flight game built with Three.js + Vite + TypeScript. It has race and freestyle modes on one combined map, and Angle / Acro flight modes.

## Run

```sh
cd fpv
npm install
npm run dev
```

`npm run check` runs the unit tests and a production build. The GitHub Pages workflow publishes the game at `https://steven11wang.github.io/lockin/fpv/`.

## Modes

- **竞速赛 Race**: fly 13 gates in order. Timing starts at the start gate. Default is 3 laps. The game saves your best lap and best total time in the browser.
- **花飞挑战 Freestyle**: 120 seconds to score points. Rolls and flips, inverted hang time, dives, high-speed proximity, and gaps (bando windows, floor holes, under the bridge, the power lines, the scaffold tower, the container arch, gates) all score. Moves chained together build a combo multiplier, and a crash loses the combo in progress.
- **自由练习 Practice**: no time limit. Gates are shown and single laps are timed.

## Flight model

- Rigid-body quad (+X right, +Y thrust, −Z forward) at 240 Hz. Thrust-to-weight is adjustable, motors spool up with a short lag, drag is quadratic per body axis, and props lose thrust as airspeed through them rises.
- **Acro**: sticks set rotation rates using Betaflight "Actual" rates (center sensitivity, max rate, expo).
- **Angle**: sticks set a tilt angle and the quad levels itself when you let go. Optional **altitude assist**: centered throttle holds altitude, and moving it off center sets a climb or descent rate.
- Collisions use spheres against oriented boxes and cylinders. A hit faster than the crash threshold is a crash, which respawns you at the last gate you passed. Slower hits bounce off.

## Controls

| Input | Action |
| --- | --- |
| W/S | Throttle (with altitude assist: climb/descend) |
| A/D | Yaw |
| ↑↓ / I K | Pitch |
| ←→ / J L | Roll |
| Space / X | Full throttle (hold) / throttle to zero |
| Mouse (click the view to lock) | Roll/pitch, springs back to center |
| R · C · M · [ ] · Esc | Reset · camera (FPV / chase / line-of-sight) · Angle↔Acro · camera tilt · pause |
| Gamepad / USB RC (Mode 2) | Left stick throttle/yaw, right stick pitch/roll; A reset, B camera, Y mode, Start pause |
| Touch | Two on-screen sticks plus buttons |

For USB RC transmitters (EdgeTX/OpenTX joystick mode), open **设置 → 控制** and use **检测** on each channel. It binds the axis and its direction automatically.

## Code map

- `src/sim/`: quad physics and flight controller, rate curves, collision, gate crossing (pure and unit tested)
- `src/game/`: game loop and session flow, race lap timing, freestyle trick scoring
- `src/world/`: procedural map, textures, drone model
- `src/input/`, `src/hud/`, `src/ui/`, `src/audio.ts`: input devices, OSD, menus and settings, synthesized motor sound
