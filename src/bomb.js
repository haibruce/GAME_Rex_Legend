import * as THREE from "three";
import { CONFIG } from "./config.js";

// 單顆炸彈道具：靜置地面 → 玩家靠近觸發 → 引信倒數閃爍 → 超大規模爆炸。
class Bomb {
  constructor(scene, x, z, world) {
    this.scene = scene;
    this.x = x;
    this.z = z;
    this.y = world.getGroundY(x, z);
    this.triggered = false;
    this.fuse = CONFIG.bomb.fuse;
    this.exploded = false;
    this.done = false;
    this.blastT = 0;

    this.group = new THREE.Group();

    // 炸彈本體 (黑球 + 引信)
    this.bodyMat = new THREE.MeshStandardMaterial({ color: CONFIG.bomb.color, roughness: 0.5 });
    this.body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), this.bodyMat);
    this.body.position.y = 0.6;
    this.body.castShadow = true;
    this.group.add(this.body);

    const fuseTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.3, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a6a3a })
    );
    fuseTop.position.y = 1.3;
    this.group.add(fuseTop);

    // 引信火花 (觸發後亮起)
    this.spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc33 })
    );
    this.spark.position.y = 1.5;
    this.spark.visible = false;
    this.group.add(this.spark);

    // ---- 多層爆炸特效 (爆炸時才顯示) ----
    this.fx = new THREE.Group();
    this.fx.visible = false;
    this.group.add(this.fx);

    // 1. 核心白熱閃光
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
    );
    this.fx.add(this.core);

    // 2. 火球層 橘紅兩層
    this.fireball1 = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.95 })
    );
    this.fx.add(this.fireball1);
    this.fireball2 = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff4a1a, transparent: true, opacity: 0.85 })
    );
    this.fx.add(this.fireball2);

    // 3. 地面衝擊波環 兩圈
    this.shock1 = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    this.shock1.rotation.x = -Math.PI / 2;
    this.shock1.position.y = 0.2;
    this.fx.add(this.shock1);
    this.shock2 = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    this.shock2.rotation.x = -Math.PI / 2;
    this.shock2.position.y = 0.15;
    this.fx.add(this.shock2);

    // 4. 火焰簇 往上竄的火舌
    this.flames = [];
    for (let i = 0; i < 16; i++) {
      const f = new THREE.Mesh(
        new THREE.ConeGeometry(0.7, 2.6, 6),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff7a1a : 0xffc23a, transparent: true, opacity: 0.9 })
      );
      const a = (i / 16) * Math.PI * 2;
      f.userData = { a, r: 2 + Math.random() * 4, sp: 0.5 + Math.random() * 0.5 };
      this.fx.add(f);
      this.flames.push(f);
    }

    // 5. 煙霧雲 灰色球往上飄散 (數量加大)
    this.smoke = [];
    for (let i = 0; i < 20; i++) {
      const sm = new THREE.Mesh(
        new THREE.SphereGeometry(1, 7, 7),
        new THREE.MeshBasicMaterial({ color: (0x40 + Math.floor(Math.random() * 0x30)) * 0x010101, transparent: true, opacity: 0.6 })
      );
      const a = Math.random() * Math.PI * 2;
      sm.userData = {
        a, r: Math.random() * 5,
        vy: 1.5 + Math.random() * 2.5,
        size: 2 + Math.random() * 2.5,
      };
      this.fx.add(sm);
      this.smoke.push(sm);
    }

    // 5b. 初爆火花：前 0.5 秒大量往外噴的小火花 (固定數量，用便宜的小球)
    this.sparks = [];
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Mesh(
        new THREE.SphereGeometry(0.25, 5, 5),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffffff : (i % 2 ? 0xffd24a : 0xff6a1a), transparent: true, opacity: 1 })
      );
      // 隨機 3D 方向 + 速度
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.6; // 偏上半球
      const speed = 12 + Math.random() * 20;
      sp.userData = {
        vx: Math.cos(theta) * Math.cos(phi) * speed,
        vy: Math.sin(phi) * speed + 6,
        vz: Math.sin(theta) * Math.cos(phi) * speed,
      };
      this.fx.add(sp);
      this.sparks.push(sp);
    }

    // 6. 爆炸強光
    this.blastLight = new THREE.PointLight(0xffaa44, 0, 40);
    this.blastLight.position.y = 3;
    this.fx.add(this.blastLight);

    this.group.position.set(x, this.y, z);
    scene.add(this.group);
  }

  // 回傳：若這幀發生爆炸，回傳 {x, z, radius, damage}，否則 null
  update(dt, playerPos, onExplode) {
    if (this.done) return;

    // 爆炸動畫進行中 (多層特效)
    if (this.exploded) {
      const B = CONFIG.bomb;
      const dur = B.blastDuration;
      this.blastT += dt;
      const k = Math.min(1, this.blastT / dur); // 0→1
      const R = B.blastRadius;

      // 核心白閃：瞬間爆開後快速消失
      const coreK = Math.min(1, this.blastT / (dur * 0.2));
      this.core.scale.setScalar(R * 0.4 * coreK);
      this.core.material.opacity = Math.max(0, 1 - coreK);

      // 火球兩層：擴張到最大再淡出
      const fbEase = 1 - Math.pow(1 - k, 2);
      this.fireball1.scale.setScalar(R * 0.75 * fbEase);
      this.fireball1.material.opacity = 0.95 * (1 - k);
      this.fireball2.scale.setScalar(R * 0.95 * fbEase);
      this.fireball2.material.opacity = 0.85 * (1 - k * 1.1);

      // 衝擊波環：快速往外擴張
      const s1 = R * Math.min(1, k * 1.5);
      this.shock1.scale.setScalar(s1);
      this.shock1.material.opacity = 0.9 * (1 - Math.min(1, k * 1.5));
      const s2 = R * Math.min(1, k * 1.1);
      this.shock2.scale.setScalar(s2);
      this.shock2.material.opacity = 0.7 * (1 - Math.min(1, k * 1.1));

      // 火焰簇：往外竄開、上下跳動、逐漸縮小
      for (const f of this.flames) {
        const d = f.userData;
        const rr = d.r * fbEase;
        f.position.set(Math.cos(d.a) * rr, 1 + Math.sin(this.blastT * 8 * d.sp) * 0.6, Math.sin(d.a) * rr);
        const fs = (1 - k) * (1.5 + Math.sin(this.blastT * 10 * d.sp) * 0.4);
        f.scale.setScalar(Math.max(0.01, fs));
        f.material.opacity = 0.9 * (1 - k);
      }

      // 煙霧：往外飄、往上升、逐漸變大變淡
      for (const sm of this.smoke) {
        const d = sm.userData;
        const rr = d.r + k * R * 0.5;
        sm.position.set(Math.cos(d.a) * rr, this.blastT * d.vy, Math.sin(d.a) * rr);
        sm.scale.setScalar(d.size * (0.5 + k * 1.5));
        sm.material.opacity = 0.6 * (1 - k);
      }

      // 初爆火花：只在前 0.5 秒活躍，之後隱藏 (省效能，不影響後續)
      const sparkLife = 0.5;
      if (this.blastT <= sparkLife) {
        const sk = this.blastT / sparkLife; // 0→1
        for (const sp of this.sparks) {
          const d = sp.userData;
          // 拋物線飛散
          sp.position.set(
            d.vx * this.blastT,
            d.vy * this.blastT - 20 * this.blastT * this.blastT,
            d.vz * this.blastT
          );
          sp.material.opacity = 1 - sk;
          sp.scale.setScalar(1 - sk * 0.5);
          sp.visible = true;
        }
      } else if (this._sparksHidden !== true) {
        this._sparksHidden = true;
        for (const sp of this.sparks) sp.visible = false;
      }

      // 強光：瞬間亮起後衰減
      this.blastLight.intensity = 30 * Math.max(0, 1 - this.blastT / (dur * 0.5));

      if (this.blastT >= dur) this.done = true;
      return;
    }

    // 未觸發：偵測玩家靠近
    if (!this.triggered) {
      const d = Math.hypot(playerPos.x - this.x, playerPos.z - this.z);
      if (d <= CONFIG.bomb.triggerRadius) {
        this.triggered = true;
        this.spark.visible = true;
      }
      // 未觸發時輕微漂浮動畫
      this.body.position.y = 0.6 + Math.sin(performance.now() * 0.003) * 0.08;
      return;
    }

    // 引信倒數：閃爍加速
    this.fuse -= dt;
    const blink = Math.sin(performance.now() * (0.01 + (CONFIG.bomb.fuse - this.fuse) * 0.02));
    this.spark.visible = blink > 0;
    // 越接近爆炸，本體越紅
    const t = 1 - this.fuse / CONFIG.bomb.fuse;
    this.bodyMat.color.setRGB(0.13 + t * 0.8, 0.13, 0.13);

    if (this.fuse <= 0) {
      this._explode(onExplode);
    }
  }

  _explode(onExplode) {
    this.exploded = true;
    this.blastT = 0;
    this.body.visible = false;
    this.spark.visible = false;
    this.fx.visible = true;
    // 通知外部處理範圍擊飛/傷害
    if (onExplode) {
      onExplode(this.x, this.z, CONFIG.bomb.blastRadius, CONFIG.bomb.damage, CONFIG.bomb.playerDamage);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.body.geometry.dispose();
    this.bodyMat.dispose();
  }
}

// 炸彈管理器：定時在地上隨機生成炸彈，處理觸發、爆炸與範圍傷害。
export class BombManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.bombs = [];
    this.thrown = [];       // 飛行中的投擲炸彈
    this.spawnTimer = 0;
    this.maxOnField = CONFIG.bomb.maxOnField; // 可由選單調整
    this.inventory = 0;     // 身上庫存的炸彈數 (無上限)
  }

  reset() {
    for (const b of this.bombs) b.dispose();
    for (const t of this.thrown) t.dispose();
    this.bombs = [];
    this.thrown = [];
    this.spawnTimer = 0;
    this.inventory = 0;
  }

  // 身邊是否有「未觸發」且在拾取範圍內的炸彈
  _nearestPickable(playerPos) {
    let best = null, bestD = CONFIG.bomb.pickupRadius;
    for (const b of this.bombs) {
      if (b.done || b.exploded || b.triggered) continue; // 已觸發/爆炸的不能收
      const d = Math.hypot(playerPos.x - b.x, playerPos.z - b.z);
      if (d <= bestD) { best = b; bestD = d; }
    }
    return best;
  }

  // 身邊是否有可拾取炸彈 (供 HUD 提示)
  hasPickable(playerPos) {
    return this._nearestPickable(playerPos) !== null;
  }

  // 按 E：身邊有可拾取炸彈就收進庫存 (回傳 "pickup")；
  // 身邊沒有但庫存>0 就投擲 (回傳 "throw")；否則 null
  handleAction(playerPos, facing) {
    const pick = this._nearestPickable(playerPos);
    if (pick) {
      pick.dispose();
      this.bombs = this.bombs.filter((b) => b !== pick);
      this.inventory++;
      return "pickup";
    }
    if (this.inventory > 0) {
      this.inventory--;
      this._throw(playerPos, facing);
      return "throw";
    }
    return null;
  }

  // 投擲炸彈：從玩家前方以拋物線飛出
  _throw(playerPos, facing) {
    const fwd = { x: Math.sin(facing), z: Math.cos(facing) };
    const t = new ThrownBomb(
      this.scene,
      playerPos.x + fwd.x * 0.8,
      playerPos.y + 1.4,
      playerPos.z + fwd.z * 0.8,
      fwd,
      this.world
    );
    this.thrown.push(t);
  }

  _randomPos() {
    const bound = this.world.bound - 8;
    let x, z;
    do {
      x = (Math.random() - 0.5) * bound * 2;
      z = (Math.random() - 0.5) * bound * 2;
    } while (Math.hypot(x, z) < 12); // 不生在出生點正中
    return { x, z };
  }

  // onExplode(x,z,radius,dmg,playerDmg)：由 main 處理實際傷害
  update(dt, playerPos, onExplode) {
    // 定時生成
    this.spawnTimer += dt;
    const activeCount = this.bombs.filter((b) => !b.done).length;
    if (this.maxOnField > 0 && this.spawnTimer >= CONFIG.bomb.spawnInterval && activeCount < this.maxOnField) {
      this.spawnTimer = 0;
      const p = this._randomPos();
      this.bombs.push(new Bomb(this.scene, p.x, p.z, this.world));
    }

    // 更新每顆
    for (const b of this.bombs) b.update(dt, playerPos, onExplode);

    // 更新投擲中的炸彈；落地 → 立即引爆
    for (const t of this.thrown) {
      const land = t.update(dt);
      if (land) {
        t.dispose();
        // 在落點生成一顆立即引爆的炸彈 (重用完整爆炸特效)
        const bomb = new Bomb(this.scene, land.x, land.z, this.world);
        bomb._explode(onExplode);
        this.bombs.push(bomb);
      }
    }
    this.thrown = this.thrown.filter((t) => !t.landed);

    // 清除已完成的
    this.bombs = this.bombs.filter((b) => {
      if (b.done) {
        b.dispose();
        return false;
      }
      return true;
    });
  }
}

// 投擲中的炸彈：拋物線飛行，落地回傳落點 {x,z}。
class ThrownBomb {
  constructor(scene, x, y, z, fwd, world) {
    this.scene = scene;
    this.world = world;
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3(
      fwd.x * CONFIG.bomb.throwSpeed,
      CONFIG.bomb.throwUp,
      fwd.z * CONFIG.bomb.throwSpeed
    );
    this.landed = false;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 10),
      new THREE.MeshStandardMaterial({ color: CONFIG.bomb.color, roughness: 0.5 })
    );
    this.mesh.castShadow = true;
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
    this.spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize();
  }

  update(dt) {
    if (this.landed) return null;
    this.vel.y -= CONFIG.bomb.throwGravity * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const b = this.world.bound;
    this.pos.x = Math.max(-b, Math.min(b, this.pos.x));
    this.pos.z = Math.max(-b, Math.min(b, this.pos.z));

    const groundY = this.world.getGroundY(this.pos.x, this.pos.z);
    this.mesh.position.copy(this.pos);
    this.mesh.rotateOnAxis(this.spin, 8 * dt);

    if (this.pos.y <= groundY && this.vel.y < 0) {
      this.landed = true;
      return { x: this.pos.x, z: this.pos.z };
    }
    return null;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
