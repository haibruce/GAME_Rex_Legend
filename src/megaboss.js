import * as THREE from "three";
import { CONFIG } from "./config.js";

// 大 Boss：體型與血量遠超一般敵人，依種類擁有專屬技能。
// kind: "slime"(巨型史萊姆/震地) | "boss"(史萊姆之王/召喚) | "rabbit"(巨型兔王/飛撲)
// 與一般敵人共通介面相容：update/takeDamage/pos/radius/alive/attackDamage/justDied/shouldRemove/dispose
export class MegaBoss {
  constructor(scene, spawnPos, kind) {
    this.scene = scene;
    this.kind = kind;
    this.isMega = true;
    this.isBoss = true; // 沿用受擊等邏輯

    const s = CONFIG.slime;
    const M = CONFIG.megaBoss;
    this.radius = s.radius * M.scale;
    this.maxHealth = s.maxHealth * M.healthMult;
    this.health = this.maxHealth;
    this.speed = s.speed * M.speedMult;
    this.attackDamage = M.attackDamage;

    this.pos = spawnPos.clone();
    this.alive = true;
    this.attackTimer = 0;
    this.hitFlash = 0;
    this.deathTimer = 0;
    this.justDied = false;

    // 技能
    this.skillTimer = M.skillCooldown;
    this.skillDamagePending = 0; // main 每幀讀取套用到玩家的技能傷害
    this.skillDamageRadius = 0;
    this.skillOrigin = new THREE.Vector3();

    // 施放動畫狀態機
    this.casting = false;      // 是否在施放技能動畫中
    this.castT = 0;            // 動畫進度 (秒)
    this.castDuration = 1.1;   // 施放動畫總長
    this.castImpactDone = false; // 是否已在爆發幀觸發傷害
    this._pendingSkill = null; // 起手時記錄的技能資料

    // 擊飛狀態相容 (炸彈)
    this.launched = false;
    this.launchVel = new THREE.Vector3();
    this.pendingDamage = 0;

    // 召喚請求 (史萊姆之王用)，main 讀取後生成小怪
    this.summonRequest = 0;

    this.bouncePhase = Math.random() * Math.PI * 2;

    this._buildMesh();
    this._buildSkillFx();
  }

  _buildMesh() {
    const R = this.radius;
    this.group = new THREE.Group();

    const colors = { slime: 0x2f8f3a, boss: 0xc0392b, rabbit: 0x8a6d5a };
    this.baseColor = colors[this.kind] || 0x2f8f3a;
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: this.baseColor, transparent: true, opacity: 0.9, roughness: 0.4,
    });

    // 身體
    this.body = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 18), this.bodyMat);
    this.body.scale.y = 0.85;
    this.body.position.y = R * 0.85;
    this.body.castShadow = true;
    this.group.add(this.body);

    // 大眼睛 (兇惡感：紅瞳)
    const eyeW = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pupilM = new THREE.MeshStandardMaterial({ color: 0xcc0000, emissive: 0x550000 });
    for (const sx of [-0.35, 0.35]) {
      const ew = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 12, 12), eyeW);
      ew.position.set(sx * R, R * 1.05, R * 0.78);
      this.group.add(ew);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(R * 0.08, 10, 10), pupilM);
      pu.position.set(sx * R, R * 1.05, R * 0.9);
      this.group.add(pu);
    }

    // 種類標誌：兔王加大耳朵、史萊姆之王加皇冠
    if (this.kind === "rabbit") {
      for (const sx of [-0.3, 0.3]) {
        const ear = new THREE.Mesh(
          new THREE.CapsuleGeometry(R * 0.16, R * 1.4, 4, 8),
          this.bodyMat
        );
        ear.position.set(sx * R, R * 2.2, 0);
        ear.castShadow = true;
        this.group.add(ear);
      }
    } else if (this.kind === "boss") {
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(R * 0.5, R * 0.7, 5),
        new THREE.MeshStandardMaterial({ color: 0xffd447, metalness: 0.6, roughness: 0.3 })
      );
      crown.position.y = R * 1.9;
      this.group.add(crown);
    }

    // 血條 (大, 掛 scene)
    this.hpBar = new THREE.Group();
    const barW = R * 2.2;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x300000, depthTest: false, transparent: true })
    );
    bg.renderOrder = 999;
    this.hpBar.add(bg);
    this.hpFillMat = new THREE.MeshBasicMaterial({ color: 0xff3030, depthTest: false, transparent: true });
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(barW, 0.4), this.hpFillMat);
    this.hpFill.position.z = 0.001;
    this.hpFill.renderOrder = 1000;
    this.hpBarWidth = barW;
    this.hpBar.add(this.hpFill);
    this.hpBarYOffset = R * 2.6;
    this.scene.add(this.hpBar);

    this.group.position.copy(this.pos);
    this.scene.add(this.group);
  }

  _buildSkillFx() {
    // 技能範圍指示圈 (震地/落地衝擊共用)
    this.skillRing = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0xff5522, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    this.skillRing.rotation.x = -Math.PI / 2;
    this.skillRing.position.y = 0.1;
    this.skillRing.visible = false;
    this.scene.add(this.skillRing);
    this._ringT = 0;
    this._ringActive = false;
  }

  takeDamage(amount, fromPos) {
    if (!this.alive) return;
    this.health -= amount;
    this.hitFlash = 0.15;
    if (this.health <= 0) {
      this.alive = false;
      this.deathTimer = 0.6;
      this.justDied = true;
    }
  }

  // 炸彈擊飛 (大 Boss 太重，僅小幅位移不真正飛起)
  launch(vel, damage) {
    if (!this.alive) return;
    this.takeDamage(damage, null);
    this.pos.x += vel.x * 0.05;
    this.pos.z += vel.z * 0.05;
  }

  update(dt, playerPos, world, camera) {
    // 死亡動畫
    if (!this.alive) {
      if (this.hpBar) this.hpBar.visible = false;
      this.skillRing.visible = false;
      this.deathTimer -= dt;
      const k = Math.max(0, this.deathTimer / 0.6);
      this.group.scale.setScalar(this.radius > 0 ? k : 0);
      this.bodyMat.opacity = 0.9 * k;
      return false;
    }

    let dealtDamage = false;
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // 追蹤 (大 Boss 一定持續逼近)
    if (dist > this.radius + 1.2) {
      const inv = 1 / (dist || 1);
      const nx = dx * inv, nz = dz * inv;
      const tx = this.pos.x + nx * this.speed * dt;
      const tz = this.pos.z + nz * this.speed * dt;
      const res = world.resolveCollision({ x: tx, z: tz }, this.radius);
      this.pos.x = res.x; this.pos.z = res.z;
      this.group.rotation.y = Math.atan2(nx, nz);
    }

    // 接觸攻擊
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (dist <= this.radius + 1.6 && this.attackTimer <= 0) {
      this.attackTimer = CONFIG.megaBoss.attackCooldown;
      dealtDamage = true;
    }

    // 貼地 + 彈跳
    this.pos.y = world.getGroundY(this.pos.x, this.pos.z);
    this.bouncePhase += dt * 4;
    const bounce = Math.abs(Math.sin(this.bouncePhase)) * 0.3;
    this.group.position.set(this.pos.x, this.pos.y + bounce, this.pos.z);

    // 受擊變色
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.bodyMat.color.setHex(0xffffff);
    } else {
      this.bodyMat.color.setHex(this.baseColor);
    }

    // ---- 專屬技能 ----
    if (!this.casting) {
      this.skillTimer -= dt;
      if (this.skillTimer <= 0) {
        this.skillTimer = CONFIG.megaBoss.skillCooldown;
        this._beginCast(playerPos, world);
      }
    } else {
      this._updateCast(dt, playerPos, world);
    }
    this._updateSkillFx(dt);

    // 血條
    this._updateHealthBar(camera);

    return dealtDamage;
  }

  // 起手施放：進入施放動畫，記錄待觸發的技能資料 (實際效果在爆發幀)
  _beginCast(playerPos, world) {
    this.casting = true;
    this.castT = 0;
    this.castImpactDone = false;
    // 鎖定技能目標點 (兔王鎖玩家位置、其餘鎖自身)
    if (this.kind === "rabbit") {
      this._pendingSkill = {
        kind: "rabbit",
        ox: playerPos.x, oz: playerPos.z,
        radius: 8, damage: 45, impactAt: 0.75,
      };
    } else if (this.kind === "boss") {
      this._pendingSkill = { kind: "boss", impactAt: 0.55 };
    } else {
      this._pendingSkill = {
        kind: "slime",
        ox: this.pos.x, oz: this.pos.z,
        radius: 11, damage: 35, impactAt: 0.55,
      };
    }
  }

  // 施放動畫：依種類做華麗動作，到爆發幀觸發傷害/召喚/衝擊
  _updateCast(dt, playerPos, world) {
    this.castT += dt;
    const p = this._pendingSkill;
    const t = this.castT / this.castDuration; // 0→1
    const R = this.radius;

    // 身體發光 (施放期間泛技能色光)
    const glow = Math.sin(Math.min(1, t) * Math.PI); // 0→1→0
    if (this.bodyMat.emissive) {
      const gc = this.kind === "rabbit" ? 0x4466ff : this.kind === "boss" ? 0xffcc22 : 0xff6622;
      this.bodyMat.emissive.setHex(gc);
      this.bodyMat.emissiveIntensity = glow * 1.2;
    }

    if (p.kind === "rabbit") {
      // 巨型兔王：蹲伏蓄力 → 高高躍起 → 猛力砸下
      const impactAt = p.impactAt;
      if (t < impactAt) {
        const k = t / impactAt;
        // 前段蹲伏 (壓扁)，後段躍起 (拉高 + 上升)
        if (k < 0.4) {
          this.body.scale.y = 0.85 * (1 - k * 0.5);      // 蹲
        } else {
          const jk = (k - 0.4) / 0.6;
          this.body.scale.y = 0.85 * (0.8 + jk * 0.5);
          this.group.position.y = this.pos.y + jk * 14;  // 躍起騰空
        }
        this.group.rotation.x = -k * 0.4;
      } else {
        // 砸下
        const dk = (t - impactAt) / (1 - impactAt);
        this.group.position.y = this.pos.y + (1 - dk) * 14;
        this.group.rotation.x = 0.4 * (1 - dk);
      }
    } else if (p.kind === "boss") {
      // 史萊姆之王：膨脹脈動 → 爆發召喚 (身體吸氣再噴發)
      const puff = Math.sin(t * Math.PI * 3) * 0.15;
      this.body.scale.set(1 + puff, 0.85 + puff * 0.5, 1 + puff);
    } else {
      // 巨型史萊姆：下壓蓄力 → 猛地彈起震地
      if (t < p.impactAt) {
        const k = t / p.impactAt;
        this.body.scale.y = 0.85 * (1 - k * 0.45);       // 下壓
        this.body.scale.x = 1 + k * 0.3;
        this.body.scale.z = 1 + k * 0.3;
      } else {
        const bk = (t - p.impactAt) / (1 - p.impactAt);
        this.body.scale.y = 0.85 * (0.55 + bk * 0.7);    // 彈起
        this.body.scale.x = 1.3 * (1 - bk * 0.3);
        this.body.scale.z = 1.3 * (1 - bk * 0.3);
      }
    }

    // 爆發幀：觸發傷害/召喚/衝擊環 (只觸發一次)
    if (!this.castImpactDone && t >= p.impactAt) {
      this.castImpactDone = true;
      if (p.kind === "boss") {
        this.summonRequest += 6; // 召喚更多小史萊姆
        this.skillOrigin.set(this.pos.x, this.pos.y, this.pos.z);
        this._triggerRing(this.skillOrigin, R * 2.5);
      } else {
        const oy = world.getGroundY(p.ox, p.oz);
        this.skillOrigin.set(p.ox, oy, p.oz);
        this.skillDamageRadius = p.radius;
        this.skillDamagePending = p.damage;
        this._triggerRing(this.skillOrigin, p.radius);
      }
    }

    // 動畫結束：復位
    if (this.castT >= this.castDuration) {
      this.casting = false;
      this._pendingSkill = null;
      this.group.rotation.x = 0;
      this.body.scale.set(1, 0.85, 1);
      if (this.bodyMat.emissive) this.bodyMat.emissiveIntensity = 0;
    }
  }

  _triggerRing(origin, radius) {
    this.skillRing.position.set(origin.x, origin.y + 0.1, origin.z);
    this.skillRing.visible = true;
    this._ringActive = true;
    this._ringT = 0;
    this._ringMax = radius;
  }

  _updateSkillFx(dt) {
    if (!this._ringActive) return;
    this._ringT += dt;
    const k = this._ringT / 0.5; // 0.5 秒擴張
    this.skillRing.scale.setScalar(this._ringMax * Math.min(1, k));
    this.skillRing.material.opacity = 0.8 * (1 - Math.min(1, k));
    if (this._ringT >= 0.5) {
      this._ringActive = false;
      this.skillRing.visible = false;
    }
  }

  _updateHealthBar(camera) {
    const ratio = Math.max(0, this.health / this.maxHealth);
    this.hpFill.scale.x = ratio;
    this.hpFill.position.x = -(this.hpBarWidth * (1 - ratio)) / 2;
    this.hpBar.position.set(this.group.position.x, this.group.position.y + this.hpBarYOffset, this.group.position.z);
    if (camera) this.hpBar.quaternion.copy(camera.quaternion);
    this.hpBar.visible = this.alive;
  }

  // main 每幀呼叫：取得並清除待造成的技能傷害 (回傳 {x,z,radius,damage} 或 null)
  consumeSkillDamage() {
    if (this.skillDamagePending <= 0) return null;
    const out = {
      x: this.skillOrigin.x, z: this.skillOrigin.z,
      radius: this.skillDamageRadius, damage: this.skillDamagePending,
    };
    this.skillDamagePending = 0;
    return out;
  }

  // main 每幀呼叫：取得並清除召喚請求數量
  consumeSummon() {
    const n = this.summonRequest;
    this.summonRequest = 0;
    return n;
  }

  get shouldRemove() {
    return !this.alive && this.deathTimer <= 0;
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.hpBar) this.scene.remove(this.hpBar);
    if (this.skillRing) this.scene.remove(this.skillRing);
    this.body.geometry.dispose();
    this.bodyMat.dispose();
  }
}
