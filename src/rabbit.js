import * as THREE from "three";
import { CONFIG } from "./config.js";

// 兔子敵人：一跳一跳靠近玩家，靠近時大幅躍起做跳躍踢擊。
// 血量 = 普通史萊姆 2 倍、速度 2 倍、攻擊力相等。
export class Rabbit {
  constructor(scene, spawnPos) {
    this.scene = scene;
    const r = CONFIG.rabbit;
    const s = CONFIG.slime;

    this.isRabbit = true;
    this.isBoss = false;
    this.radius = r.radius;
    this.maxHealth = s.maxHealth * r.healthMult;
    this.speed = s.speed * r.speedMult;
    this.attackDamage = s.attackDamage; // 與普通史萊姆相等

    this.pos = spawnPos.clone();
    this.health = this.maxHealth;
    this.alive = true;
    this.attackTimer = 0;
    this.hitFlash = 0;
    this.deathTimer = 0;
    this.squash = 0;

    this.hopPhase = Math.random() * r.hopInterval; // 跳躍節奏
    this.kicking = false;      // 是否在踢擊躍起中
    this.kickT = 0;            // 踢擊動畫進度
    this.facingAngle = 0;

    this.knockback = new THREE.Vector3();
    this._lowDetail = null;

    // 被炸彈擊飛的狀態
    this.launched = false;
    this.launchVel = new THREE.Vector3();
    this.spinAxis = new THREE.Vector3();
    this.spinSpeed = 0;
    this.pendingDamage = 0;

    this._buildMesh();
  }

  launch(vel, damage) {
    if (!this.alive) return;
    this.launched = true;
    this.launchVel.copy(vel);
    this.pendingDamage = damage;
    this.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.spinSpeed = 6 + Math.random() * 8;
  }

  _updateLaunch(dt, world) {
    this.launchVel.y -= CONFIG.bomb.launchGravity * dt;
    this.pos.x += this.launchVel.x * dt;
    this.pos.y += this.launchVel.y * dt;
    this.pos.z += this.launchVel.z * dt;
    const b = world.bound;
    this.pos.x = Math.max(-b, Math.min(b, this.pos.x));
    this.pos.z = Math.max(-b, Math.min(b, this.pos.z));
    const groundY = world.getHeight(this.pos.x, this.pos.z);
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotateOnAxis(this.spinAxis, this.spinSpeed * dt);
    if (this.pos.y <= groundY && this.launchVel.y < 0) {
      this.pos.y = groundY;
      this.launched = false;
      this.group.rotation.set(0, 0, 0);
      return true;
    }
    return false;
  }

  _buildMesh() {
    const r = CONFIG.rabbit;
    const R = this.radius;
    this.baseColor = r.color;
    this.group = new THREE.Group();

    this.bodyMat = new THREE.MeshStandardMaterial({ color: this.baseColor, roughness: 0.7 });

    // 身體
    this.body = new THREE.Mesh(new THREE.SphereGeometry(R, 12, 10), this.bodyMat);
    this.body.scale.set(1, 0.9, 1.2);
    this.body.position.y = R;
    this.body.castShadow = true;
    this.group.add(this.body);

    // 頭
    this.head = new THREE.Mesh(new THREE.SphereGeometry(R * 0.6, 12, 10), this.bodyMat);
    this.head.position.set(0, R * 1.4, R * 0.7);
    this.head.castShadow = true;
    this.group.add(this.head);

    // 耳朵 (兩根，正面辨識)
    this.ears = [];
    for (const sx of [-0.25, 0.25]) {
      const ear = new THREE.Mesh(
        new THREE.CapsuleGeometry(R * 0.14, R * 0.9, 4, 6),
        this.bodyMat
      );
      ear.position.set(sx * R, R * 2.1, R * 0.6);
      ear.castShadow = true;
      this.group.add(ear);
      this.ears.push(ear);
    }

    // 眼睛
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeGeo = new THREE.SphereGeometry(R * 0.1, 6, 6);
    this.eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeL.position.set(-R * 0.22, R * 1.5, R * 1.15);
    this.eyeR.position.set(R * 0.22, R * 1.5, R * 1.15);
    this.group.add(this.eyeL);
    this.group.add(this.eyeR);

    // 後腳 (踢擊用，掛樞紐在髖部)
    this.legPivot = new THREE.Group();
    this.legPivot.position.set(0, R * 0.6, -R * 0.4);
    this.group.add(this.legPivot);
    const legGeo = new THREE.BoxGeometry(R * 0.5, R * 0.3, R * 0.7);
    this.leg = new THREE.Mesh(legGeo, this.bodyMat);
    this.leg.position.set(0, -R * 0.2, 0);
    this.legPivot.add(this.leg);

    // 血條
    this._buildHealthBar(R);

    this.group.position.copy(this.pos);
    this.scene.add(this.group);
  }

  _buildHealthBar(R) {
    this.hpBar = new THREE.Group();
    const barW = R * 2;
    const barH = 0.16;
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, barH),
      new THREE.MeshBasicMaterial({ color: 0x300000, depthTest: false, transparent: true })
    );
    bg.renderOrder = 999;
    this.hpBar.add(bg);
    this.hpFillMat = new THREE.MeshBasicMaterial({ color: 0x39d353, depthTest: false, transparent: true });
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(barW, barH), this.hpFillMat);
    this.hpFill.position.z = 0.001;
    this.hpFill.renderOrder = 1000;
    this.hpBarWidth = barW;
    this.hpBar.add(this.hpFill);
    this.hpBarYOffset = R * 3.2;
    this.scene.add(this.hpBar);
  }

  takeDamage(amount, fromPos) {
    if (!this.alive) return;
    this.health -= amount;
    this.hitFlash = 0.2;
    this.squash = 0.25;
    if (fromPos) {
      const kx = this.pos.x - fromPos.x;
      const kz = this.pos.z - fromPos.z;
      const len = Math.hypot(kx, kz) || 1;
      this.knockback.set((kx / len) * 6, 0, (kz / len) * 6);
    }
    if (this.health <= 0) {
      this.alive = false;
      this.deathTimer = 0.4;
      this.justDied = true;
    }
  }

  update(dt, playerPos, world, camera) {
    const r = CONFIG.rabbit;
    const s = CONFIG.slime;

    // 被擊飛中：拋物線飛行，落地才判定失血
    if (this.launched) {
      if (this.hpBar) this.hpBar.visible = false;
      const landed = this._updateLaunch(dt, world);
      if (landed) {
        this.squash = 0.3;
        const dmg = this.pendingDamage;
        this.pendingDamage = 0;
        this.takeDamage(dmg, null);
      }
      return false;
    }

    if (!this.alive) {
      if (this.hpBar) this.hpBar.visible = false;
      this.deathTimer -= dt;
      const k = Math.max(0, this.deathTimer / 0.4);
      this.group.scale.setScalar(k);
      return false;
    }

    let dealtDamage = false;
    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const dist2 = dx * dx + dz * dz;
    const lod = dist2 > s.lodDist * s.lodDist;
    const culled = dist2 > s.cullDist * s.cullDist;
    const dist = Math.sqrt(dist2);

    // 面向玩家
    if (dist > 0.01) this.facingAngle = Math.atan2(dx, dz);

    // 停止距離：避免與角色重疊穿模
    const stopGap = Math.max(r.attackRange, 0.6 + this.radius);
    // AI：跳著靠近
    if (dist < r.detectRange && dist > stopGap) {
      const inv = 1 / dist;
      const nx = dx * inv, nz = dz * inv;
      const step = Math.min(this.speed * dt, dist - stopGap);
      const tx = this.pos.x + nx * step;
      const tz = this.pos.z + nz * step;
      if (culled) {
        this.pos.x = tx; this.pos.z = tz;
      } else {
        const res = world.resolveCollision({ x: tx, z: tz }, this.radius);
        this.pos.x = res.x; this.pos.z = res.z;
      }
    }

    // 攻擊：跳躍踢擊
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (!culled && dist <= r.attackRange && this.attackTimer <= 0 && !this.kicking) {
      this.attackTimer = r.attackCooldown;
      this.kicking = true;
      this.kickT = 0;
    }
    // 踢擊命中判定 (躍起到中段時)
    if (this.kicking) {
      this.kickT += dt / 0.5; // 0.5 秒完成踢擊
      if (this.kickT >= 0.5 && !this._kickHit && dist <= r.attackRange + 0.5) {
        this._kickHit = true;
        dealtDamage = true;
      }
      if (this.kickT >= 1) { this.kicking = false; this._kickHit = false; }
    }

    // 擊退
    if (!culled && this.knockback.lengthSq() > 0.001) {
      const tx = this.pos.x + this.knockback.x * dt;
      const tz = this.pos.z + this.knockback.z * dt;
      const res = world.resolveCollision({ x: tx, z: tz }, this.radius);
      this.pos.x = res.x; this.pos.z = res.z;
      this.knockback.multiplyScalar(0.85);
      if (this.knockback.lengthSq() < 0.01) this.knockback.set(0, 0, 0);
    }

    // 超遠：只放位置
    if (culled) {
      this.pos.y = world.getHeight(this.pos.x, this.pos.z);
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.group.rotation.y = this.facingAngle;
      this._setLowDetail(true);
      if (this.hpBar) this.hpBar.visible = false;
      return dealtDamage;
    }

    if (lod) {
      this.pos.y = world.getHeight(this.pos.x, this.pos.z);
    } else {
      const gY = world.getGroundY(this.pos.x, this.pos.z, this.pos.y);
      this.pos.y = gY < this.pos.y - 0.4 ? Math.max(gY, this.pos.y - 14 * dt) : gY;
    }
    this.group.rotation.y = this.facingAngle;

    if (lod) {
      this._setLowDetail(true);
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      if (this.hpBar) this.hpBar.visible = false;
      if (this.hitFlash > 0) this.hitFlash -= dt;
      return dealtDamage;
    }

    // 近距離：完整動畫
    this._setLowDetail(false);

    // 跳躍高度：踢擊時大幅躍起，否則移動小跳
    let hop = 0;
    if (this.kicking) {
      hop = Math.sin(this.kickT * Math.PI) * r.kickHeight;
      // 踢腿：躍起時後腳往前踢
      this.legPivot.rotation.x = -Math.sin(this.kickT * Math.PI) * 1.6;
    } else {
      this.hopPhase += dt;
      const moving = dist < r.detectRange && dist > r.attackRange;
      if (moving) {
        const t = (this.hopPhase % r.hopInterval) / r.hopInterval;
        hop = Math.sin(t * Math.PI) * r.hopHeight;
      }
      this.legPivot.rotation.x *= 0.8;
    }

    if (this.squash > 0) this.squash -= dt;
    const squashK = Math.max(0, this.squash) / 0.25;
    this.body.scale.set(1 + squashK * 0.3, (0.9) * (1 - squashK * 0.3), 1.2 + squashK * 0.2);

    this.group.position.set(this.pos.x, this.pos.y + hop, this.pos.z);

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.bodyMat.color.setHex(0xff5555);
    } else {
      this.bodyMat.color.setHex(this.baseColor);
    }

    this._updateHealthBar(camera, playerPos, dist);
    return dealtDamage;
  }

  _updateHealthBar(camera, playerPos, dist) {
    if (!this.hpBar) return;
    if (!this.alive || dist > CONFIG.rabbit.hpBarShowDist) {
      this.hpBar.visible = false;
      return;
    }
    this.hpBar.visible = true;
    const ratio = Math.max(0, this.health / this.maxHealth);
    this.hpFill.scale.x = ratio;
    this.hpFill.position.x = -(this.hpBarWidth * (1 - ratio)) / 2;
    this.hpFillMat.color.setHSL(ratio * 0.33, 0.8, 0.5);
    this.hpBar.position.set(this.group.position.x, this.group.position.y + this.hpBarYOffset, this.group.position.z);
    if (camera) this.hpBar.quaternion.copy(camera.quaternion);
  }

  _setLowDetail(low) {
    if (this._lowDetail === low) return;
    this._lowDetail = low;
    const show = !low;
    if (this.eyeL) this.eyeL.visible = show;
    if (this.eyeR) this.eyeR.visible = show;
    for (const ear of this.ears) ear.visible = show;
    this.body.castShadow = show;
  }

  get shouldRemove() {
    return !this.alive && this.deathTimer <= 0;
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.hpBar) this.scene.remove(this.hpBar);
    this.body.geometry.dispose();
    this.bodyMat.dispose();
    if (this.hpFill) this.hpFill.geometry.dispose();
    if (this.hpFillMat) this.hpFillMat.dispose();
  }
}
