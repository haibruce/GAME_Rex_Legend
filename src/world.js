import * as THREE from "three";
import { CONFIG } from "./config.js";

// 建立場景、燈光、地面與各種地形裝飾。障礙物同時作為圓形碰撞體。
export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = []; // { x, z, radius }
    this.groundMesh = null;
    this._ray = new THREE.Raycaster();
    this._down = new THREE.Vector3(0, -1, 0);
    this._build();
  }

  _build() {
    const c = CONFIG.world;

    // 天空 & 霧
    this.scene.background = new THREE.Color(c.skyColor);
    this.scene.fog = new THREE.Fog(c.skyColor, c.fogNear, c.fogFar);

    // 燈光
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a6a3a, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.15);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = c.size * 0.6;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 220;
    this.scene.add(sun);

    this.bound = c.size / 2 - 2;

    this._makeGround();
    this._makeWater();
    this._makeFence();
    this._makeHut();
    this._scatterProps();
  }

  // 地形高度公式 —— World 建地面與角色貼地都用同一套，確保一致
  getHeight(x, z) {
    const distC = Math.hypot(x, z);
    const flat = Math.min(1, distC / 25); // 中央出生區壓平
    const h =
      Math.sin(x * 0.05) * 1.6 +
      Math.cos(z * 0.045) * 1.4 +
      Math.sin((x + z) * 0.08) * 0.8;
    return h * flat;
  }

  // 角色貼地用：取腳下及周圍採樣的最高點，確保站在凸起的三角面上時不會陷進去
  // 角色/怪物貼地：用射線打到「實際的地面 mesh」，取得肉眼看到的真實高度，
  // 徹底避免公式與離散網格落差造成的穿模。
  getGroundY(x, z) {
    if (!this.groundMesh) return this.getHeight(x, z);
    this._ray.set(new THREE.Vector3(x, 100, z), this._down);
    const hits = this._ray.intersectObject(this.groundMesh, false);
    if (hits.length > 0) return hits[0].point.y;
    return this.getHeight(x, z);
  }

  // 起伏地面：位移頂點做出小丘陵，並依高度上色 (低=草綠、高=土黃)
  _makeGround() {
    const c = CONFIG.world;
    const seg = 160;
    const geo = new THREE.PlaneGeometry(c.size, c.size, seg, seg);
    const pos = geo.attributes.position;
    const colors = [];
    const low = new THREE.Color(0x3f6f30);
    const mid = new THREE.Color(0x5a8a3c);
    const high = new THREE.Color(0x8a7d4a);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i); // 尚未旋轉，y 即世界 z
      const h = this.getHeight(x, y);
      pos.setZ(i, h);

      const t = Math.min(1, Math.max(0, (h + 2) / 6));
      const col = t < 0.5 ? low.clone().lerp(mid, t * 2) : mid.clone().lerp(high, (t - 0.5) * 2);
      colors.push(col.r, col.g, col.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: false });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.updateMatrixWorld(true); // 讓 raycaster 能正確命中
    this.scene.add(ground);
    this.groundMesh = ground;
  }

  // 一池水塘
  _makeWater() {
    const r = 14;
    const px = 32;
    const pz = -28;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(r, 40),
      new THREE.MeshStandardMaterial({
        color: 0x2a7fbf,
        transparent: true,
        opacity: 0.75,
        metalness: 0.4,
        roughness: 0.2,
      })
    );
    const wy = this.getHeight(px, pz);
    water.rotation.x = -Math.PI / 2;
    water.position.set(px, wy + 0.15, pz);
    this.scene.add(water);

    // 池邊石圈當作碰撞，避免玩家走進水裡
    const ringCount = 16;
    for (let i = 0; i < ringCount; i++) {
      const a = (i / ringCount) * Math.PI * 2;
      const rx = px + Math.cos(a) * r;
      const rz = pz + Math.sin(a) * r;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(1.1, 0),
        new THREE.MeshStandardMaterial({ color: 0x777777, flatShading: true })
      );
      rock.position.set(rx, this.getGroundY(rx, rz) + 0.4, rz);
      rock.castShadow = true;
      this.scene.add(rock);
      this.obstacles.push({ x: rx, z: rz, radius: 0.9 });
    }
  }

  // 邊界木柵欄
  _makeFence() {
    const b = this.bound;
    const step = 8;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
    const postGeo = new THREE.CylinderGeometry(0.25, 0.25, 2.2, 6);
    for (let p = -b; p <= b; p += step) {
      const positions = [
        [p, b], [p, -b], [b, p], [-b, p],
      ];
      for (const [x, z] of positions) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, this.getGroundY(x, z) + 1.1, z);
        post.castShadow = true;
        this.scene.add(post);
      }
    }
  }

  // 小木屋當地標
  _makeHut() {
    const hx = -34;
    const hz = 30;
    const group = new THREE.Group();

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(8, 5, 8),
      new THREE.MeshStandardMaterial({ color: 0xcaa472 })
    );
    wall.position.y = 2.5;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(7, 3.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x8a3b2b, flatShading: true })
    );
    roof.position.y = 6.75;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 2.8, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x5a3a1a })
    );
    door.position.set(0, 1.4, 4.05);
    group.add(door);

    group.position.set(hx, this.getGroundY(hx, hz), hz);
    this.scene.add(group);

    // 房子當碰撞
    this.obstacles.push({ x: hx, z: hz, radius: 5.5 });
  }

  // 隨機散佈：樹、石頭、灌木、花叢
  _scatterProps() {
    const c = CONFIG.world;
    for (let i = 0; i < c.obstacleCount; i++) {
      const x = (Math.random() - 0.5) * (c.size - 20);
      const z = (Math.random() - 0.5) * (c.size - 20);
      if (Math.hypot(x, z) < 10) continue;               // 出生點淨空
      if (Math.hypot(x - 32, z + 28) < 18) continue;     // 避開水塘
      if (Math.hypot(x + 34, z - 30) < 10) continue;     // 避開木屋

      const r = Math.random();
      if (r < 0.45) this._makeTree(x, z);
      else if (r < 0.7) this._makeRock(x, z);
      else if (r < 0.9) this._makeBush(x, z);
      else this._makeFlowers(x, z);
    }
  }

  _makeTree(x, z) {
    const group = new THREE.Group();
    const trunkH = 2.5 + Math.random() * 2;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.55, trunkH, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b4423 })
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // 兩三層樹冠，較有層次
    const layers = 2 + Math.floor(Math.random() * 2);
    for (let l = 0; l < layers; l++) {
      const leafR = (1.7 + Math.random()) * (1 - l * 0.2);
      const leaves = new THREE.Mesh(
        new THREE.IcosahedronGeometry(leafR, 0),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(0x2f7d32).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1),
          flatShading: true,
        })
      );
      leaves.position.y = trunkH + l * 1.1;
      leaves.castShadow = true;
      group.add(leaves);
    }
    group.position.set(x, this.getGroundY(x, z), z);
    this.scene.add(group);
    this.obstacles.push({ x, z, radius: 0.7 });
  }

  _makeRock(x, z) {
    const r = 0.8 + Math.random() * 1.4;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r, 0),
      new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true })
    );
    rock.position.set(x, this.getGroundY(x, z) + r * 0.5, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    this.scene.add(rock);
    this.obstacles.push({ x, z, radius: r });
  }

  // 灌木叢：幾顆綠球疊在一起 (可穿越，不加碰撞)
  _makeBush(x, z) {
    const group = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const r = 0.5 + Math.random() * 0.4;
      const b = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        new THREE.MeshStandardMaterial({ color: 0x3b8f3f, flatShading: true })
      );
      b.position.set((Math.random() - 0.5) * 1.2, r * 0.7, (Math.random() - 0.5) * 1.2);
      b.castShadow = true;
      group.add(b);
    }
    group.position.set(x, this.getGroundY(x, z), z);
    this.scene.add(group);
  }

  // 花叢：地上一小片彩色點綴 (純裝飾)
  _makeFlowers(x, z) {
    const group = new THREE.Group();
    const palette = [0xff5c8a, 0xffe14d, 0xff8c42, 0xb46bff, 0xffffff];
    const n = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4),
        new THREE.MeshStandardMaterial({ color: 0x2f7d32 })
      );
      const fx = (Math.random() - 0.5) * 2.5;
      const fz = (Math.random() - 0.5) * 2.5;
      stem.position.set(fx, 0.25, fz);
      group.add(stem);

      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 6, 6),
        new THREE.MeshStandardMaterial({ color: palette[i % palette.length] })
      );
      flower.position.set(fx, 0.55, fz);
      group.add(flower);
    }
    group.position.set(x, this.getGroundY(x, z), z);
    this.scene.add(group);
  }

  // 給定想去的位置與碰撞半徑，回傳修正後不會穿牆/穿障礙的位置
  // 接受 Vector3 或 {x,z} 普通物件 (避免每幀 clone 的開銷)
  resolveCollision(pos, radius) {
    const result = { x: pos.x, z: pos.z };

    result.x = Math.max(-this.bound, Math.min(this.bound, result.x));
    result.z = Math.max(-this.bound, Math.min(this.bound, result.z));

    for (const o of this.obstacles) {
      const dx = result.x - o.x;
      const dz = result.z - o.z;
      const dist = Math.hypot(dx, dz);
      const minDist = radius + o.radius;
      if (dist < minDist && dist > 0.0001) {
        const push = (minDist - dist) / dist;
        result.x += dx * push;
        result.z += dz * push;
      }
    }
    return result;
  }
}
