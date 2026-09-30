import * as THREE from "three";
import { CONFIG } from "./config.js";

// 單隻史萊姆：追玩家、靠近攻擊、可受傷死亡、彈跳動畫。
export class Slime {
  constructor(scene, spawnPos, isBoss = false) {
    this.scene = scene;
    const s = CONFIG.slime;

    this.isBoss = isBoss;
    this.radius = isBoss ? s.radius * s.bossScale : s.radius;
    this.maxHealth = isBoss ? s.maxHealth * s.bossHealthMult : s.maxHealth;
    this.speed = isBoss ? s.speed * s.bossSpeedMult : s.speed;
    this.attackDamage = isBoss ? s.attackDamage * s.bossDamageMult : s.attackDamage;

    this.pos = spawnPos.clone();
    this.health = this.maxHealth;
    this.alive = true;
    this.attackTimer = 0;
    this.hitFlash = 0;      // 受擊變紅計時
    this.deathTimer = 0;    // 死亡消失動畫
    this.bouncePhase = Math.random() * Math.PI * 2;

    // 被炸彈擊飛的狀態
    this.launched = false;
    this.launchVel = new THREE.Vector3();
    this.spinAxis = new THREE.Vector3();
    this.spinSpeed = 0;
    this.pendingDamage = 0;

    this._buildMesh();
  }

  // 被炸彈擊飛：往 vel 方向飛出，落地後才承受 pendingDamage 的傷害
  launch(vel, damage) {
    if (!this.alive) return;
    this.launched = true;
    this.launchVel.copy(vel);
    this.pendingDamage = damage;
    // 隨機翻滾
    this.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.spinSpeed = 6 + Math.random() * 8;
  }

  // 飛行中的更新 (拋物線 + 翻滾)，落地回傳 true
  _updateLaunch(dt, world) {
    this.launchVel.y -= CONFIG.bomb.launchGravity * dt;
    this.pos.x += this.launchVel.x * dt;
    this.pos.y += this.launchVel.y * dt;
    this.pos.z += this.launchVel.z * dt;

    // 邊界夾住 (不要飛出地圖太多)
    const b = world.bound;
    this.pos.x = Math.max(-b, Math.min(b, this.pos.x));
    this.pos.z = Math.max(-b, Math.min(b, this.pos.z));

    const groundY = world.getHeight(this.pos.x, this.pos.z);
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    // 翻滾
    this.group.rotateOnAxis(this.spinAxis, this.spinSpeed * dt);

    if (this.pos.y <= groundY && this.launchVel.y < 0) {
      this.pos.y = groundY;
      this.launched = false;
      this.group.rotation.set(0, 0, 0);
      return true; // 落地
    }
    return false;
  }

  _buildMesh() {
    const s = CONFIG.slime;
    const R = this.radius; // 實際半徑 (頭目較大)
    this.baseColor = this.isBoss ? s.bossColor : s.color;
    this.group = new THREE.Group();

    this.bodyMat = new THREE.MeshStandardMaterial({
      color: this.baseColor,
      transparent: true,
      opacity: 0.85,
      roughness: 0.3,
    });

    // 身體 (半球感的圓體)
    this.body = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 16), this.bodyMat);
    this.body.scale.y = 0.8;
    this.body.position.y = R * 0.8;
    this.body.castShadow = true;
    this.group.add(this.body);

    // 頭目加一頂小皇冠標示
    if (this.isBoss) {
      this.crown = new THREE.Mesh(
        new THREE.ConeGeometry(R * 0.35, R * 0.5, 5),
        new THREE.MeshStandardMaterial({ color: 0xffd447, metalness: 0.5, roughness: 0.3 })
      );
      this.crown.position.y = R * 1.7;
      this.group.add(this.crown);
    }

    // 眼睛
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeGeo = new THREE.SphereGeometry(R * 0.12, 8, 8);
    this.eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    const ey = R * 0.95;
    const ex = R * 0.3;
    const ez = R * 0.75;
    this.eyeL.position.set(-ex, ey, ez);
    this.eyeR.position.set(ex, ey, ez);
    this.group.add(this.eyeL);
    this.group.add(this.eyeR);

    // 血條 (漂浮在頭頂，永遠面向攝影機)
    this.hpBar = new THREE.Group();
    const barW = R * 2;
    const barH = this.isBoss ? 0.28 : 0.18;
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

    // 血條直接掛在 scene，不放進會旋轉的 group，避免跟著史萊姆轉向
    this.hpBarYOffset = R * 2.2;
    this.scene.add(this.hpBar);

    this.group.position.copy(this.pos);
    this.scene.add(this.group);

    // 受擊位移 (knockback)
    this.knockback = new THREE.Vector3();
  }

  _updateHealthBar(camera, playerPos) {
    if (!this.hpBar) return;

    // 超過一定距離就不顯示血條
    const showDist = CONFIG.slime.hpBarShowDist;
    let dist = Infinity;
    if (playerPos) {
      dist = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    }
    if (!this.alive || dist > showDist) {
      this.hpBar.visible = false;
      return;
    }
    this.hpBar.visible = true;

    const ratio = Math.max(0, this.health / this.maxHealth);
    // 縮放填充條並靠左對齊
    this.hpFill.scale.x = ratio;
    this.hpFill.position.x = -(this.hpBarWidth * (1 - ratio)) / 2;
    // 顏色隨血量由綠轉紅
    this.hpFillMat.color.setHSL(ratio * 0.33, 0.8, 0.5);

    // 血條世界位置：跟著史萊姆頭頂 (用 group 的實際顯示位置)
    this.hpBar.position.set(this.group.position.x, this.group.position.y + this.hpBarYOffset, this.group.position.z);
    // 永遠面向攝影機 (等同永遠面向玩家視角)，且不受史萊姆旋轉影響
    if (camera) this.hpBar.quaternion.copy(camera.quaternion);
  }

  takeDamage(amount, fromPos) {
    if (!this.alive) return;
    this.health -= amount;
    this.hitFlash = 0.2;
    this.squash = 0.25; // 被打扁一下

    // 擊退：從攻擊來源往外推
    if (fromPos) {
      const kx = this.pos.x - fromPos.x;
      const kz = this.pos.z - fromPos.z;
      const len = Math.hypot(kx, kz) || 1;
      const power = 6;
      this.knockback.set((kx / len) * power, 0, (kz / len) * power);
    }

    if (this.health <= 0) {
      this.alive = false;
      this.deathTimer = 0.4;
      this.justDied = true; // 供 main 計分 (擊飛落地致死等情況)
    }
  }

  // 回傳 true 表示這幀對玩家造成傷害
  update(dt, playerPos, world, camera) {
    const s = CONFIG.slime;

    // 被擊飛中：只做拋物線飛行，落地後才承受傷害
    if (this.launched) {
      if (this.hpBar) this.hpBar.visible = false;
      const landed = this._updateLaunch(dt, world);
      if (landed) {
        this.squash = 0.3; // 落地壓扁
        const dmg = this.pendingDamage;
        this.pendingDamage = 0;
        this.takeDamage(dmg, null); // 落地才判定失血
      }
      return false; // 飛行中不攻擊玩家
    }

    // 死亡消失動畫
    if (!this.alive) {
      if (this.hpBar) this.hpBar.visible = false;
      this.deathTimer -= dt;
      const k = Math.max(0, this.deathTimer / 0.4);
      this.group.scale.setScalar(k);
      this.bodyMat.opacity = 0.85 * k;
      return false;
    }

    let dealtDamage = false;

    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const dist2 = dx * dx + dz * dz; // 用平方距離比較，避免開根號
    const lod = dist2 > s.lodDist * s.lodDist;   // 遠：簡化
    const culled = dist2 > s.cullDist * s.cullDist; // 超遠：最省

    const dist = Math.sqrt(dist2);

    // 停止距離：不小於攻擊距離，且至少為 (玩家半徑 + 自身半徑) 避免與角色重疊穿模
    const stopGap = Math.max(s.attackRange, 0.6 + this.radius);
    // ---- AI：追蹤 (所有距離都算，但超遠的用便宜運算) ----
    if (dist < s.detectRange && dist > stopGap) {
      const inv = 1 / dist;
      const nx = dx * inv;
      const nz = dz * inv;
      // 這步最多只前進到剛好停在 stopGap，避免衝進玩家體內
      const step = Math.min(this.speed * dt, dist - stopGap);
      const tx = this.pos.x + nx * step;
      const tz = this.pos.z + nz * step;
      if (culled) {
        this.pos.x = tx;
        this.pos.z = tz;
      } else {
        const resolved = world.resolveCollision({ x: tx, z: tz }, this.radius);
        this.pos.x = resolved.x;
        this.pos.z = resolved.z;
        this.group.rotation.y = Math.atan2(nx, nz);
      }
    }

    // 攻擊 (只有近距離才可能打到玩家，超遠免算)
    if (this.attackTimer > 0) this.attackTimer -= dt;
    if (!culled && dist <= s.attackRange && this.attackTimer <= 0) {
      this.attackTimer = s.attackCooldown;
      dealtDamage = true;
    }

    // 擊退 (超遠免算)
    if (!culled && this.knockback.lengthSq() > 0.001) {
      const tx = this.pos.x + this.knockback.x * dt;
      const tz = this.pos.z + this.knockback.z * dt;
      const resolved = world.resolveCollision({ x: tx, z: tz }, this.radius);
      this.pos.x = resolved.x;
      this.pos.z = resolved.z;
      this.knockback.multiplyScalar(0.85);
      if (this.knockback.lengthSq() < 0.01) this.knockback.set(0, 0, 0);
    }

    // ---- 顯示 ----
    if (culled) {
      // 超遠：完全不做動畫，貼地用便宜公式，血條隱藏
      this.pos.y = world.getHeight(this.pos.x, this.pos.z);
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      this._setLowDetail(true);
      if (this.hpBar) this.hpBar.visible = false;
      return dealtDamage;
    }

    // 貼地：遠方用便宜公式，近方用射線精準貼地 (帶 currentY 可上樓)
    if (lod) {
      this.pos.y = world.getHeight(this.pos.x, this.pos.z);
    } else {
      const gY = world.getGroundY(this.pos.x, this.pos.z, this.pos.y);
      // 支撐消失 (站的樓板被炸) → 平滑落下
      this.pos.y = gY < this.pos.y - 0.4 ? Math.max(gY, this.pos.y - 14 * dt) : gY;
    }

    if (lod) {
      // 遠方：低模、不做彈跳/擠壓動畫，位置直接放好
      this._setLowDetail(true);
      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      if (this.hpBar) this.hpBar.visible = false;
      // 受擊變色仍保留 (便宜)
      if (this.hitFlash > 0) this.hitFlash -= dt;
      return dealtDamage;
    }

    // ---- 近距離：完整動畫 ----
    this._setLowDetail(false);

    this.bouncePhase += dt * 6;
    const bounce = Math.abs(Math.sin(this.bouncePhase)) * 0.25;
    this.group.position.set(this.pos.x, this.pos.y + bounce, this.pos.z);

    if (this.squash > 0) this.squash -= dt;
    const squashK = Math.max(0, this.squash) / 0.25;
    this.body.scale.y = (0.8 - bounce * 0.4) * (1 - squashK * 0.4);
    const widen = 1 + squashK * 0.3;
    this.body.scale.x = widen;
    this.body.scale.z = widen;

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      this.bodyMat.color.setHex(0xff3030);
    } else {
      this.bodyMat.color.setHex(this.baseColor);
    }

    this._updateHealthBar(camera, playerPos);

    return dealtDamage;
  }

  // 切換低細節顯示：隱藏眼睛/皇冠等小物件，只留身體
  _setLowDetail(low) {
    if (this._lowDetail === low) return; // 狀態沒變就不動，省開銷
    this._lowDetail = low;
    if (this.eyeL) this.eyeL.visible = !low;
    if (this.eyeR) this.eyeR.visible = !low;
    if (this.crown) this.crown.visible = !low;
    // 遠方身體不投影陰影 (省 shadow 運算)
    this.body.castShadow = !low;
  }

  get shouldRemove() {
    return !this.alive && this.deathTimer <= 0;
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.hpBar) this.scene.remove(this.hpBar); // 血條已獨立掛在 scene
    this.body.geometry.dispose();
    this.bodyMat.dispose();
    if (this.hpFill) this.hpFill.geometry.dispose();
    if (this.hpFillMat) this.hpFillMat.dispose();
  }
}
