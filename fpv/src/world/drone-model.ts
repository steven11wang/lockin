import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';

export interface DroneModel {
  root: Group;
  /** Advance prop spin and blur. */
  animate(dt: number, throttle: number): void;
}

/** A small 5" freestyle quad built from primitives (~22 cm motor to motor). */
export function createDroneModel(shadows: boolean): DroneModel {
  const root = new Group();
  const carbon = new MeshStandardMaterial({ color: '#1b1d22', roughness: 0.55, metalness: 0.3 });
  const motorMat = new MeshStandardMaterial({ color: '#c33b2b', roughness: 0.35, metalness: 0.7 });
  const bell = new MeshStandardMaterial({ color: '#b7bcc4', roughness: 0.3, metalness: 0.9 });
  const battery = new MeshStandardMaterial({ color: '#2b2e35', roughness: 0.6 });
  const label = new MeshStandardMaterial({ color: '#ffcc00', roughness: 0.5 });
  const camMat = new MeshStandardMaterial({ color: '#ff7b1a', roughness: 0.5 });
  const lens = new MeshStandardMaterial({ color: '#050608', roughness: 0.1, metalness: 0.8 });
  const ledFront = new MeshBasicMaterial({ color: '#33ffcc' });
  const ledBack = new MeshBasicMaterial({ color: '#ff2255' });

  const add = (mesh: Mesh) => {
    mesh.castShadow = shadows;
    root.add(mesh);
    return mesh;
  };

  // Arms in an X.
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const arm = add(new Mesh(new BoxGeometry(0.3, 0.008, 0.028), carbon));
    arm.rotation.y = a;
  }
  add(new Mesh(new BoxGeometry(0.06, 0.006, 0.12), carbon)).position.y = -0.002;
  add(new Mesh(new BoxGeometry(0.055, 0.004, 0.11), carbon)).position.y = 0.032;
  // Stand-offs.
  for (const [x, z] of [
    [0.024, 0.05],
    [-0.024, 0.05],
    [0.024, -0.05],
    [-0.024, -0.05],
  ]) {
    add(new Mesh(new CylinderGeometry(0.003, 0.003, 0.034, 6), bell)).position.set(x, 0.015, z);
  }
  const bat = add(new Mesh(new BoxGeometry(0.036, 0.03, 0.075), battery));
  bat.position.set(0, 0.05, 0.005);
  add(new Mesh(new BoxGeometry(0.037, 0.008, 0.02), label)).position.set(0, 0.066, 0.02);

  // FPV camera tilted up.
  const cam = add(new Mesh(new BoxGeometry(0.022, 0.022, 0.02), camMat));
  cam.position.set(0, 0.016, -0.055);
  cam.rotation.x = 0.4;
  const lensMesh = add(new Mesh(new CylinderGeometry(0.007, 0.008, 0.012, 12), lens));
  lensMesh.rotation.x = Math.PI / 2 + 0.4;
  lensMesh.position.set(0, 0.02, -0.068);

  // Antenna.
  const ant = add(new Mesh(new CylinderGeometry(0.002, 0.002, 0.07, 4), carbon));
  ant.position.set(0, 0.05, 0.075);
  ant.rotation.x = -0.6;

  // LEDs.
  add(new Mesh(new BoxGeometry(0.04, 0.004, 0.004), ledFront)).position.set(0, -0.006, -0.062);
  add(new Mesh(new BoxGeometry(0.04, 0.004, 0.004), ledBack)).position.set(0, -0.006, 0.062);

  // Motors and props.
  const props: Mesh[] = [];
  const blurs: Mesh[] = [];
  const bladeMat = new MeshStandardMaterial({ color: '#28c8ff', roughness: 0.4, transparent: true, opacity: 0.95 });
  const blurMat = new MeshBasicMaterial({
    color: '#28c8ff',
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    depthWrite: false,
  });
  const arm = 0.106;
  const motorPos: [number, number, number][] = [
    [arm, 1, -arm],
    [-arm, -1, -arm],
    [arm, -1, arm],
    [-arm, 1, arm],
  ];
  for (const [x, dir, z] of motorPos) {
    const motor = add(new Mesh(new CylinderGeometry(0.014, 0.014, 0.018, 14), motorMat));
    motor.position.set(x, 0.012, z);
    const cap = add(new Mesh(new CylinderGeometry(0.012, 0.014, 0.008, 14), bell));
    cap.position.set(x, 0.025, z);
    const prop = new Mesh(new BoxGeometry(0.125, 0.002, 0.012), bladeMat);
    prop.position.set(x, 0.031, z);
    prop.userData.dir = dir;
    prop.castShadow = shadows;
    root.add(prop);
    props.push(prop);
    const blur = new Mesh(new CircleGeometry(0.064, 24), blurMat);
    blur.rotation.x = -Math.PI / 2;
    blur.position.set(x, 0.032, z);
    blur.visible = false;
    root.add(blur);
    blurs.push(blur);
  }

  return {
    root,
    animate(dt, throttle) {
      const spinning = throttle > 0.01;
      const speed = spinning ? 30 + throttle * 220 : 0;
      for (const p of props) {
        p.rotation.y += speed * dt * (p.userData.dir as number);
        p.visible = speed < 60;
      }
      for (const blurMesh of blurs) blurMesh.visible = speed >= 60;
    },
  };
}
