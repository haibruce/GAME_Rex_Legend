import * as THREE from "three";
import { CONFIG } from "./config.js";

// 建立場景、燈光、地面與各種地形裝飾。障礙物同時作為圓形碰撞體。
export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = []; // 碰撞圓 { x, z, radius, destructible? }
    this.destructibles = []; // 可被炸毀的物件 { group, x, z, radius, parts, obstacle, destroyed, respawnFn }
    this.debris = [];    // 飛散中的碎片 { mesh, vx, vy, vz, spin, life }
    this.respawns = [];  // 待重生 { fn, timer } (例如樹木炸毀後重長)
    this.climbMeshes = []; // 可站立的建築表面 (樓板/階梯)，供玩家與怪物上樓
    this.buildingZones = []; // 建築水平範圍 {x,z,radius}，離遠時跳過爬樓射線 (效能)
    this.groundMesh = null;
    this._ray = new THREE.Raycaster();
    this._down = new THREE.Vector3(0, -1, 0);
    this._build();
  }

  // 登記一個可破壞物件。parts: 由 {mesh, ox, oy, oz} 組成 (mesh 已加入 group)。
  // obstacle: 對應的碰撞圓 (破壞後移除碰撞)。
  // hp: 需承受幾次爆炸才碎 (預設 1)。shield: 可再擋幾次爆炸不掉 hp (預設 0)。
  _registerDestructible(group, x, z, radius, parts, obstacle, respawnFn = null, hp = 1, shield = 0) {
    this.destructibles.push({ group, x, z, radius, parts, obstacle, destroyed: false, respawnFn, hp, shield });
  }

  // 炸彈爆炸：波及範圍內未破壞的可破壞物件，扣血 (先耗 shield)，血歸零才碎裂炸飛。
  applyExplosion(x, z, radius) {
    for (const d of this.destructibles) {
      if (d.destroyed) continue;
      const dist = Math.hypot(d.x - x, d.z - z);
      if (dist > radius + d.radius) continue;
      // 正面擋爆：先消耗護盾 (這次不掉血、擋住保護後方)
      if (d.shield > 0) {
        d.shield--;
        continue;
      }
      d.hp--;
      if (d.hp <= 0) {
        this._shatter(d, x, z);
      } else {
        // 未碎：受擊回饋 (整體輕微下沉一下)，讓玩家知道有打到
        d.group.position.y -= 0.06;
      }
    }
  }

  // 把一個可破壞物件碎裂成飛散碎片
  _shatter(d, ex, ez) {
    d.destroyed = true;
    // 移除碰撞圓 (炸毀後可通行)
    if (d.obstacle) {
      const i = this.obstacles.indexOf(d.obstacle);
      if (i >= 0) this.obstacles.splice(i, 1);
    }

    const gx = d.group.position.x;
    const gy = d.group.position.y;
    const gz = d.group.position.z;

    for (const part of d.parts) {
      const mesh = part.mesh;
      // 若是可站立表面 (樓板/階梯)，炸毀後移除，站上面的角色會失去支撐
      const ci = this.climbMeshes.indexOf(mesh);
      if (ci >= 0) this.climbMeshes.splice(ci, 1);
      // 把 part 從原 group 取出、改掛到 scene，並換算成世界座標
      d.group.remove(mesh);
      mesh.position.set(gx + part.ox, gy + part.oy, gz + part.oz);
      this.scene.add(mesh);

      // 以爆炸中心 → 碎片 的方向給予飛散速度
      let dx = mesh.position.x - ex;
      let dz = mesh.position.z - ez;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const power = 8 + Math.random() * 10;
      this.debris.push({
        mesh,
        vx: dx * power + (Math.random() - 0.5) * 3,
        vy: 6 + Math.random() * 8,
        vz: dz * power + (Math.random() - 0.5) * 3,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        spinSpeed: 4 + Math.random() * 8,
        life: 1.2 + Math.random() * 0.6,
      });
    }
    // 清掉空的 group
    this.scene.remove(d.group);

    // 若可重生 (例如樹木)，排入重生佇列
    if (d.respawnFn) {
      this.respawns.push({ fn: d.respawnFn, timer: CONFIG.world.treeRespawn || 12 });
    }
  }

  // 每幀更新飛散碎片 (拋物線 + 翻滾 + 落地後淡出移除)
  update(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const p = this.debris[i];
      p.vy -= 30 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotateOnAxis(p.spin, p.spinSpeed * dt);

      const groundY = this.getHeight(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < groundY) {
        p.mesh.position.y = groundY;
        p.vy *= -0.35;         // 落地彈一下
        p.vx *= 0.5; p.vz *= 0.5;
      }

      p.life -= dt;
      if (p.life <= 0) {
        // 淡出並移除
        this.scene.remove(p.mesh);
        if (p.mesh.geometry) p.mesh.geometry.dispose();
        this.debris.splice(i, 1);
      }
    }

    // 重生佇列 (樹木炸毀後重長)
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      this.respawns[i].timer -= dt;
      if (this.respawns[i].timer <= 0) {
        const fn = this.respawns[i].fn;
        this.respawns.splice(i, 1);
        fn(); // 重新建立 (內部會登記新的 destructible)
      }
    }

    // 清掉已破壞的 destructible 紀錄，避免陣列無限增長
    if (this.destructibles.length > 400) {
      this.destructibles = this.destructibles.filter((d) => !d.destroyed);
    }

    // 水面動畫：整片輕微起伏 + 高光緩慢漂移 + 波紋擴散循環
    if (this.water) {
      const w = this.water;
      w.t += dt;
      w.surface.position.y = w.baseY + Math.sin(w.t * 1.2) * 0.06;
      w.surface.material.opacity = 0.6 + Math.sin(w.t * 0.8) * 0.08;
      if (w.glint) {
        w.glint.position.x = w.px + Math.sin(w.t * 0.5) * 2.5;
        w.glint.position.z = w.pz + Math.cos(w.t * 0.4) * 2.5;
      }
      for (const ring of w.ripples) {
        let k = (w.t * 0.25 + ring.userData.phase) % 1; // 0→1 循環
        const rr = 0.5 + k * w.maxR;
        ring.scale.setScalar(rr);
        ring.material.opacity = 0.4 * (1 - k);
      }
    }
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
    this._makeTower();
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
  // x,z: 位置; currentY: 角色目前腳底高度 (傳入時才會納入可站立的建築表面，用於上樓)
  getGroundY(x, z, currentY) {
    let groundY = this.getHeight(x, z);
    if (this.groundMesh) {
      this._ray.set(new THREE.Vector3(x, 200, z), this._down);
      const hits = this._ray.intersectObject(this.groundMesh, false);
      if (hits.length > 0) groundY = hits[0].point.y;
    }

    // 沒傳 currentY (碎片/裝飾定位) 或無可站表面 → 只看地面
    if (currentY === undefined || this.climbMeshes.length === 0) return groundY;

    // 效能：不在任何建築水平範圍內，就不做爬樓射線 (大量怪物時省開銷)
    let nearBuilding = false;
    for (const zone of this.buildingZones) {
      if (Math.hypot(x - zone.x, z - zone.z) <= zone.radius) { nearBuilding = true; break; }
    }
    if (!nearBuilding) return groundY;

    // 納入建築可站表面：找「不高於 currentY + 一階」的最高表面
    const stepUp = 1.4; // 一次能踏上的高度 (階梯/樓板)
    let best = groundY;
    this._ray.set(new THREE.Vector3(x, 200, z), this._down);
    const chits = this._ray.intersectObjects(this.climbMeshes, false);
    for (const h of chits) {
      const y = h.point.y;
      if (y <= currentY + stepUp && y > best) best = y;
    }
    return best;
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

  // 一池水塘 (多層 + 波紋動畫，較有水感)
  _makeWater() {
    const r = 14;
    const px = 32;
    const pz = -28;
    const wy = this.getHeight(px, pz);

    // 深色水底 (不透明，製造深度感)
    const bed = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshStandardMaterial({ color: 0x0d3b5c, roughness: 0.9 })
    );
    bed.rotation.x = -Math.PI / 2;
    bed.position.set(px, wy - 0.6, pz);
    this.scene.add(bed);

    // 水面 (半透明高反光，隨時間輕微起伏)
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(r, 64),
      new THREE.MeshStandardMaterial({
        color: 0x3aa0d8, transparent: true, opacity: 0.7,
        metalness: 0.9, roughness: 0.12,
      })
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(px, wy + 0.2, pz);
    this.scene.add(surface);

    // 亮色高光小圈 (模擬反光斑)
    const glint = new THREE.Mesh(
      new THREE.CircleGeometry(r * 0.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.12 })
    );
    glint.rotation.x = -Math.PI / 2;
    glint.position.set(px - 2, wy + 0.22, pz - 2);
    this.scene.add(glint);

    // 擴散波紋環 (循環)
    const ripples = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.9, 40),
        new THREE.MeshBasicMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(px, wy + 0.24, pz);
      ring.userData.phase = i / 3; // 錯開時間
      this.scene.add(ring);
      ripples.push(ring);
    }

    // 給 update 動畫用
    this.water = { surface, glint, ripples, px, pz, baseY: wy + 0.2, maxR: r, t: 0 };

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

  // 小木屋：由許多獨立小塊組成，每塊各自可被炸毀 —— 爆炸位置決定哪一側被炸開。
  _makeHut() {
    const hx = -22;   // 出生點左前方，開場就看得到
    const hz = 26;
    const gy = this.getGroundY(hx, hz);

    const W = 9, H = 6, D = 9;   // 房子寬高深
    const cols = 3, rows = 3;    // 每面牆切成 cols x rows 塊
    const t = 0.4;               // 牆厚

    const wallMat = () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xcaa472).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06),
      roughness: 0.85, flatShading: true,
    });

    // 建立一個「獨立可破壞小塊」：自成一個掛在 scene 的小 group
    // collideR>0 時給這塊一個小碰撞圓 (只擋在牆的位置，門口不放 → 可進入)；耐 3 炸、正面擋 1 次
    const addBlock = (wx, wy, wz, geo, mat, ry = 0, collideR = 0) => {
      const g = new THREE.Group();
      g.position.set(hx + wx, gy + wy, hz + wz);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      this.scene.add(g);
      let col = null;
      if (collideR > 0) {
        col = { x: hx + wx, z: hz + wz, radius: collideR };
        this.obstacles.push(col);
      }
      // 炸毀後 col 會被移除 (破洞可通行)；hp=3 耐三炸，shield=1 正面擋一次
      this._registerDestructible(g, hx + wx, hz + wz, 1.2, [{ mesh, ox: 0, oy: 0, oz: 0 }], col, null, 3, 1);
    };

    // 四面牆 (前後左右)，各切成 cols x rows 塊；前牆中間整欄留門 (含門楣，碰撞全不放)。
    const cw = W / cols, ch = H / rows;
    const wallColR = cw * 0.34; // 牆塊碰撞半徑 (貼牆，通道好走)
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const bx = -W / 2 + cw * (c + 0.5);
        const by = ch * (r + 0.5);
        const isDoorCol = (c === 1); // 前牆中間整欄是門 (通道，不放碰撞)
        const isDoorGap = (c === 1 && r <= 1); // 下兩排連視覺牆都不建 (門洞)
        if (!isDoorGap) {
          // 前牆門口欄的門楣塊：保留視覺但不擋路 (collideR=0)
          addBlock(bx, by, D / 2, new THREE.BoxGeometry(cw * 0.96, ch * 0.96, t), wallMat(), 0, isDoorCol ? 0 : wallColR);
        }
        addBlock(bx, by, -D / 2, new THREE.BoxGeometry(cw * 0.96, ch * 0.96, t), wallMat(), 0, wallColR);
        addBlock(-W / 2, by, -D / 2 + cw * (c + 0.5), new THREE.BoxGeometry(t, ch * 0.96, cw * 0.96), wallMat(), 0, wallColR);
        addBlock(W / 2, by, -D / 2 + cw * (c + 0.5), new THREE.BoxGeometry(t, ch * 0.96, cw * 0.96), wallMat(), 0, wallColR);
      }
    }

    // 屋頂：切成 4 片三角錐塊 (各自可破壞，不擋路)
    const roofMat = () => new THREE.MeshStandardMaterial({ color: 0x8a3b2b, flatShading: true, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.ConeGeometry(6.4, 3.2, 4, 1, true, i * (Math.PI / 2), Math.PI / 2);
      addBlock(0, H + 1.6, 0, geo, roofMat(), Math.PI / 4, 0);
    }

    // 門片 (視覺用，不擋路 collideR=0，可從門口走進去)
    addBlock(0, 1.4, D / 2, new THREE.BoxGeometry(cw * 0.9, ch * 1.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 }), 0, 0);

    // 不再放整體大圓碰撞 (那會變成隱形牆擋住入口)；改由各牆塊各自擋路
    this.buildingZones.push({ x: hx, z: hz, radius: 12 }); // 爬樓/內部射線範圍
  }

  // 三層樓建築：內部樓梯可上樓 (玩家與怪物皆可)，牆/樓板/樓梯皆分件可炸毀。
  _makeTower() {
    const tx = 24, tz = 30;   // 出生點右前方，開場就看得到
    const gy = this.getGroundY(tx, tz);
    const W = 9, D = 9, floorH = 4, floors = 3, t = 0.4;

    const stoneMat = () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x9a9488).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06),
      roughness: 0.9, flatShading: true,
    });
    const woodMat = () => new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.8 });

    // 建立獨立可破壞塊；climbable=true 加入可站立表面 (樓板/踏板)；collideR>0 給小碰撞圓 (牆才擋路)
    const addBlock = (wx, wy, wz, geo, mat, climbable, radius, collideR = 0) => {
      const g = new THREE.Group();
      g.position.set(tx + wx, gy + wy, tz + wz);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      this.scene.add(g);
      if (climbable) {
        mesh.updateMatrixWorld(true);
        this.climbMeshes.push(mesh);
      }
      let col = null;
      if (collideR > 0) {
        col = { x: tx + wx, z: tz + wz, radius: collideR };
        this.obstacles.push(col);
      }
      // 耐 3 炸、正面擋 1 次；炸毀後移除碰撞 (可穿破洞)
      this._registerDestructible(g, tx + wx, tz + wz, radius || 1.4, [{ mesh, ox: 0, oy: 0, oz: 0 }], col, null, 3, 1);
    };

    const cols = 3;               // 每面牆每層分幾塊
    const cw = W / cols;

    for (let lv = 0; lv < floors; lv++) {
      const baseY = lv * floorH;

      // 樓板：留一個固定角落開口 (a=2,b=0 → +X/-Z 角) 給樓梯上下，樓梯終點對齊此處
      if (lv > 0) {
        for (let a = 0; a < 3; a++) {
          for (let b = 0; b < 3; b++) {
            if (a === 2 && b === 0) continue; // 樓梯開口 (與樓梯對齊)
            const fx = -W / 2 + cw * (a + 0.5);
            const fz = -D / 2 + cw * (b + 0.5);
            addBlock(fx, baseY, fz, new THREE.BoxGeometry(cw * 0.98, t, cw * 0.98), stoneMat(), true, 1.6);
          }
        }
      }
      // 頂樓天台：同樣留開口對齊樓梯 (才能從樓梯上到天台)
      if (lv === floors - 1) {
        for (let a = 0; a < 3; a++) {
          for (let b = 0; b < 3; b++) {
            if (a === 2 && b === 0) continue;
            const fx = -W / 2 + cw * (a + 0.5);
            const fz = -D / 2 + cw * (b + 0.5);
            addBlock(fx, floors * floorH, fz, new THREE.BoxGeometry(cw * 0.98, t, cw * 0.98), stoneMat(), true, 1.6);
          }
        }
      }

      // 四面牆 (每面 cols 塊)，正面 (+Z) 中間留門/窗開口
      for (let c = 0; c < cols; c++) {
        const bx = -W / 2 + cw * (c + 0.5);
        const wy = baseY + floorH / 2;
        const wcr = cw * 0.34; // 牆塊碰撞半徑 (貼牆，通道好走)
        const isDoorCol = (c === 1);            // 正面中間整欄當門通道 (碰撞不放)
        const openFront = (c === 1 && lv === 0); // 一樓正面中間不建塊 (門洞)
        if (!openFront) {
          // 門口欄的牆塊 (二三樓正面中間) 保留視覺但不擋路，避免堵住一樓門口通道
          addBlock(bx, wy, D / 2, new THREE.BoxGeometry(cw * 0.96, floorH, t), stoneMat(), false, 1.6, isDoorCol ? 0 : wcr);
        }
        addBlock(bx, wy, -D / 2, new THREE.BoxGeometry(cw * 0.96, floorH, t), stoneMat(), false, 1.6, wcr);
        addBlock(-W / 2, wy, -D / 2 + cw * (c + 0.5), new THREE.BoxGeometry(t, floorH, cw * 0.96), stoneMat(), false, 1.6, wcr);
        addBlock(W / 2, wy, -D / 2 + cw * (c + 0.5), new THREE.BoxGeometry(t, floorH, cw * 0.96), stoneMat(), false, 1.6, wcr);
      }

      // 樓梯：對齊上層開口 (開口在 a=2,b=0 → fx=+3, fz=-3)。
      // 樓梯固定在 x≈+3，z 由靠門口側(+)往開口(-3)爬升，坡度平緩讓玩家/怪物逐階走上。
      const steps = 10;
      const stepH = floorH / steps;
      const openFx = -W / 2 + cw * 2.5; // 開口 x = +3
      const zStart = openFx > 0 ? D / 2 - 1.2 : -D / 2 + 1.2; // 從靠牆側起
      const openFz = -D / 2 + cw * 0.5;  // 開口 z = -3
      const zEnd = openFz;               // 樓梯終點對齊開口
      for (let s = 0; s < steps; s++) {
        const frac = s / (steps - 1);
        const sy = baseY + stepH * (s + 1);          // 逐階升高，最後一階 = baseY+floorH (上層樓板高)
        const sz = zStart + (zEnd - zStart) * frac;  // 沿 z 從起點到開口
        const depth = Math.abs(zEnd - zStart) / steps + 0.5; // 踏板夠深、彼此重疊確保連續
        addBlock(openFx, sy - stepH * 0.5, sz, new THREE.BoxGeometry(2.2, stepH * 0.9, depth), woodMat(), true, 1.6);
      }
    }

    // 不放整體大圓碰撞 (會擋住入口)；由各牆塊各自擋路，門口與內部可進出
    this.buildingZones.push({ x: tx, z: tz, radius: 14 }); // 爬樓/內部射線範圍
  }

  // 隨機散佈：樹、石頭、灌木、花叢
  _scatterProps() {
    const c = CONFIG.world;
    for (let i = 0; i < c.obstacleCount; i++) {
      const x = (Math.random() - 0.5) * (c.size - 20);
      const z = (Math.random() - 0.5) * (c.size - 20);
      if (Math.hypot(x, z) < 12) continue;               // 出生點淨空
      if (Math.hypot(x - 32, z + 28) < 18) continue;     // 避開水塘
      if (Math.hypot(x + 22, z - 26) < 12) continue;     // 避開木屋
      if (Math.hypot(x - 24, z - 30) < 14) continue;     // 避開三層樓

      const r = Math.random();
      if (r < 0.28) this._makeTree(x, z);
      else if (r < 0.44) this._makeRock(x, z);
      else if (r < 0.56) this._makeCrate(x, z);    // 可炸毀木箱堆
      else if (r < 0.66) this._makeStump(x, z);    // 樹墩 (新)
      else if (r < 0.76) this._makeBarrel(x, z);   // 木桶 (新)
      else if (r < 0.86) this._makeCrystal(x, z);  // 水晶礦簇 (新)
      else if (r < 0.95) this._makeBush(x, z);
      else this._makeFlowers(x, z);
    }
  }

  // 新障礙物 1：樹墩 (矮圓柱 + 頂面年輪)，可破壞
  _makeStump(x, z) {
    const group = new THREE.Group();
    const parts = [];
    const gy = this.getGroundY(x, z);
    const r = 0.6 + Math.random() * 0.4;
    const h = 0.6 + Math.random() * 0.4;
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9, flatShading: true });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xc8a878, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, h, 9), barkMat);
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
    group.add(body); parts.push({ mesh: body, ox: 0, oy: h / 2, oz: 0 });

    const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.08, 12), ringMat);
    top.position.y = h + 0.04;
    group.add(top); parts.push({ mesh: top, ox: 0, oy: h + 0.04, oz: 0 });

    group.position.set(x, gy, z);
    this.scene.add(group);
    const col = { x, z, radius: r };
    this.obstacles.push(col);
    this._registerDestructible(group, x, z, r + 0.3, parts, col);
  }

  // 新障礙物 2：木桶 (圓柱 + 桶箍)，可破壞
  _makeBarrel(x, z) {
    const group = new THREE.Group();
    const parts = [];
    const gy = this.getGroundY(x, z);
    const r = 0.45 + Math.random() * 0.2;
    const h = 1.2 + Math.random() * 0.3;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8, flatShading: true });
    const hoopMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), woodMat);
    body.position.y = h / 2; body.castShadow = true;
    group.add(body); parts.push({ mesh: body, ox: 0, oy: h / 2, oz: 0 });

    for (const hy of [h * 0.25, h * 0.75]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.05, 6, 14), hoopMat);
      hoop.rotation.x = Math.PI / 2; hoop.position.y = hy;
      group.add(hoop); parts.push({ mesh: hoop, ox: 0, oy: hy, oz: 0 });
    }

    group.position.set(x, gy, z);
    this.scene.add(group);
    const col = { x, z, radius: r + 0.1 };
    this.obstacles.push(col);
    this._registerDestructible(group, x, z, r + 0.4, parts, col);
  }

  // 新障礙物 3：水晶礦簇 (數根發光晶柱)，可破壞
  _makeCrystal(x, z) {
    const group = new THREE.Group();
    const parts = [];
    const gy = this.getGroundY(x, z);
    const hue = Math.random();
    const baseCol = new THREE.Color().setHSL(0.5 + hue * 0.3, 0.7, 0.55);

    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ch = 0.8 + Math.random() * 1.4;
      const cr = 0.18 + Math.random() * 0.15;
      const crystal = new THREE.Mesh(
        new THREE.ConeGeometry(cr, ch, 5),
        new THREE.MeshStandardMaterial({
          color: baseCol.clone().offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.1),
          emissive: baseCol.clone().multiplyScalar(0.3),
          transparent: true, opacity: 0.85, flatShading: true, roughness: 0.3,
        })
      );
      const a = (i / n) * Math.PI * 2 + Math.random();
      const rr = Math.random() * 0.4;
      const ox = Math.cos(a) * rr, oz = Math.sin(a) * rr;
      const oy = ch / 2;
      crystal.position.set(ox, oy, oz);
      crystal.rotation.z = (Math.random() - 0.5) * 0.5;
      crystal.rotation.x = (Math.random() - 0.5) * 0.5;
      crystal.castShadow = true;
      group.add(crystal);
      parts.push({ mesh: crystal, ox, oy, oz });
    }

    group.position.set(x, gy, z);
    this.scene.add(group);
    const col = { x, z, radius: 0.6 };
    this.obstacles.push(col);
    this._registerDestructible(group, x, z, 0.9, parts, col);
  }

  // 可被炸毀的木箱堆 (2~4 個木箱疊起)
  _makeCrate(x, z) {
    const group = new THREE.Group();
    const parts = [];
    const gy = this.getGroundY(x, z);

    const n = 2 + Math.floor(Math.random() * 3);
    const crateMat = () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xb5813f).offsetHSL(0, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.1),
      roughness: 0.8, flatShading: true,
    });

    let stackY = 0;
    for (let i = 0; i < n; i++) {
      const s = 0.9 - i * 0.08;
      const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat());
      const ox = (Math.random() - 0.5) * 0.3;
      const oz = (Math.random() - 0.5) * 0.3;
      const oy = stackY + s / 2;
      box.position.set(ox, oy, oz);
      box.rotation.y = (Math.random() - 0.5) * 0.4;
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
      parts.push({ mesh: box, ox, oy, oz });
      stackY += s * 0.92;
    }

    group.position.set(x, gy, z);
    this.scene.add(group);

    const col = { x, z, radius: 0.7 };
    this.obstacles.push(col);
    this._registerDestructible(group, x, z, 1.0, parts, col);
  }

  // 樹木：5 種樹型，可被炸毀且會重生。type 未指定則隨機。grove=true 表示是叢生的一員 (不再遞迴成叢)。
  _makeTree(x, z, type, grove) {
    // type: 0 圓冠矮樹 / 1 錐形松樹 / 2 高瘦樹 / 3 多枝闊葉樹 / 4 巨大老樹
    if (type === undefined) type = Math.floor(Math.random() * 5);

    const group = new THREE.Group();
    const parts = [];
    const barkColor = new THREE.Color(0x6b4423).offsetHSL(0, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.08);
    const barkMat = new THREE.MeshStandardMaterial({ color: barkColor, roughness: 0.9, flatShading: true });
    const leafBase = new THREE.Color(0x2f7d32);
    const leafMat = () => new THREE.MeshStandardMaterial({
      color: leafBase.clone().offsetHSL((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.14),
      flatShading: true, roughness: 0.85,
    });

    // 各樹型參數：scale(整體)、trunkR(幹粗)、branchN(枝數)、blobs(冠球數)、pine(是否錐形松)
    // hs=高度倍率, ws=寬度倍率 (整體放大，更雄偉)
    const P = [
      { hs: 1.0, ws: 1.1, trunkR: 0.3, branchN: 2, blobs: 4, pine: false }, // 圓冠
      { hs: 1.8, ws: 1.2, trunkR: 0.34, branchN: 0, blobs: 0, pine: true }, // 錐形松 (更高)
      { hs: 3.0, ws: 0.9, trunkR: 0.28, branchN: 2, blobs: 3, pine: false }, // 高瘦
      { hs: 1.6, ws: 3.6, trunkR: 0.55, branchN: 14, blobs: 16, pine: false }, // 超寬多枝
      { hs: 5.5, ws: 2.8, trunkR: 0.85, branchN: 9, blobs: 18, pine: false }, // 巨大老樹 (超雄偉)
    ][type];

    const hs = P.hs, ws = P.ws;
    const trunkH = (2.6 + Math.random() * 1.0) * hs;
    const trunkR = P.trunkR * ws;

    // 樹幹兩段
    const trunkLow = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.85, trunkR * 1.15, trunkH * 0.6, 8), barkMat);
    trunkLow.position.y = trunkH * 0.3; trunkLow.castShadow = true;
    group.add(trunkLow); parts.push({ mesh: trunkLow, ox: 0, oy: trunkH * 0.3, oz: 0 });
    const trunkTop = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.55, trunkR * 0.85, trunkH * 0.5, 8), barkMat);
    trunkTop.position.y = trunkH * 0.72; trunkTop.castShadow = true;
    group.add(trunkTop); parts.push({ mesh: trunkTop, ox: 0, oy: trunkH * 0.72, oz: 0 });

    // 樹枝 (長度依寬度倍率，位置依樹高)
    for (let b = 0; b < P.branchN; b++) {
      const bl = (0.9 + Math.random() * 0.8) * ws;
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.2, trunkR * 0.35, bl, 5), barkMat);
      const ba = Math.random() * Math.PI * 2;
      const by = trunkH * (0.5 + Math.random() * 0.4);
      branch.position.set(Math.cos(ba) * trunkR * 1.6, by, Math.sin(ba) * trunkR * 1.6);
      branch.rotation.z = Math.cos(ba) * 1.0;
      branch.rotation.x = -Math.sin(ba) * 1.0;
      branch.castShadow = true;
      group.add(branch);
      parts.push({ mesh: branch, ox: branch.position.x, oy: by, oz: branch.position.z });
    }

    if (P.pine) {
      // 錐形松樹：疊 3~4 層圓錐當樹冠
      const layers = 3 + Math.floor(Math.random() * 2);
      for (let l = 0; l < layers; l++) {
        const cr = (1.6 - l * 0.35) * ws;
        const cone = new THREE.Mesh(new THREE.ConeGeometry(cr, 1.6 * hs, 7), leafMat());
        const oy = trunkH * 0.7 + l * 1.1 * hs;
        cone.position.y = oy; cone.castShadow = true;
        group.add(cone);
        parts.push({ mesh: cone, ox: 0, oy, oz: 0 });
      }
    } else {
      // 蓬鬆球冠 (半徑與散佈依寬度倍率，高度依樹高)
      const canopyBase = trunkH * 0.9;
      for (let i = 0; i < P.blobs; i++) {
        const leafR = (0.85 + Math.random() * 0.7) * ws;
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(leafR, 0), leafMat());
        const a = (i / P.blobs) * Math.PI * 2 + Math.random();
        const rr = i === 0 ? 0 : (0.5 + Math.random() * 0.9) * ws;
        const oy = canopyBase + (0.4 + Math.random() * 1.4) * hs;
        leaves.position.set(Math.cos(a) * rr, oy, Math.sin(a) * rr);
        leaves.castShadow = true;
        group.add(leaves);
        parts.push({ mesh: leaves, ox: leaves.position.x, oy, oz: leaves.position.z });
      }
    }

    group.position.set(x, this.getGroundY(x, z), z);
    this.scene.add(group);

    const col = { x, z, radius: 0.7 * ws };
    this.obstacles.push(col);
    // 重生函式：在原地長回同型、同叢屬性的樹
    const respawn = () => this._makeTree(x, z, type, grove);
    this._registerDestructible(group, x, z, 1.6 * ws, parts, col, respawn);

    // 三五棵成叢：非叢生成員時，有機率在周圍再長 2~4 棵 (同型或相近型)
    if (!grove && Math.random() < 0.5) {
      const extra = 2 + Math.floor(Math.random() * 3); // 2~4 棵
      for (let i = 0; i < extra; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = (1.5 + Math.random() * 2.5) * ws; // 依樹寬散開
        const nx = x + Math.cos(a) * d;
        const nz = z + Math.sin(a) * d;
        if (Math.abs(nx) > this.bound - 4 || Math.abs(nz) > this.bound - 4) continue;
        // 同叢多為同型，偶爾混一棵不同型
        const ntype = Math.random() < 0.7 ? type : Math.floor(Math.random() * 5);
        this._makeTree(nx, nz, ntype, true);
      }
    }
  }

  // 石頭：分大 / 中 / 小三種，皆可炸開。大石頭像房子一樣分件炸開。
  _makeRock(x, z, sizeTier) {
    if (sizeTier === undefined) {
      const t = Math.random();
      sizeTier = t < 0.5 ? "small" : t < 0.85 ? "medium" : "large";
    }
    const gy = this.getGroundY(x, z);
    const rockMat = () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x888888).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12),
      flatShading: true, roughness: 0.95,
    });

    if (sizeTier === "large") {
      // 大石：由多顆大石塊堆成 (最大如房子)，每塊獨立可破壞 (分件炸開)
      const baseR = 4.5 + Math.random() * 1.5; // 碰撞半徑，接近房子
      const blockN = 6 + Math.floor(Math.random() * 4);
      for (let i = 0; i < blockN; i++) {
        const br = 1.6 + Math.random() * 1.8;
        const g = new THREE.Group();
        const ang = Math.random() * Math.PI * 2;
        const rr = Math.random() * baseR * 0.7;
        const wx = x + Math.cos(ang) * rr;
        const wz = z + Math.sin(ang) * rr;
        const wy = gy + br * (0.3 + Math.random() * 0.5);
        g.position.set(wx, wy, wz);
        const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(br, 0), rockMat());
        mesh.rotation.set(Math.random(), Math.random(), Math.random());
        mesh.castShadow = true; mesh.receiveShadow = true;
        g.add(mesh);
        this.scene.add(g);
        // 每塊自成一個 destructible (爆炸只炸近的塊)，共用整體碰撞
        this._registerDestructible(g, wx, wz, br, [{ mesh, ox: 0, oy: 0, oz: 0 }], null);
      }
      this.obstacles.push({ x, z, radius: baseR });
      return;
    }

    // 中 / 小石：整體一個 destructible，內含數塊碎石 (一次全炸開)
    const group = new THREE.Group();
    const parts = [];
    const cfg = sizeTier === "medium"
      ? { main: 1.6 + Math.random() * 0.8, chunks: 2 + Math.floor(Math.random() * 2) }
      : { main: 0.8 + Math.random() * 0.5, chunks: 1 + Math.floor(Math.random() * 2) };

    const main = new THREE.Mesh(new THREE.DodecahedronGeometry(cfg.main, 0), rockMat());
    main.position.set(0, cfg.main * 0.5, 0);
    main.rotation.set(Math.random(), Math.random(), Math.random());
    main.castShadow = true; main.receiveShadow = true;
    group.add(main);
    parts.push({ mesh: main, ox: 0, oy: cfg.main * 0.5, oz: 0 });

    for (let i = 0; i < cfg.chunks; i++) {
      const cr = cfg.main * (0.4 + Math.random() * 0.35);
      const chunk = new THREE.Mesh(new THREE.DodecahedronGeometry(cr, 0), rockMat());
      const a = Math.random() * Math.PI * 2;
      const ox = Math.cos(a) * cfg.main * 0.8;
      const oz = Math.sin(a) * cfg.main * 0.8;
      const oy = cr * 0.5;
      chunk.position.set(ox, oy, oz);
      chunk.rotation.set(Math.random(), Math.random(), Math.random());
      chunk.castShadow = true;
      group.add(chunk);
      parts.push({ mesh: chunk, ox, oy, oz });
    }

    group.position.set(x, gy, z);
    this.scene.add(group);
    const col = { x, z, radius: cfg.main };
    this.obstacles.push(col);
    this._registerDestructible(group, x, z, cfg.main + 0.4, parts, col);
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
