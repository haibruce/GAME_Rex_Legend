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

    // ---- 開場龍捲風視覺：多層旋轉雲氣 + 隨機煙霧 (流體流動感，非漏斗) ----
    this.tornadoTimer = 0;
    this.tornado = new THREE.Group();
    this.tornado.visible = false;
    const L = CONFIG.lightning;
    // 一大群半透明煙霧球，分布在不同高度與半徑，各自繞圈 + 上升 + 脈動
    this.tornadoPuffs = [];
    const puffN = 46;
    for (let i = 0; i < puffN; i++) {
      const size = 1.4 + Math.random() * 2.6;
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(size, 7, 6),
        new THREE.MeshBasicMaterial({
          // 灰白到淡藍的雲氣色
          color: new THREE.Color().setHSL(0.55, 0.15 + Math.random() * 0.2, 0.7 + Math.random() * 0.2),
          transparent: true, opacity: 0.12 + Math.random() * 0.12, depthWrite: false,
        })
      );
      puff.userData = {
        a: Math.random() * Math.PI * 2,               // 目前繞轉角度
        rad: 1.5 + Math.random() * (L.tornadoRadius * 0.85), // 繞轉半徑
        y: 0.5 + Math.random() * 13,                  // 高度
        spin: (0.6 + Math.random() * 1.2),            // 個別轉速倍率
        rise: 0.6 + Math.random() * 1.6,              // 上升速度
        wob: Math.random() * Math.PI * 2,             // 飄動相位
        baseSize: size,
      };
      this.tornado.add(puff);
      this.tornadoPuffs.push(puff);
    }
    this.scene.add(this.tornado);
  }

  get ready() {
    return this.cooldown <= 0 && !this.active;
  }

  cast() {
    if (!this.ready) return false;
    this.active = true;
    // 施法總長 = 龍捲風 + 落雷
    this.tornadoTimer = CONFIG.lightning.tornadoDuration;
    this.timer = CONFIG.lightning.duration + CONFIG.lightning.tornadoDuration;
    // 冷卻從「施法結束」開始算，不再把施法時間疊進去
    this.cooldown = CONFIG.lightning.cooldown;
    this.strikeAcc = 0;
    this.tornado.visible = true;
    return true;
  }

  // player: 需要 pos 與 facing; slimes: 陣列; onKill: 擊殺回呼; world: 取地面高度
  update(dt, player, slimes, world, onKill) {
    // 冷卻只在「非施法」時才遞減 (施法期間不算冷卻)
    if (!this.active && this.cooldown > 0) this.cooldown -= dt;

    // 施法中
    if (this.active) {
      this.timer -= dt;
      const L = CONFIG.lightning;

      // 龍捲風與落雷「同時」進行 (無先後)
      if (this.tornadoTimer > 0) {
        this.tornadoTimer -= dt;
        this._updateTornado(dt, player, slimes, onKill);
        if (this.tornadoTimer <= 0) this.tornado.visible = false;
      }
      // 落雷 (整個施法期間都落，與龍捲風並行)
      this.strikeAcc += dt;
      while (this.strikeAcc >= L.strikeInterval) {
        this.strikeAcc -= L.strikeInterval;
        const n = (L.boltsPerWave || 1) + (this.level - 1) * (L.boltsPerLevel || 0);
        for (let i = 0; i < n; i++) {
          this._strike(player, slimes, world, onKill);
        }
      }
      if (this.timer <= 0) { this.active = false; this.tornado.visible = false; }
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

  // 龍捲風：範圍內怪物繞玩家旋轉 + 往中心拉近 + 持續扣血；同時轉動視覺
  _updateTornado(dt, player, slimes, onKill) {
    const L = CONFIG.lightning;
    const cx = player.pos.x, cz = player.pos.z;

    // 視覺：整團定位到玩家；每球繞圈旋轉 + 緩慢上升 + 隨機飄動 + 脈動 (雲氣流體感)
    this.tornado.position.set(cx, player.pos.y, cz);
    const now = performance.now() * 0.001;
    for (const puff of this.tornadoPuffs) {
      const d = puff.userData;
      // 越靠上轉越快，營造捲動；半徑隨高度略微收束
      d.a += dt * L.tornadoSpin * d.spin * (0.6 + d.y / 14);
      d.y += dt * d.rise;
      if (d.y > 14) { d.y = 0.5; d.a = Math.random() * Math.PI * 2; } // 循環回底部
      const wob = Math.sin(now * 1.5 + d.wob) * 1.2;               // 飄動
      const rr = d.rad * (1 - d.y / 22) + wob;                     // 上方略收束
      puff.position.set(Math.cos(d.a) * rr, d.y, Math.sin(d.a) * rr);
      // 脈動縮放 + 淡入淡出，像流動的雲氣
      const pulse = 1 + Math.sin(now * 2 + d.wob) * 0.25;
      puff.scale.setScalar(pulse);
      puff.material.opacity = (0.1 + 0.12 * Math.abs(Math.sin(now + d.wob))) * (1 - d.y / 18);
    }

    // 怪物：捲入範圍內的 (排除大 Boss) 繞玩家旋轉並被往中心拉、持續受傷
    for (const s of slimes) {
      if (!s.alive || s.isMega || s.launched) continue;
      let dx = s.pos.x - cx, dz = s.pos.z - cz;
      let dist = Math.hypot(dx, dz);
      if (dist > L.tornadoRadius || dist < 0.2) continue;

      let ang = Math.atan2(dz, dx);
      ang += L.tornadoSpin * dt;                  // 旋轉
      dist = Math.max(1.5, dist - L.tornadoPull * dt); // 往中心拉 (不完全吸到中心)
      s.pos.x = cx + Math.cos(ang) * dist;
      s.pos.z = cz + Math.sin(ang) * dist;

      // 持續傷害
      const before = s.alive;
      s.health -= L.tornadoDps * this.damageMultiplier * dt;
      s.hitFlash = 0.1;
      if (s.health <= 0 && before) {
        s.alive = false;
        s.deathTimer = 0.4;
        s.justDied = true; // 計分由 main 掃描
      }
    }
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

// 火焰魔法：持續施放時從角色前方噴出「史詩級火焰衝擊波」。
// 玩法保持不變 (方向性長條範圍傷害)，視覺升級為：
//   白色能量核心 + 橘紅火焰層 + 明亮黃火花 + 厚重黑煙環 + 漂浮發光餘燼 + 擴張衝擊波環。
export class FlameMagic {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.damageMultiplier = 1; // 由經驗值系統設定
    this.level = 1;
    this.curLength = CONFIG.flame.baseLength;
    this.curWidth = CONFIG.flame.baseWidth;
    this._clock = 0; // 累積時間，驅動脈動/擴張
    this._knockTimers = new Map(); // 每隻怪的吹飛計時 (持續被噴到時定期吹飛)

    const F = CONFIG.flame;
    this.group = new THREE.Group();
    this.group.visible = false;

    // Additive 混色讓火焰疊加處更亮、更有能量感
    const addMat = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // ---- 噴口能量核心：白熱球 (最亮)，位於角色前方發射點 ----
    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), addMat(0xffffff, 0.95));
    this.group.add(this.core);
    // 核心外圈橘黃光暈
    this.coreGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), addMat(0xffd24a, 0.6));
    this.group.add(this.coreGlow);

    // ---- 外層火焰主體 (長條噴流)：橘紅，半透明疊加 ----
    this.beamMat = addMat(F.color, 0.32);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 1, 14, 1, true), this.beamMat);
    this.beam.rotation.x = Math.PI / 2; // 圓柱沿 +Z 噴出
    this.group.add(this.beam);

    // ---- 內層亮核噴流：黃白，較細 ----
    this.innerMat = addMat(0xffe08a, 0.5);
    this.inner = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 1, 12, 1, true), this.innerMat);
    this.inner.rotation.x = Math.PI / 2;
    this.group.add(this.inner);

    // ---- 擴張衝擊波環 (球形向外擴張感)：數個環，循環由核心向外脹大並淡出 ----
    this.shockRings = [];
    for (let i = 0; i < 3; i++) {
      const ringMat = addMat(0xffb24a, 0.0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.14, 8, 24), ringMat);
      ring.userData.phase = i / 3; // 錯開相位，形成連續脈衝
      this.group.add(ring);
      this.shockRings.push(ring);
    }

    // ---- 火焰/火花粒子群：沿噴流前進，橘紅與亮黃交錯 ----
    this.balls = [];
    for (let i = 0; i < 30; i++) {
      const warm = i % 3 === 0 ? 0xffe14a : (i % 3 === 1 ? F.color : 0xff8a2a);
      const b = new THREE.Mesh(
        new THREE.SphereGeometry(0.18 + Math.random() * 0.34, 7, 6),
        addMat(warm, 0.9)
      );
      b.userData = { t: Math.random(), off: (Math.random() - 0.5), rise: Math.random() };
      this.group.add(b);
      this.balls.push(b);
    }

    // ---- 明亮黃火花 (更小更快、閃爍) ----
    this.sparks = [];
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 + Math.random() * 0.1, 5, 4),
        addMat(0xfff2a0, 1.0)
      );
      s.userData = { t: Math.random(), ox: (Math.random() - 0.5), oy: (Math.random() - 0.5), spd: 1.4 + Math.random() * 1.4 };
      this.group.add(s);
      this.sparks.push(s);
    }

    // ---- 厚重黑煙環：深灰黑球，常規混色 (非 additive) 以呈現「厚重遮擋」感，沿噴流尾段上飄 ----
    this.smoke = [];
    for (let i = 0; i < 16; i++) {
      const sm = new THREE.Mesh(
        new THREE.SphereGeometry(0.6 + Math.random() * 0.7, 7, 6),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.06, 0.2, 0.06 + Math.random() * 0.06),
          transparent: true, opacity: 0.0, depthWrite: false,
        })
      );
      sm.userData = { t: Math.random(), ang: Math.random() * Math.PI * 2, rise: 0.6 + Math.random() * 0.8 };
      this.group.add(sm);
      this.smoke.push(sm);
    }

    // ---- 漂浮發光餘燼：微小亮點，緩慢上升飄散 ----
    this.embers = [];
    for (let i = 0; i < 20; i++) {
      const e = new THREE.Mesh(
        new THREE.SphereGeometry(0.05 + Math.random() * 0.06, 4, 3),
        addMat(0xffc24a, 0.9)
      );
      e.userData = { t: Math.random(), ox: (Math.random() - 0.5), oz: (Math.random() - 0.5), rise: 0.8 + Math.random() * 1.0, drift: (Math.random() - 0.5) };
      this.group.add(e);
      this.embers.push(e);
    }

    // 動態燈光：核心的白熱光 + 外圈橘光
    this.light = new THREE.PointLight(0xffb050, 0, 22);
    this.group.add(this.light);
    this.coreLight = new THREE.PointLight(0xffffff, 0, 10);
    this.group.add(this.coreLight);

    scene.add(this.group);
  }

  // 依等級計算目前火焰長寬，並套用到各視覺層的尺寸
  _applyLevel(level) {
    const F = CONFIG.flame;
    this.level = level;
    // 範圍：平緩線性成長，並夾在上限內 (封頂, 避免高等變成全地圖攻擊)。
    // 攻擊力 (dps) 另在傷害段計算，不受此上限限制。
    this.curLength = Math.min(F.maxLength, F.baseLength + (level - 1) * F.lengthPerLevel);
    this.curWidth = Math.min(F.maxWidth, F.baseWidth + (level - 1) * F.widthPerLevel);
    const len = this.curLength;
    const w = this.curWidth;

    // 噴流圓柱沿 +Z 延伸 (圓柱預設沿 y，已旋轉成 z)：scale y = 長度
    this.beam.scale.set(w * 0.9, len, w * 0.9);
    this.beam.position.z = len / 2;
    this.inner.scale.set(w * 0.55, len, w * 0.55);
    this.inner.position.z = len / 2;

    // 白色能量核心：固定大小 (不隨等級變大)
    const cr = Math.max(0.6, F.baseWidth * 0.5);
    this.core.scale.setScalar(cr);
    this.coreGlow.scale.setScalar(cr * 1.8);
  }

  // 持續施放：holding=true 時噴火並造成傷害。level 決定範圍大小。
  update(dt, holding, player, slimes, onKill, level) {
    this.active = holding;
    this.group.visible = holding;
    if (!holding) {
      this.light.intensity = 0;
      this.coreLight.intensity = 0;
      if (this._knockTimers.size > 0) this._knockTimers.clear();
      return;
    }

    const F = CONFIG.flame;
    this._applyLevel(level || 1);
    this._clock += dt;
    const T = this._clock;
    const len = this.curLength;
    const w = this.curWidth;
    const halfW = this.curWidth / 2;

    // 火焰從角色前方發出
    const fwd = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing));
    const rightV = new THREE.Vector3(Math.cos(player.facing), 0, -Math.sin(player.facing));
    this.group.position.set(
      player.pos.x + fwd.x * 0.7,
      player.pos.y + 1.3,
      player.pos.z + fwd.z * 0.7
    );
    this.group.rotation.y = player.facing;

    // 整體能量脈動 (快速閃爍 + 慢速起伏，營造電影衝擊感)
    const flick = 0.8 + Math.random() * 0.35;
    const pulse = 0.85 + Math.sin(T * 9) * 0.15;

    // 噴口核心：白熱 + 橘光暈，脈動縮放 (大小固定，不隨等級變大)
    const coreBase = Math.max(0.6, F.baseWidth * 0.5);
    this.core.material.opacity = (0.85 + Math.random() * 0.15);
    this.core.scale.setScalar(coreBase * (0.9 + Math.sin(T * 14) * 0.12));
    this.coreGlow.material.opacity = 0.5 * flick;

    // 噴流本體閃爍
    this.beamMat.opacity = 0.3 * flick;
    this.innerMat.opacity = 0.5 * flick;

    // 動態燈光
    this.light.intensity = 9 * flick;
    this.light.position.set(0, 0, len * 0.35);
    this.coreLight.intensity = 6 * pulse;
    this.coreLight.position.set(0, 0, 0.3);

    // ---- 擴張衝擊波環：由核心向外脹大並淡出，循環 (球形衝擊波感) ----
    for (const ring of this.shockRings) {
      ring.userData.phase += dt * 1.3;
      if (ring.userData.phase > 1) ring.userData.phase -= 1;
      const k = ring.userData.phase;              // 0→1 擴張進度
      const rr = 0.4 + k * (len * 0.5);           // 半徑向外脹大
      ring.scale.set(rr, rr, Math.max(0.4, w * 0.4));
      ring.position.z = k * len * 0.5;            // 同時沿噴流推進
      ring.rotation.z = T * 2 + ring.userData.phase * 6;
      ring.material.opacity = 0.5 * (1 - k) * flick; // 越外越淡
    }

    // ---- 火焰粒子：沿噴流前進、翻滾、淡出 ----
    for (const b of this.balls) {
      b.userData.t += dt * 1.7;
      if (b.userData.t > 1) b.userData.t -= 1;
      const t = b.userData.t;
      const spread = w * (0.3 + t * 0.5); // 越往前越擴散 (錐形噴流)
      b.position.set(
        b.userData.off * spread + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.6 + b.userData.rise * 0.4 * t,
        t * len
      );
      b.scale.setScalar((1 - t * 0.5) * (0.8 + Math.random() * 0.4));
      b.material.opacity = 0.9 * (1 - t);
    }

    // ---- 明亮黃火花：更快、閃爍、往前噴濺 ----
    for (const s of this.sparks) {
      s.userData.t += dt * s.userData.spd;
      if (s.userData.t > 1) s.userData.t -= 1;
      const t = s.userData.t;
      s.position.set(
        s.userData.ox * w * (0.4 + t),
        s.userData.oy * w * 0.5 + t * 0.5,
        t * len * 1.05
      );
      s.material.opacity = (Math.random() > 0.3 ? 1 : 0.3) * (1 - t); // 閃爍
      s.scale.setScalar(1 - t * 0.6);
    }

    // ---- 厚重黑煙環：噴流尾段 (較前方 2/3 起) 升起，環狀旋繞、放大淡出 ----
    for (const sm of this.smoke) {
      sm.userData.t += dt * 0.7;
      if (sm.userData.t > 1) sm.userData.t -= 1;
      const t = sm.userData.t;
      sm.userData.ang += dt * 1.2;
      const alongZ = len * (0.45 + t * 0.55);          // 從中後段往前尾
      const ringR = w * 0.6 + t * w * 0.8;             // 環狀擴張
      sm.position.set(
        Math.cos(sm.userData.ang) * ringR,
        t * sm.userData.rise * 2.2,                    // 上飄
        alongZ
      );
      sm.scale.setScalar(0.8 + t * 1.6);
      // 先濃後散：中段最濃
      sm.material.opacity = 0.5 * Math.sin(t * Math.PI);
    }

    // ---- 漂浮發光餘燼：緩慢上升、側向飄散、閃爍淡出 ----
    for (const e of this.embers) {
      e.userData.t += dt * 0.5;
      if (e.userData.t > 1) e.userData.t -= 1;
      const t = e.userData.t;
      e.position.set(
        e.userData.ox * w + e.userData.drift * t * 2,
        t * e.userData.rise * 3.0,
        len * (0.3 + Math.random() * 0.5)
      );
      e.material.opacity = (0.9 * (1 - t)) * (Math.random() > 0.2 ? 1 : 0.4); // 閃爍餘燼
      e.scale.setScalar(1 - t * 0.5);
    }

    // 攻擊力隨等級加強：每秒傷害 = 基礎 + 每級增量，再乘魔法倍率
    const lvl = this.level;
    const dps = (F.dps + (lvl - 1) * (F.dpsPerLevel || 0)) * this.damageMultiplier;
    // 吹飛力道隨等級提升
    const kbSpeed = F.knockbackBase + (lvl - 1) * (F.knockbackPerLevel || 0);
    const seen = new Set();

    // 傷害：長條 (矩形) 範圍內的史萊姆持續扣血 (玩法不變) + 定期吹飛
    for (const slime of slimes) {
      if (!slime.alive) continue;
      // 已被吹飛中的怪 (拋物線飛行) 不重複處理
      if (slime.launched) continue;
      const dx = slime.pos.x - player.pos.x;
      const dz = slime.pos.z - player.pos.z;
      // 投影到前方軸(沿長條)與側向軸(寬度)
      const along = dx * fwd.x + dz * fwd.z;
      const side = dx * rightV.x + dz * rightV.z;
      if (along < 0 || along > len + slime.radius) continue;
      if (Math.abs(side) > halfW + slime.radius) continue;

      seen.add(slime);
      const before = slime.alive;
      slime.health -= dps * dt;
      slime.hitFlash = 0.1;
      if (slime.health <= 0 && before) {
        slime.alive = false;
        slime.deathTimer = 0.4;
        slime.justDied = true; // 計分由 main 的 justDied 掃描統一處理
        this._knockTimers.delete(slime);
        continue;
      }

      // ---- 吹飛：持續被噴到的怪物, 每隔 knockbackInterval 被往前吹飛一次 ----
      // 大 Boss 太重, 不吹飛 (維持可被火燒但不會被推開)
      if (slime.isMega || typeof slime.launch !== "function") continue;
      const acc = (this._knockTimers.get(slime) || 0) + dt;
      if (acc >= (F.knockbackInterval || 0.5)) {
        this._knockTimers.set(slime, 0);
        // 吹飛方向 = 火焰前方 + 一點側向散開, 力道隨等級
        const spread = (Math.random() - 0.5) * 0.5;
        const vx = (fwd.x + rightV.x * spread) * kbSpeed;
        const vz = (fwd.z + rightV.z * spread) * kbSpeed;
        slime.launch(new THREE.Vector3(vx, F.knockbackUp, vz), F.knockbackDamage * this.damageMultiplier);
      } else {
        this._knockTimers.set(slime, acc);
      }
    }

    // 清掉已離開火焰範圍的怪物計時 (避免 Map 無限長 + 重新進入時立刻可被吹飛)
    if (this._knockTimers.size > 0) {
      for (const key of this._knockTimers.keys()) {
        if (!seen.has(key)) this._knockTimers.delete(key);
      }
    }
  }
}

// 劍氣：連段第 5 段射出的飛行斬擊，沿前方直線飛行，對路徑上的敵人造成傷害。
export class SwordWave {
  constructor(scene, origin, facing, short = false) {
    this.scene = scene;
    const W = CONFIG.swordWave;
    // 依 short 選用短/長劍氣參數
    this.speed = short ? W.shortSpeed : W.speed;
    this.range = short ? W.shortRange : W.range;
    this.width = short ? W.shortWidth : W.width;
    this.damage = short ? W.shortDamage : W.damage;
    this.facing = facing;
    this.fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    this.origin = origin.clone();
    this.pos = origin.clone();
    this.travelled = 0;
    this.done = false;
    this.hitSet = new Set(); // 已命中的敵人 (避免重複扣血)

    // 外觀：一片彎月形的半透明薄片 (短劍氣較小)
    this.group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: W.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    this.mat = mat;
    const blade = new THREE.Mesh(new THREE.TorusGeometry(this.width * 0.9, short ? 0.22 : 0.35, 6, 12, Math.PI), mat);
    blade.rotation.x = Math.PI / 2;
    this.group.add(blade);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width * 2, short ? 1.2 : 2),
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
    const step = this.speed * dt;
    this.pos.x += this.fwd.x * step;
    this.pos.z += this.fwd.z * step;
    this.travelled += step;
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);

    // 命中判定：敵人在劍氣當前位置的寬度內
    for (const e of enemies) {
      if (!e.alive || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      if (dx * dx + dz * dz <= (this.width + e.radius) * (this.width + e.radius)) {
        e.takeDamage(this.damage, this.origin);
        this.hitSet.add(e);
      }
    }

    // 淡出 + 到達最遠距離則結束
    const k = this.travelled / this.range;
    this.mat.opacity = 0.85 * (1 - k);
    if (this.travelled >= this.range) this.done = true;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
