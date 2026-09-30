import * as THREE from "three";
import { CONFIG } from "./config.js";

// 共用幾何/材質 (所有閃電共用同一份，避免大量 new 造成停頓)
const BOLT_TOP = 16;
let _boltGeo = null;
let _boltMat = null;
let _ringGeo = null;
let _ringMat = null;
function _ensureBoltAssets() {
  if (_boltGeo) return;
  const col = CONFIG.lightning.color;
  // 一根細長方柱當閃電柱 (比 Line+Cylinder 便宜)
  _boltGeo = new THREE.BoxGeometry(0.22, BOLT_TOP, 0.22);
  _boltMat = new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.9 });
  _ringGeo = new THREE.RingGeometry(0.2, CONFIG.lightning.boltRadius, 12);
  _ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
}

// 單道閃電特效：極簡 (一根柱 + 地面圈)，共用幾何材質，無獨立光源。
class Bolt {
  constructor(scene, x, y, z) {
    this.scene = scene;
    this.life = 0.3;
    this.maxLife = 0.3;
    _ensureBoltAssets();

    this.group = new THREE.Group();

    // 閃電柱 (共用幾何，材質 clone 一份以便獨立淡出)
    this.mat = _boltMat.clone();
    this.pillar = new THREE.Mesh(_boltGeo, this.mat);
    this.pillar.position.y = BOLT_TOP / 2;
    // 隨機扭一點角度，看起來不那麼死板
    this.pillar.rotation.z = (Math.random() - 0.5) * 0.3;
    this.group.add(this.pillar);

    // 地面衝擊圈 (共用幾何)
    this.ringMat = _ringMat.clone();
    this.ring = new THREE.Mesh(_ringGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.group.add(this.ring);

    this.group.position.set(x, y, z);
    scene.add(this.group);
  }

  update(dt) {
    this.life -= dt;
    const k = Math.max(0, this.life / this.maxLife);
    this.mat.opacity = 0.9 * k;
    this.ringMat.opacity = 0.8 * k;
    this.ring.scale.setScalar(1 + (1 - k) * 0.8);
    return this.life > 0;
  }

  dispose() {
    this.scene.remove(this.group);
    // 只 dispose clone 出來的材質，共用幾何不動
    this.mat.dispose();
    this.ringMat.dispose();
  }
}

// 閃電魔法管理器：施法期間在玩家前方隨機落雷並對史萊姆造成傷害。
export class LightningMagic {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.timer = 0;         // 施法剩餘時間
    this.cooldown = 0;      // 冷卻剩餘
    this.strikeAcc = 0;     // 落雷計時累加
    this.bolts = [];
    this.damageMultiplier = 1; // 由經驗值系統設定
    this.level = 1;            // 由經驗值系統設定

    // 施法籠罩效果：微降亮度的暗罩 + 黃光閃爍
    // 暗罩：一個朝下的大圓盤蓋在頭頂，半透明深色，讓範圍內視覺變暗
    this.dimDome = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({
        color: 0x101018, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.dimDome.rotation.x = Math.PI / 2; // 面朝下
    this.dimDome.visible = false;
    this.scene.add(this.dimDome);

    // 黃色閃爍點光 (施法期間籠罩玩家四周)
    this.auraLight = new THREE.PointLight(0xffd644, 0, 60);
    this.auraLight.visible = false;
    this.scene.add(this.auraLight);
  }

  get ready() {
    return this.cooldown <= 0 && !this.active;
  }

  cast() {
    if (!this.ready) return false;
    this.active = true;
    this.timer = CONFIG.lightning.duration;
    // 冷卻從「施法結束」開始算，不再把施法時間疊進去
    this.cooldown = CONFIG.lightning.cooldown;
    this.strikeAcc = 0;
    return true;
  }

  // player: 需要 pos 與 facing; slimes: 陣列; onKill: 擊殺回呼; world: 取地面高度
  update(dt, player, slimes, world, onKill) {
    // 冷卻只在「非施法」時才遞減 (施法期間不算冷卻)
    if (!this.active && this.cooldown > 0) this.cooldown -= dt;

    // 施法中：定時落雷
    if (this.active) {
      this.timer -= dt;
      this.strikeAcc += dt;
      const L = CONFIG.lightning;
      while (this.strikeAcc >= L.strikeInterval) {
        this.strikeAcc -= L.strikeInterval;
        // 一波落下多道雷，數量隨等級提升
        const n = (L.boltsPerWave || 1) + (this.level - 1) * (L.boltsPerLevel || 0);
        for (let i = 0; i < n; i++) {
          this._strike(player, slimes, world, onKill);
        }
      }
      if (this.timer <= 0) this.active = false;
    }

    // 施法籠罩效果：跟隨玩家、暗罩微降亮度 + 黃光閃爍
    if (this.active) {
      const auraR = Math.min(CONFIG.lightning.reachMax, CONFIG.lightning.forwardMax + (this.level - 1) * (CONFIG.lightning.spreadPerLevel || 0));
      const flick = 0.5 + Math.random() * 0.5; // 閃爍
      this.dimDome.visible = true;
      this.dimDome.scale.setScalar(auraR);
      this.dimDome.position.set(player.pos.x, player.pos.y + 8, player.pos.z);
      this.dimDome.material.opacity = 0.22; // 微降亮度

      this.auraLight.visible = true;
      this.auraLight.position.set(player.pos.x, player.pos.y + 3, player.pos.z);
      this.auraLight.intensity = 3 + flick * 4; // 黃光閃爍
      this.auraLight.distance = auraR * 1.5;
    } else if (this.dimDome.visible) {
      this.dimDome.visible = false;
      this.auraLight.visible = false;
    }

    // 更新既有閃電特效
    this.bolts = this.bolts.filter((b) => {
      const alive = b.update(dt);
      if (!alive) b.dispose();
      return alive;
    });
  }

  _strike(player, slimes, world, onKill) {
    const L = CONFIG.lightning;
    // 以玩家為圓心，360 度四周隨機落雷；半徑隨等級向外擴展 (有上限)
    const maxR = Math.min(L.reachMax, L.forwardMax + (this.level - 1) * (L.spreadPerLevel || 0));
    // 半徑用 sqrt 分布讓落點在圓面上較均勻
    const r = maxR * Math.sqrt(Math.random());
    const ang = Math.random() * Math.PI * 2;

    const x = player.pos.x + Math.cos(ang) * r;
    const z = player.pos.z + Math.sin(ang) * r;
    const y = world.getGroundY(x, z);

    this.bolts.push(new Bolt(this.scene, x, y, z));

    // 對範圍內史萊姆造成傷害
    for (const slime of slimes) {
      if (!slime.alive) continue;
      const d = Math.hypot(slime.pos.x - x, slime.pos.z - z);
      if (d <= L.boltRadius + slime.radius) {
        // takeDamage 內部會設 justDied，計分由 main 統一掃描 (不重複呼叫 onKill)
        slime.takeDamage(L.damage * this.damageMultiplier, { x, z });
      }
    }
  }
}

// 火焰魔法：持續施放時從角色前方噴出「長條形」火焰，範圍隨等級提升。
export class FlameMagic {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.damageMultiplier = 1; // 由經驗值系統設定
    this.level = 1;
    this.curLength = CONFIG.flame.baseLength;
    this.curWidth = CONFIG.flame.baseWidth;

    const F = CONFIG.flame;
    this.group = new THREE.Group();
    this.group.visible = false;

    // 長條形火焰主體 (box)，基準尺寸=1，之後用 scale 縮放到實際長寬
    this.beamMat = new THREE.MeshBasicMaterial({
      color: F.color, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), this.beamMat);
    this.group.add(this.beam);

    // 內層更亮的核心長條
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xffd24a, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    });
    this.core = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), this.coreMat);
    this.group.add(this.core);

    // 火球群 (沿長條方向翻滾)
    this.balls = [];
    for (let i = 0; i < 20; i++) {
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.3 + Math.random() * 0.3, 8, 8),
        new THREE.MeshBasicMaterial({ color: i % 2 ? F.color : 0xffb24a, transparent: true, opacity: 0.8 })
      );
      b.userData.t = Math.random();
      this.group.add(b);
      this.balls.push(b);
    }

    this.light = new THREE.PointLight(F.color, 0, 16);
    this.group.add(this.light);

    scene.add(this.group);
  }

  // 依等級計算目前火焰長寬
  _applyLevel(level) {
    const F = CONFIG.flame;
    this.level = level;
    this.curLength = F.baseLength + (level - 1) * F.lengthPerLevel;
    this.curWidth = F.baseWidth + (level - 1) * F.widthPerLevel;
    // 長條沿 +Z 延伸：box 的 z=長度、x=寬度
    this.beam.scale.set(this.curWidth, 1, this.curLength);
    this.beam.position.z = this.curLength / 2;
    this.core.scale.set(this.curWidth * 0.5, 1, this.curLength);
    this.core.position.z = this.curLength / 2;
  }

  // 持續施放：holding=true 時噴火並造成傷害。level 決定範圍大小。
  update(dt, holding, player, slimes, onKill, level) {
    this.active = holding;
    this.group.visible = holding;
    if (!holding) {
      this.light.intensity = 0;
      return;
    }

    const F = CONFIG.flame;
    this._applyLevel(level || 1);
    const len = this.curLength;
    const halfW = this.curWidth / 2;

    // 火焰從角色前方發出
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    const rightV = new THREE.Vector3(Math.cos(player.facing), 0, -Math.sin(player.facing));
    this.group.position.set(
      player.pos.x + fwd.x * 0.6,
      player.pos.y + 1.3,
      player.pos.z + fwd.z * 0.6
    );
    this.group.rotation.y = player.facing;

    // 閃爍 + 火球沿長條前進
    const flick = 0.8 + Math.random() * 0.4;
    this.beamMat.opacity = 0.3 * flick;
    this.coreMat.opacity = 0.5 * flick;
    this.light.intensity = 7 * flick;
    this.light.position.set(0, 0, len * 0.4);

    for (const b of this.balls) {
      b.userData.t += dt * 1.6;
      if (b.userData.t > 1) b.userData.t -= 1;
      const t = b.userData.t;
      b.position.set(
        (Math.random() - 0.5) * this.curWidth,
        (Math.random() - 0.5) * 0.6,
        t * len
      );
      b.scale.setScalar(1 - t * 0.4);
      b.material.opacity = 0.85 * (1 - t);
    }

    // 傷害：長條 (矩形) 範圍內的史萊姆持續扣血
    for (const slime of slimes) {
      if (!slime.alive) continue;
      const dx = slime.pos.x - player.pos.x;
      const dz = slime.pos.z - player.pos.z;
      // 投影到前方軸(沿長條)與側向軸(寬度)
      const along = dx * fwd.x + dz * fwd.z;
      const side = dx * rightV.x + dz * rightV.z;
      if (along < 0 || along > len + slime.radius) continue;
      if (Math.abs(side) > halfW + slime.radius) continue;

      const before = slime.alive;
      slime.health -= F.dps * this.damageMultiplier * dt;
      slime.hitFlash = 0.1;
      if (slime.health <= 0 && before) {
        slime.alive = false;
        slime.deathTimer = 0.4;
        slime.justDied = true; // 計分由 main 的 justDied 掃描統一處理
      }
    }
  }
}

// 劍氣：連段第 5 段射出的飛行斬擊，沿前方直線飛行，對路徑上的敵人造成傷害。
export class SwordWave {
  constructor(scene, origin, facing) {
    this.scene = scene;
    const W = CONFIG.swordWave;
    this.facing = facing;
    this.fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    this.origin = origin.clone();
    this.pos = origin.clone();
    this.travelled = 0;
    this.done = false;
    this.hitSet = new Set(); // 已命中的敵人 (避免重複扣血)

    // 外觀：一片彎月形的半透明薄片
    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: W.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    this.mat = mat;
    // 用一個扁平的環段當彎月
    const blade = new THREE.Mesh(new THREE.TorusGeometry(W.width * 0.9, 0.35, 6, 12, Math.PI), mat);
    blade.rotation.x = Math.PI / 2;
    this.group.add(blade);
    // 拖尾光暈
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(W.width * 2, 2),
      new THREE.MeshBasicMaterial({ color: W.color, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    );
    glow.rotation.x = -Math.PI / 2;
    this.group.add(glow);

    this.group.position.copy(this.pos);
    this.group.rotation.y = facing;
    scene.add(this.group);
  }

  update(dt, enemies) {
    if (this.done) return;
    const W = CONFIG.swordWave;
    const step = W.speed * dt;
    this.pos.x += this.fwd.x * step;
    this.pos.z += this.fwd.z * step;
    this.travelled += step;
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);

    // 命中判定：敵人在劍氣當前位置的寬度內
    for (const e of enemies) {
      if (!e.alive || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      if (dx * dx + dz * dz <= (W.width + e.radius) * (W.width + e.radius)) {
        e.takeDamage(W.damage, this.origin);
        this.hitSet.add(e);
      }
    }

    // 淡出 + 到達最遠距離則結束
    const k = this.travelled / W.range;
    this.mat.opacity = 0.85 * (1 - k);
    if (this.travelled >= W.range) this.done = true;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
