
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// ==================================================
// JUNGLE ESCAPE V13
// ==================================================

const $ = id => document.getElementById(id);

const LANES = [-2.2, 0, 2.2];
const ROAD_HALF_WIDTH = 3.65;

const DEMON_START = 30;
const CHASE_DURATION = 30;
const REST_DURATION = 30;

const WORLD_LENGTH = 230;
const RECYCLE_Z = 20;

const CHARACTER_FILES = [
  "./assets/characters/explorer1.glb",
  "./assets/characters/explorer2.glb",
  "./assets/characters/explorer3.glb"
];

const DEMON_FILE = "./assets/creatures/demon.glb";

const ENVIRONMENT_FOLDER = "./assets/environment/";

const loader = new GLTFLoader();
const clock = new THREE.Clock();

// ==================================================
// THREE.JS SETUP
// ==================================================

const scene = new THREE.Scene();

scene.background = new THREE.Color(0x91ad8c);
scene.fog = new THREE.Fog(0x91ad8c, 30, 150);

const camera = new THREE.PerspectiveCamera(
  65,
  innerWidth / innerHeight,
  0.1,
  350
);

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

$("game").prepend(renderer.domElement);

scene.add(
  new THREE.HemisphereLight(0xe6f5ff, 0x344526, 2)
);

const sunlight = new THREE.DirectionalLight(0xffedc4, 2.3);
sunlight.position.set(-12, 22, 10);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
scene.add(sunlight);

// ==================================================
// MATERIALS
// ==================================================

const makeMaterial = (color, roughness = 1) =>
  new THREE.MeshStandardMaterial({ color, roughness });

const M = {
  ground: makeMaterial(0x526d37),
  path: makeMaterial(0x806747),
  stone: makeMaterial(0x77786c),
  trunk: makeMaterial(0x62452c),
  leaves: makeMaterial(0x24572d),
  dark: makeMaterial(0x211923),
  gold: new THREE.MeshStandardMaterial({
    color: 0xffd43b,
    metalness: 0.65,
    roughness: 0.2
  })
};

// ==================================================
// GAME STATE
// ==================================================

const player = new THREE.Group();
scene.add(player);

const characterHolders = [];
const characterMixers = [];
const fallbackAnimations = [];

const trees = [];
const obstacles = [];
const coins = [];
const powerups = [];

// All moving GLB environment objects are stored here.
const movingEnvironment = [];

const jungleAssets = {
  trees: [],
  mushrooms: [],
  lavaRocks: [],
  logs: [],
  arches: [],
  statues: []
};

let selectedCharacter = 0;
let demon = null;
let demonMixer = null;

let running = false;
let paused = false;

let elapsed = 0;
let score = 0;
let coinCount = 0;

let best = Number(
  localStorage.getItem("jungleEscapeV13Best") || 0
);

let lane = 1;
let jumping = false;
let jumpSpeed = 0;
let slideTime = 0;

let shieldTime = 0;
let magnetTime = 0;

let obstacleTimer = 1;
let coinTimer = 1;
let powerTimer = 10;

let demonChasing = false;
let previousChaseState = false;
let demonDistance = 14;

let messageTimer = 0;

// ==================================================
// CAMERA
// ==================================================

const cameraModes = [
  {
    name: "FOLLOW",
    offset: new THREE.Vector3(0, 5.3, 10.5),
    target: new THREE.Vector3(0, 1.2, -9)
  },
  {
    name: "SIDE",
    offset: new THREE.Vector3(8, 4.5, 7),
    target: new THREE.Vector3(0, 1.2, -8)
  },
  {
    name: "HIGH",
    offset: new THREE.Vector3(0, 12, 5),
    target: new THREE.Vector3(0, 0, -12)
  }
];

let cameraMode = 0;

function changeCamera() {
  cameraMode = (cameraMode + 1) % cameraModes.length;

  $("camera-button").textContent =
    "CAMERA: " + cameraModes[cameraMode].name;
}

function updateCamera(dt) {
  const mode = cameraModes[cameraMode];

  const desiredPosition = mode.offset.clone();
  desiredPosition.x += player.position.x;

  const desiredTarget = mode.target.clone();
  desiredTarget.x += player.position.x * 0.45;

  camera.position.lerp(
    desiredPosition,
    1 - Math.exp(-3.5 * dt)
  );

  camera.lookAt(desiredTarget);
}

// ==================================================
// HELPERS
// ==================================================

function addBox(parent, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material
  );

  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);

  return mesh;
}

function showMessage(text, seconds = 3) {
  $("message").textContent = text;
  $("message").classList.remove("hidden");
  messageTimer = seconds;
}

function fitModel(model, targetHeight) {
  model.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();

  bounds.getSize(size);

  if (!Number.isFinite(size.y) || size.y <= 0) {
    throw new Error("Invalid model dimensions");
  }

  model.scale.multiplyScalar(targetHeight / size.y);
  model.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(model);
  model.position.y -= fitted.min.y;

  model.traverse(object => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

// ==================================================
// ENVIRONMENT MODEL LOADER
// ==================================================

function loadJungleAsset(filename) {
  return new Promise((resolve, reject) => {
    loader.load(
      ENVIRONMENT_FOLDER + filename,
      gltf => resolve(gltf.scene),
      undefined,
      error => reject(error)
    );
  });
}

function registerMovingEnvironment(
  object,
  category,
  initialZ
) {
  movingEnvironment.push({
    object,
    category,
    initialZ
  });
}

function addJungleInstance(
  template,
  position,
  height,
  rotation = 0,
  category = "decoration"
) {
  const instance = template.clone(true);

  fitModel(instance, height);

  instance.position.set(
    position.x,
    position.y ?? 0,
    position.z
  );

  instance.rotation.y = rotation;

  scene.add(instance);

  registerMovingEnvironment(
    instance,
    category,
    position.z
  );

  return instance;
}

// ==================================================
// JUNGLE TREES
// ==================================================

function placeJungleTrees(template) {
  // One tree on each side at regular intervals.
  for (let z = 10; z >= -200; z -= 12) {
    for (const side of [-1, 1]) {
      const x = side * (8 + Math.random() * 3);

      const tree = addJungleInstance(
        template,
        {
          x,
          z: z - Math.random() * 3
        },
        9 + Math.random() * 4,
        Math.random() * Math.PI * 2,
        "tree"
      );

      jungleAssets.trees.push(tree);
    }
  }
}

// ==================================================
// GLOWING MUSHROOMS
// ==================================================

function placeGlowingMushrooms(template) {
  // Individual mushrooms, never in the middle of the road.
  for (let z = 8; z >= -200; z -= 5) {
    for (const side of [-1, 1]) {
      const mushroom = addJungleInstance(
        template,
        {
          x: side * (4.8 + Math.random() * 1.5),
          z: z - Math.random() * 2
        },
        0.8 + Math.random() * 0.6,
        Math.random() * Math.PI * 2,
        "mushroom"
      );

      jungleAssets.mushrooms.push(mushroom);
    }
  }
}

// ==================================================
// LAVA ROCKS
// ==================================================

function placeLavaRocks(template) {
  for (let z = 5; z >= -200; z -= 9) {
    for (const side of [-1, 1]) {
      const rock = addJungleInstance(
        template,
        {
          x: side * (6 + Math.random() * 2),
          z: z - Math.random() * 3
        },
        1.5 + Math.random() * 1.5,
        Math.random() * Math.PI * 2,
        "rock"
      );

      jungleAssets.lavaRocks.push(rock);
    }
  }
}

// ==================================================
// FALLEN LOGS
// ==================================================

function placeDecorativeLogs(template) {
  for (let z = -10; z >= -200; z -= 18) {
    const side = Math.random() < 0.5 ? -1 : 1;

    const log = addJungleInstance(
      template,
      {
        x: side * (6 + Math.random() * 1.5),
        z
      },
      1.3,
      Math.random() * Math.PI,
      "log"
    );

    jungleAssets.logs.push(log);
  }
}

// ==================================================
// ROCK ARCHES
// ==================================================

function placeRockArches(template) {
  // These arches intentionally cross over the road.
  for (const z of [-55, -155]) {
    const arch = template.clone(true);

    arch.updateMatrixWorld(true);

    const initialBounds = new THREE.Box3().setFromObject(arch);
    const size = new THREE.Vector3();

    initialBounds.getSize(size);

    if (size.x <= 0 || size.y <= 0) {
      console.warn("Rock arch has invalid dimensions.");
      continue;
    }

    arch.scale.multiplyScalar(11 / size.x);
    arch.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(arch);

    arch.position.x -= (bounds.min.x + bounds.max.x) / 2;
    arch.position.y -= bounds.min.y;
    arch.position.z -= (bounds.min.z + bounds.max.z) / 2;

    arch.position.z = z;

    arch.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    scene.add(arch);

    registerMovingEnvironment(
      arch,
      "arch",
      z
    );

    jungleAssets.arches.push(arch);
  }
}

// ==================================================
// DRAGON STATUES
// ==================================================

function placeDragonStatues(template) {
  for (let z = -20; z >= -200; z -= 45) {
    for (const side of [-1, 1]) {
      const statue = addJungleInstance(
        template,
        {
          x: side * 6.5,
          z
        },
        3.5,
        side === -1 ? 0 : Math.PI,
        "statue"
      );

      jungleAssets.statues.push(statue);
    }
  }
}

// ==================================================
// LOAD REALISTIC JUNGLE
// ==================================================

async function loadRealisticJungle() {
  const assets = [
    ["jungle_tree.glb", placeJungleTrees],
    ["glowing_mashrooms.glb", placeGlowingMushrooms],
    ["lava_rock.glb", placeLavaRocks],
    ["fallen_log.glb", placeDecorativeLogs],
    ["rock_arch.glb", placeRockArches],
    ["dragon_statue.glb", placeDragonStatues]
  ];

  for (const [filename, placeFunction] of assets) {
    try {
      const model = await loadJungleAsset(filename);

      placeFunction(model);

      console.log("Loaded jungle asset:", filename);
    } catch (error) {
      console.warn(
        "Could not load jungle asset:",
        filename,
        error
      );
    }
  }

  $("loading-status").textContent =
    "Jungle environment loaded!";

  console.log("V13 jungle environment ready.");
}

// ==================================================
// MOVE AND RECYCLE ENVIRONMENT
// ==================================================

function updateMovingEnvironment(speed, dt) {
  for (const item of movingEnvironment) {
    const object = item.object;

    object.position.z += speed * dt;

    if (object.position.z > RECYCLE_Z) {
      object.position.z -= WORLD_LENGTH;

      // Slightly vary the next position for a natural layout.
      if (item.category === "mushroom") {
        object.position.x =
          Math.sign(object.position.x) *
          (4.8 + Math.random() * 1.5);
      }

      if (item.category === "rock") {
        object.position.x =
          Math.sign(object.position.x) *
          (6 + Math.random() * 2);
      }

      if (item.category === "tree") {
        object.position.x =
          Math.sign(object.position.x) *
          (8 + Math.random() * 3);
      }
    }
  }
}

// ==================================================
// FALLBACK CHARACTER
// ==================================================

function createFallbackExplorer(index) {
  const group = new THREE.Group();

  const shirtColors = [
    0x287ca6,
    0x9c4e38,
    0x4c8243
  ];

  const skin = makeMaterial(0xd4a17d);
  const shirt = makeMaterial(shirtColors[index]);
  const pants = makeMaterial(0x303b46);
  const boots = makeMaterial(0x29231e);
  const backpack = makeMaterial(0x493a25);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 14),
    skin
  );

  head.position.y = 1.85;
  group.add(head);

  const eyeMaterial = makeMaterial(0x211a16);

  for (const x of [-0.095, 0.095]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      eyeMaterial
    );

    eye.position.set(x, 1.9, 0.245);
    group.add(eye);
  }

  addBox(group, 0.62, 0.8, 0.36, shirt, 0, 1.2, 0);
  addBox(group, 0.42, 0.5, 0.22, backpack, 0, 1.3, -0.25);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.38, 1.52, 0);
  group.add(leftArm);

  addBox(leftArm, 0.19, 0.72, 0.2, skin, 0, -0.33, 0);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.38, 1.52, 0);
  group.add(rightArm);

  addBox(rightArm, 0.19, 0.72, 0.2, skin, 0, -0.33, 0);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.17, 0.82, 0);
  group.add(leftLeg);

  addBox(leftLeg, 0.23, 0.76, 0.25, pants, 0, -0.37, 0);
  addBox(leftLeg, 0.25, 0.17, 0.38, boots, 0, -0.77, 0.06);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.17, 0.82, 0);
  group.add(rightLeg);

  addBox(rightLeg, 0.23, 0.76, 0.25, pants, 0, -0.37, 0);
  addBox(rightLeg, 0.25, 0.17, 0.38, boots, 0, -0.77, 0.06);

  return {
    group,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg
  };
}

function loadCharacters() {
  for (let i = 0; i < 3; i++) {
    const holder = new THREE.Group();

    holder.rotation.y = Math.PI;

    const fallback = createFallbackExplorer(i);
    fallback.group.scale.setScalar(1.25);

    holder.add(fallback.group);
    holder.visible = i === selectedCharacter;

    player.add(holder);

    characterHolders.push(holder);
    characterMixers.push(null);
    fallbackAnimations.push(fallback);
  }

  $("start-button").disabled = false;

  $("loading-status").textContent =
    "Built-in explorers ready!";

  CHARACTER_FILES.forEach((file, index) => {
    loader.load(
      file,
      gltf => {
        try {
          const model = gltf.scene;

          fitModel(model, 2.5);

          const holder = characterHolders[index];

          holder.clear();
          holder.add(model);
          holder.rotation.y = Math.PI;

          if (gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);

            const runClip =
              THREE.AnimationClip.findByName(gltf.animations, "Run") ||
              THREE.AnimationClip.findByName(gltf.animations, "run") ||
              gltf.animations[0];

            mixer.clipAction(runClip).play();
            characterMixers[index] = mixer;
          }

          updateCharacterSelection();

          $("loading-status").textContent =
            "Custom explorers loaded!";
        } catch (error) {
          console.warn("Explorer model error:", error);
        }
      },
      undefined,
      () => {
        console.info("Using fallback explorer:", index + 1);
      }
    );
  });
}

function updateCharacterSelection() {
  characterHolders.forEach((holder, index) => {
    holder.visible = index === selectedCharacter;
  });

  document.querySelectorAll(".character-button").forEach(button => {
    button.classList.toggle(
      "selected",
      Number(button.dataset.character) === selectedCharacter
    );
  });
}

function chooseCharacter(index) {
  if (running) return;

  selectedCharacter = THREE.MathUtils.clamp(index, 0, 2);
  updateCharacterSelection();
}

function animateFallbackCharacter(time) {
  const animation = fallbackAnimations[selectedCharacter];

  if (!animation) return;

  const {
    leftArm,
    rightArm,
    leftLeg,
    rightLeg
  } = animation;

  if (jumping) {
    leftArm.rotation.x = -1;
    rightArm.rotation.x = -1;
    leftLeg.rotation.x = 0.45;
    rightLeg.rotation.x = -0.45;
    return;
  }

  if (slideTime > 0) {
    leftArm.rotation.x = 0.5;
    rightArm.rotation.x = 0.5;
    leftLeg.rotation.x = 0.15;
    rightLeg.rotation.x = 0.15;
    return;
  }

  const swing = Math.sin(time * 11) * 0.7;

  leftArm.rotation.x = swing;
  rightArm.rotation.x = -swing;
  leftLeg.rotation.x = -swing;
  rightLeg.rotation.x = swing;
}

// ==================================================
// BASIC JUNGLE ENVIRONMENT
// ==================================================

function createTree(x, z, scale = 1) {
  const tree = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.34, 3, 9),
    M.trunk
  );

  trunk.position.y = 1.5;
  trunk.castShadow = true;
  tree.add(trunk);

  for (let i = 0; i < 5; i++) {
    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(0.95 - i * 0.08, 12, 9),
      M.leaves
    );

    leaves.position.set(
      i % 2 === 0 ? -0.4 : 0.4,
      2.5 + (i % 3) * 0.35,
      (i - 2) * 0.13
    );

    leaves.castShadow = true;
    tree.add(leaves);
  }

  tree.scale.setScalar(scale);
  tree.position.set(x, 0, z);

  scene.add(tree);
  trees.push(tree);
}

function createEnvironment() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 320),
    M.ground
  );

  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.13, -110);
  ground.receiveShadow = true;
  scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(7.3, 320),
    M.path
  );

  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.07, -110);
  road.receiveShadow = true;
  scene.add(road);

  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x318eaa,
    roughness: 0.2,
    metalness: 0.1
  });

  for (const x of [-12, 12]) {
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 320),
      waterMaterial
    );

    river.rotation.x = -Math.PI / 2;
    river.position.set(x, -0.04, -110);
    scene.add(river);
  }

  const mountainMaterial = makeMaterial(0x455e48);

  for (let i = 0; i < 18; i++) {
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(
        8 + Math.random() * 5,
        18 + Math.random() * 8,
        7
      ),
      mountainMaterial
    );

    mountain.position.set(
      (i - 9) * 13,
      4,
      -115 - Math.random() * 25
    );

    scene.add(mountain);
  }

  // Temple entrance
  const templeMaterial = makeMaterial(0x817967);

  const leftPillar = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 8, 1.8),
    templeMaterial
  );

  leftPillar.position.set(-5.4, 4, -105);
  leftPillar.castShadow = true;
  scene.add(leftPillar);

  const rightPillar = leftPillar.clone();
  rightPillar.position.x = 5.4;
  scene.add(rightPillar);

  const templeTop = new THREE.Mesh(
    new THREE.BoxGeometry(12.2, 1.3, 2),
    templeMaterial
  );

  templeTop.position.set(0, 8.2, -105);
  templeTop.castShadow = true;
  scene.add(templeTop);

  // Waterfall
  const waterfall = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 9),
    new THREE.MeshStandardMaterial({
      color: 0x9be5ed,
      transparent: true,
      opacity: 0.8
    })
  );

  waterfall.position.set(0, 4.5, -125);
  scene.add(waterfall);

  // Fallback trees only.
  // These move if the custom tree model fails to load.
  for (let i = 0; i < 65; i++) {
    const z = 12 - i * 4;

    createTree(
      -8 - Math.random() * 3,
      z,
      0.8 + Math.random() * 0.8
    );

    createTree(
      8 + Math.random() * 3,
      z - 2,
      0.8 + Math.random() * 0.8
    );
  }
}

// ==================================================
// FALLBACK TREE MOVEMENT
// ==================================================

function updateFallbackTrees(speed, dt) {
  for (const tree of trees) {
    tree.position.z += speed * dt;

    if (tree.position.z > RECYCLE_Z) {
      tree.position.z -= WORLD_LENGTH;
    }
  }
}

// ==================================================
// OBSTACLES
// ==================================================

function spawnObstacle(forceLane = null) {
  const laneIndex =
    forceLane === null
      ? Math.floor(Math.random() * 3)
      : forceLane;

  const group = new THREE.Group();
  const isLog = Math.random() < 0.5;

  if (isLog) {
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 2.4, 10),
      M.trunk
    );

    log.rotation.z = Math.PI / 2;
    log.position.y = 0.4;
    log.castShadow = true;
    group.add(log);
  } else {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.8, 1),
      M.stone
    );

    rock.scale.set(1.2, 0.9, 0.9);
    rock.position.y = 0.65;
    rock.castShadow = true;
    group.add(rock);
  }

  group.position.set(LANES[laneIndex], 0, -90);
  scene.add(group);

  obstacles.push({
    mesh: group,
    lane: laneIndex,
    kind: isLog ? "log" : "rock"
  });
}

// ==================================================
// COINS
// ==================================================

function spawnCoin() {
  const laneIndex = Math.floor(Math.random() * 3);

  const coin = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.11, 10, 20),
    M.gold
  );

  coin.position.set(LANES[laneIndex], 1.25, -85);
  coin.rotation.x = Math.PI / 2;
  coin.castShadow = true;

  scene.add(coin);
  coins.push({ mesh: coin, lane: laneIndex });
}

// ==================================================
// POWER-UPS
// ==================================================

function spawnPowerup() {
  const laneIndex = Math.floor(Math.random() * 3);
  const type = Math.random() < 0.5 ? "shield" : "magnet";

  const color = type === "shield" ? 0x55cfff : 0xd35cff;

  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.43, 1),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5
    })
  );

  orb.position.set(LANES[laneIndex], 1.3, -85);

  scene.add(orb);
  powerups.push({ mesh: orb, lane: laneIndex, type });
}

// ==================================================
// DEMON
// ==================================================

function createFallbackDemon() {
  const group = new THREE.Group();

  const dark = M.dark;

  const redEye = new THREE.MeshStandardMaterial({
    color: 0xff2018,
    emissive: 0xff0000,
    emissiveIntensity: 2
  });

  addBox(group, 1.05, 1.45, 0.55, dark, 0, 1.1, 0);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 18, 14),
    dark
  );

  head.position.y = 2.05;
  group.add(head);

  // Face points towards the player (-Z).
  for (const x of [-0.19, 0.19]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      redEye
    );

    eye.position.set(x, 2.1, -0.42);
    group.add(eye);

    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.7, 8),
      dark
    );

    horn.position.set(x * 1.8, 2.55, 0);
    group.add(horn);
  }

  addBox(group, 0.25, 0.85, 0.25, dark, -0.65, 0.35, 0);
  addBox(group, 0.25, 0.85, 0.25, dark, 0.65, 0.35, 0);

  group.scale.setScalar(1.1);
  group.position.set(0, 0, 14);

  scene.add(group);

  return group;
}

function loadDemon() {
  demon = createFallbackDemon();
  demon.visible = false;

  loader.load(
    DEMON_FILE,
    gltf => {
      try {
        const model = gltf.scene;

        fitModel(model, 3.2);

        model.position.set(0, 0, 14);
        model.visible = false;

        // Adjust this rotation if your imported demon faces
        // the opposite direction.
        model.rotation.y = 0;

        scene.remove(demon);

        demon = model;
        scene.add(demon);

        if (gltf.animations.length > 0) {
          demonMixer = new THREE.AnimationMixer(model);
          demonMixer.clipAction(gltf.animations[0]).play();
        }

        console.info("Custom demon loaded.");
      } catch (error) {
        console.warn("Demon model error:", error);
      }
    },
    undefined,
    () => {
      console.info("Using built-in demon.");
    }
  );
}

// ==================================================
// DEMON CHASE SYSTEM - V13
// ==================================================

function updateDemon(dt) {
  if (!demon || elapsed < DEMON_START) return;

  const cycleLength = CHASE_DURATION + REST_DURATION;

  const cycleTime =
    (elapsed - DEMON_START) % cycleLength;

  const currentChaseState = cycleTime < CHASE_DURATION;

  // Start a new chase.
  if (currentChaseState && !previousChaseState) {
    demonChasing = true;
    demon.visible = true;

    // Start further behind the player.
    demonDistance = 14;

    demon.position.set(
      player.position.x,
      0,
      demonDistance
    );

    showMessage("THE DEMON IS CHASING YOU!", 4);
  }

  // Chase ends.
  if (!currentChaseState && previousChaseState) {
    demonChasing = false;
    demon.visible = false;

    showMessage("YOU ESCAPED THE DEMON!", 3);
  }

  if (demonChasing) {
    demon.visible = true;

    // Follow the player's lane.
    demon.position.x = THREE.MathUtils.damp(
      demon.position.x,
      player.position.x,
      4.5,
      dt
    );

    // The demon visibly closes the distance.
    // It starts 14 units behind and approaches to 3.2.
    demonDistance = Math.max(
      3.2,
      demonDistance - 2.8 * dt
    );

    demon.position.z = demonDistance;

    // Running bounce animation.
    demon.position.y =
      Math.abs(Math.sin(elapsed * 8)) * 0.16;

    // Slight side-to-side running movement.
    demon.position.x += Math.sin(elapsed * 5) * 0.025;
  }

  previousChaseState = currentChaseState;

  if (demonMixer && demonChasing) {
    demonMixer.update(dt);
  }
}

// ==================================================
// RESET
// ==================================================

function clearMovingObjects() {
  for (const item of obstacles) scene.remove(item.mesh);
  for (const item of coins) scene.remove(item.mesh);
  for (const item of powerups) scene.remove(item.mesh);

  obstacles.length = 0;
  coins.length = 0;
  powerups.length = 0;
}

function resetGame() {
  clearMovingObjects();

  elapsed = 0;
  score = 0;
  coinCount = 0;

  lane = 1;
  player.position.set(0, 0, 0);

  jumping = false;
  jumpSpeed = 0;
  slideTime = 0;

  shieldTime = 0;
  magnetTime = 0;

  obstacleTimer = 1;
  coinTimer = 1;
  powerTimer = 10;

  demonChasing = false;
  previousChaseState = false;
  demonDistance = 14;

  if (demon) {
    demon.visible = false;
    demon.position.set(0, 0, 14);
  }

  cameraMode = 0;
  $("camera-button").textContent = "CAMERA: FOLLOW";

  $("score").textContent = "0";
  $("coins").textContent = "0";
  $("best").textContent = String(best);
  $("power-status").textContent = "NO POWER-UP";

  $("message").classList.add("hidden");
}

// ==================================================
// GAME FLOW
// ==================================================

function startGame() {
  resetGame();

  running = true;
  paused = false;

  $("menu").classList.add("hidden");
  $("game-over").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("victory-screen").classList.add("hidden");

  $("hud").classList.remove("hidden");
  $("touch-controls").classList.remove("hidden");
}

function endGame() {
  if (!running) return;

  running = false;
  paused = false;

  best = Math.max(best, Math.floor(score));

  localStorage.setItem(
    "jungleEscapeV13Best",
    String(best)
  );

  $("final-score").textContent = String(Math.floor(score));
  $("final-coins").textContent = String(coinCount);
  $("best").textContent = String(best);

  $("hud").classList.add("hidden");
  $("touch-controls").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("game-over").classList.remove("hidden");
}

function returnToMenu() {
  running = false;
  paused = false;

  $("game-over").classList.add("hidden");
  $("pause-screen").classList.add("hidden");
  $("victory-screen").classList.add("hidden");
  $("hud").classList.add("hidden");
  $("touch-controls").classList.add("hidden");
  $("menu").classList.remove("hidden");
}

function togglePause() {
  if (!running) return;

  paused = !paused;

  $("pause-screen").classList.toggle("hidden", !paused);
  $("hud").classList.toggle("hidden", paused);
  $("touch-controls").classList.toggle("hidden", paused);
}

// ==================================================
// PLAYER MOVEMENT
// ==================================================

function moveLane(direction) {
  if (!running || paused) return;

  lane = THREE.MathUtils.clamp(
    lane + direction,
    0,
    2
  );
}

function jump() {
  if (!running || paused || jumping || slideTime > 0) return;

  jumping = true;
  jumpSpeed = 9;
}

function slide() {
  if (!running || paused || jumping) return;

  slideTime = 0.8;
}

// ==================================================
// GAME UPDATE
// ==================================================

function updateGame(dt) {
  elapsed += dt;

  const speed = Math.min(
    29,
    18 + elapsed * 0.025
  );

  score += dt * 10;

  $("score").textContent = String(Math.floor(score));

  // Player lane movement.
  player.position.x = THREE.MathUtils.damp(
    player.position.x,
    LANES[lane],
    13,
    dt
  );

  // Jump physics.
  if (jumping) {
    player.position.y += jumpSpeed * dt;
    jumpSpeed -= 21 * dt;

    if (player.position.y <= 0) {
      player.position.y = 0;
      jumpSpeed = 0;
      jumping = false;
    }
  }

  // Slide timer.
  if (slideTime > 0) {
    slideTime = Math.max(0, slideTime - dt);
  }

  animateFallbackCharacter(elapsed);

  // Imported character animation.
  const activeMixer = characterMixers[selectedCharacter];

  if (activeMixer) {
    activeMixer.update(dt);

    const holder = characterHolders[selectedCharacter];
    holder.rotation.x = jumping ? -0.18 : 0;
  }

  // Move roadside environment.
  updateMovingEnvironment(speed, dt);

  // Move fallback trees.
  updateFallbackTrees(speed, dt);

  // Spawn obstacles.
  obstacleTimer -= dt;

  if (obstacleTimer <= 0) {
    spawnObstacle();

    obstacleTimer =
      Math.max(0.8, 1.5 - elapsed * 0.002) +
      Math.random() * 0.35;
  }

  // Spawn coins.
  coinTimer -= dt;

  if (coinTimer <= 0) {
    spawnCoin();
    coinTimer = 0.9 + Math.random() * 0.8;
  }

  // Spawn power-ups.
  powerTimer -= dt;

  if (powerTimer <= 0) {
    spawnPowerup();
    powerTimer = 13 + Math.random() * 10;
  }

  // Power-up timers.
  shieldTime = Math.max(0, shieldTime - dt);
  magnetTime = Math.max(0, magnetTime - dt);

  if (shieldTime > 0) {
    $("power-status").textContent =
      "SHIELD " + Math.ceil(shieldTime) + "s";
  } else if (magnetTime > 0) {
    $("power-status").textContent =
      "MAGNET " + Math.ceil(magnetTime) + "s";
  } else {
    $("power-status").textContent = "NO POWER-UP";
  }

  // Obstacles.
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const item = obstacles[i];

    item.mesh.position.z += speed * dt;

    const nearPlayer =
      item.mesh.position.z > -1.1 &&
      item.mesh.position.z < 1.1 &&
      item.lane === lane;

    if (nearPlayer) {
      const safelyJumped =
        jumping && player.position.y > 0.75;

      const safelySlid =
        slideTime > 0 && item.kind === "log";

      if (!safelyJumped && !safelySlid) {
        if (shieldTime > 0) {
          shieldTime = 0;

          scene.remove(item.mesh);
          obstacles.splice(i, 1);

          showMessage("YOUR SHIELD SAVED YOU!", 2);
          continue;
        }

        endGame();
        return;
      }
    }

    if (item.mesh.position.z > 14) {
      scene.remove(item.mesh);
      obstacles.splice(i, 1);
    }
  }

  // Coins.
  for (let i = coins.length - 1; i >= 0; i--) {
    const item = coins[i];

    item.mesh.position.z += speed * dt;
    item.mesh.rotation.z += dt * 3;

    if (
      Math.abs(item.mesh.position.z) < 2 &&
      (item.lane === lane || magnetTime > 0)
    ) {
      coinCount++;

      $("coins").textContent = String(coinCount);

      scene.remove(item.mesh);
      coins.splice(i, 1);
      continue;
    }

    if (item.mesh.position.z > 14) {
      scene.remove(item.mesh);
      coins.splice(i, 1);
    }
  }

  // Power-ups.
  for (let i = powerups.length - 1; i >= 0; i--) {
    const item = powerups[i];

    item.mesh.position.z += speed * dt;
    item.mesh.rotation.y += dt * 2;

    if (
      Math.abs(item.mesh.position.z) < 1.5 &&
      item.lane === lane
    ) {
      if (item.type === "shield") {
        shieldTime = 12;
        showMessage("SHIELD ACTIVATED!", 2);
      } else {
        magnetTime = 12;
        showMessage("COIN MAGNET ACTIVATED!", 2);
      }

      scene.remove(item.mesh);
      powerups.splice(i, 1);
      continue;
    }

    if (item.mesh.position.z > 14) {
      scene.remove(item.mesh);
      powerups.splice(i, 1);
    }
  }

  // Demon chase.
  updateDemon(dt);

  // Message timer.
  if (messageTimer > 0) {
    messageTimer -= dt;

    if (messageTimer <= 0) {
      $("message").classList.add("hidden");
    }
  }
}

// ==================================================
// INPUT EVENTS
// ==================================================

document.querySelectorAll(".character-button").forEach(button => {
  button.addEventListener("click", () => {
    chooseCharacter(Number(button.dataset.character));
  });
});

$("start-button").addEventListener("click", startGame);
$("restart-button").addEventListener("click", startGame);

$("pause-button").addEventListener("click", togglePause);
$("resume-button").addEventListener("click", togglePause);

$("menu-button").addEventListener("click", returnToMenu);
$("quit-button").addEventListener("click", returnToMenu);

$("camera-button").addEventListener("click", changeCamera);

$("left-button").addEventListener("click", () => moveLane(-1));
$("right-button").addEventListener("click", () => moveLane(1));
$("jump-button").addEventListener("click", jump);
$("slide-button").addEventListener("click", slide);

// Keyboard.
window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  if (
    ["arrowleft", "arrowright", "arrowup", "arrowdown", " "].includes(key)
  ) {
    event.preventDefault();
  }

  if (key === "arrowleft" || key === "a") moveLane(-1);
  if (key === "arrowright" || key === "d") moveLane(1);

  if (key === "arrowup" || key === "w" || key === " ") jump();
  if (key === "arrowdown" || key === "s") slide();

  if (key === "c") changeCamera();
  if (key === "p" || key === "escape") togglePause();
});

// Swipe controls.
let touchStartX = 0;
let touchStartY = 0;

renderer.domElement.addEventListener(
  "touchstart",
  event => {
    const touch = event.changedTouches[0];

    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  },
  { passive: true }
);

renderer.domElement.addEventListener(
  "touchend",
  event => {
    const touch = event.changedTouches[0];

    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;

    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 35) {
      moveLane(dx > 0 ? 1 : -1);
    } else if (Math.abs(dy) > 35) {
      if (dy < 0) jump();
      else slide();
    }
  },
  { passive: true }
);

// ==================================================
// WINDOW RESIZE
// ==================================================

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(innerWidth, innerHeight);
});

// ==================================================
// MAIN ANIMATION LOOP
// ==================================================

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  if (running && !paused) {
    updateGame(dt);
  }

  updateCamera(dt);

  renderer.render(scene, camera);
}

// ==================================================
// INITIALIZE
// ==================================================

$("best").textContent = String(best);

createEnvironment();

loadCharacters();
loadDemon();
loadRealisticJungle();

updateCharacterSelection();

animate();
