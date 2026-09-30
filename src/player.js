import * as THREE from "three";
import { CONFIG } from "./config.js";

// 玩家角色：以基本幾何體組成人形，右手持劍。
// 負責移動、跳躍、轉身、揮劍動畫與血量。
export class Player {
  constructor(scene) {
    this.scene = scene;
    const p = CONFIG.player;

    this.pos = new THREE.Vector3(0, 0, 0); // 腳底位置
    this.velY = 0;
    this.onGround = true;
    this.facing = 0;          // 上半身/整體面向角度 (弧度, 繞 Y)
    this.legYaw = 0;          // 下半身(腿)相對上半身的偏轉 (平行移動用)
    this._targetLegYaw = 0;
    this.maxHealth = p.maxHealth; // 可被經驗系統提升
    this.health = this.maxHealth;
    this.alive = true;

    // 攻擊狀態 (連段)
    this.attackTimer = 0;     // 單擊冷卻 (連段結束後)
    this.swingTimer = 0;      // 當前段揮劍動畫剩餘
    this.swingDuration = CONFIG.sword.swingTime; // 當前段動畫總長
    this.attacking = false;
    this.comboStep = 0;       // 當前連段 (1~comboCount)，0=未攻擊
    this.comboQueued = false; // 是否已排下一段
    this.comboWindowTimer = 0;// 可接下一段的剩餘時間
    this.hitApplied = false;  // 當前段是否已判定過命中
    this.waveRequested = false;// 第5段是否要發射劍氣 (供 main 讀取)
    this.walkPhase = 0;       // 走路循環相位
    this.speedRatio = 0;      // 目前移動速度比例 (0~1)，影響擺動幅度

    // 受傷 & 無敵
    this.invulnTimer = 0;     // 受傷後無敵倒數
    this.hurtFlash = 0;       // 受傷閃爍計時
    this.knockback = new THREE.Vector3(); // 被擊退的水平速度

    // 施法 (閃電魔法)
    this.castTimer = 0;       // 施法姿勢剩餘時間

    // 閃避 (空翻)
    this.dodgeTimer = 0;      // 閃避進行中倒數
    this.dodgeCooldown = 0;   // 閃避冷卻
    this.dodgeDir = new THREE.Vector3(); // 閃避方向 (世界座標)
    this.flipAxis = "pitch";  // 空翻軸：pitch(前後翻) 或 roll(左右翻)
    this.flipSign = 1;

    this._buildMesh();
  }

  _buildMesh() {
    this.group = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({ color: 0xe8b98f });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2f6fbf });
    const cloth2 = new THREE.MeshStandardMaterial({ color: 0x22406b });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff });

    // 正面統一朝 +Z。所有五官、徽章都放 +Z 側。

    // ---- 腰 (spine) 樞紐：上半身掛在它下面，可繞腰扭轉/前後傾，動作更靈活 ----
    const SPINE_Y = 1.0;
    this.spine = new THREE.Group();
    this.spine.position.y = SPINE_Y;
    this.group.add(this.spine);

    // ---- 軀幹 (掛在 spine 下，座標扣掉 SPINE_Y) ----
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.5), cloth);
    torso.position.y = 1.15 - SPINE_Y;
    torso.castShadow = true;
    this.spine.add(torso);

    // 胸前徽章 (正面辨識)
    const badge = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 5),
      new THREE.MeshStandardMaterial({ color: 0xffd447 })
    );
    badge.position.set(0, 1.2 - SPINE_Y, 0.26);
    this.spine.add(badge);

    // 肩膀
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.25, 0.5), cloth);
    shoulders.position.y = 1.6 - SPINE_Y;
    shoulders.castShadow = true;
    this.spine.add(shoulders);

    // ---- 頭 + 五官 (朝 +Z)，含頸關節 ----
    const headPivot = new THREE.Group();
    headPivot.position.y = 1.78 - SPINE_Y;
    this.spine.add(headPivot);
    this.headPivot = headPivot;
    this._spineY = SPINE_Y;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 20), skin);
    head.position.y = 0.17;
    head.castShadow = true;
    headPivot.add(head);

    // 眼睛 (白底 + 黑瞳)，在頭的正前方
    for (const sx of [-0.13, 0.13]) {
      const eyeW = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), white);
      eyeW.position.set(sx, 0.2, 0.3);
      eyeW.scale.z = 0.5;
      headPivot.add(eyeW);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), dark);
      pupil.position.set(sx, 0.2, 0.35);
      headPivot.add(pupil);
    }

    // 眉毛
    for (const sx of [-0.13, 0.13]) {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.04), dark);
      brow.position.set(sx, 0.32, 0.32);
      headPivot.add(brow);
    }

    // 嘴巴
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.04), dark);
    mouth.position.set(0, 0.05, 0.33);
    headPivot.add(mouth);

    // 鼻子 (小三角錐朝前)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 8), skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.13, 0.36);
    headPivot.add(nose);

    // ---- 腿：髖 → 大腿 → 膝 → 小腿 (兩段關節) ----
    // 雙腿放進 legsRoot，平行移動時整組下半身可獨立轉向
    this.legsRoot = new THREE.Group();
    this.legsRoot.position.y = 0.9;
    this.group.add(this.legsRoot);

    const thighGeo = new THREE.BoxGeometry(0.3, 0.5, 0.3);
    const shinGeo = new THREE.BoxGeometry(0.28, 0.5, 0.28);
    const footGeo = new THREE.BoxGeometry(0.3, 0.14, 0.42);

    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.22 * side, 0, 0); // 相對 legsRoot (已在 y=0.9)
      this.legsRoot.add(hip);

      const thigh = new THREE.Mesh(thighGeo, cloth2);
      thigh.position.y = -0.25;
      thigh.castShadow = true;
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -0.5;
      hip.add(knee);

      const shin = new THREE.Mesh(shinGeo, cloth2);
      shin.position.y = -0.25;
      shin.castShadow = true;
      knee.add(shin);

      const foot = new THREE.Mesh(footGeo, dark);
      foot.position.set(0, -0.47, 0.06);
      foot.castShadow = true;
      knee.add(foot);

      return { hip, knee };
    };

    const legL = makeLeg(-1);
    const legR = makeLeg(1);
    this.legLPivot = legL.hip;  this.kneeL = legL.knee;
    this.legRPivot = legR.hip;  this.kneeR = legR.knee;

    // ---- 手臂：肩 → 上臂 → 肘 → 前臂 (兩段關節) ----
    const upperArmGeo = new THREE.BoxGeometry(0.22, 0.45, 0.22);
    const foreArmGeo = new THREE.BoxGeometry(0.2, 0.45, 0.2);
    const handGeo = new THREE.BoxGeometry(0.22, 0.2, 0.22);

    const makeArm = (side) => {
      // 肩掛在 spine 下 (座標扣掉 SPINE_Y)
      const shoulder = new THREE.Group();
      shoulder.position.set(0.57 * side, 1.55 - SPINE_Y, 0);
      this.spine.add(shoulder);

      const upper = new THREE.Mesh(upperArmGeo, cloth);
      upper.position.y = -0.22;
      upper.castShadow = true;
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.45;
      shoulder.add(elbow);

      const fore = new THREE.Mesh(foreArmGeo, skin);
      fore.position.y = -0.22;
      fore.castShadow = true;
      elbow.add(fore);

      // 手腕關節 (新增)：手掌掛在 wrist 下，可獨立轉動 (揮劍甩腕更靈活)
      const wrist = new THREE.Group();
      wrist.position.y = -0.45;
      elbow.add(wrist);

      const hand = new THREE.Mesh(handGeo, skin);
      hand.position.y = -0.11;
      hand.castShadow = true;
      wrist.add(hand);

      return { shoulder, elbow, wrist, hand };
    };

    const armL = makeArm(-1);
    const armR = makeArm(1);
    this.armLPivot = armL.shoulder; this.elbowL = armL.elbow; this.wristL = armL.wrist;
    this.armRPivot = armR.shoulder; this.elbowR = armR.elbow; this.wristR = armR.wrist; this.handR = armR.hand;

    // ---- 劍 (握在右手) ----
    this.sword = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 1.3, 0.09),
      new THREE.MeshStandardMaterial({ color: 0xdfe8f0, metalness: 0.6, roughness: 0.3 })
    );
    blade.position.y = 0.65;
    blade.castShadow = true;
    this.sword.add(blade);

    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.1, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xc9a227 })
    );
    guard.position.y = 0.05;
    this.sword.add(guard);

    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.3, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x5a3a1a })
    );
    grip.position.y = -0.12;
    this.sword.add(grip);

    // 劍握在右手掌：劍尖朝前方 (手臂下垂時劍水平指向前)
    this.sword.position.set(0, -0.12, 0.1);
    this.sword.rotation.x = Math.PI / 2; // 劍身朝正前方
    this.handR.add(this.sword);

    // 預設姿勢：手臂自然下垂、手肘微彎
    this.armLPivot.rotation.x = 0.15;
    this.armRPivot.rotation.x = 0.15;
    this.elbowL.rotation.x = -0.25;
    this.elbowR.rotation.x = -0.25;

    this.scene.add(this.group);
    this.group.position.copy(this.pos);
  }

  // 左鍵觸發：開始攻擊或在連段窗口內接續下一段
  startAttack() {
    if (!this.alive) return false;
    if (!this.attacking) {
      // 起手第一段 (需冷卻結束)
      if (this.attackTimer > 0) return false;
      this._startSwing(1);
      return true;
    }
    // 攻擊中：當前段揮過一半後就可預約下一段 (前提：還沒到最後一段)
    if (this.comboStep < CONFIG.sword.comboCount) {
      const half = this.swingDuration * 0.5;
      if (this.swingTimer <= half) {
        this.comboQueued = true;
      }
    }
    return true;
  }

  _startSwing(step) {
    const S = CONFIG.sword;
    this.comboStep = step;
    this.attacking = true;
    this.comboQueued = false;
    this.hitApplied = false;
    // 第 5 段 (finisher) 動畫較長
    this.swingDuration = step >= S.comboCount ? S.finisherSwingTime : S.swingTime;
    this.swingTimer = this.swingDuration;
    this.comboWindowTimer = 0;
    // 第 5 段起手就標記要發射劍氣 (由 main 讀取一次)
    if (step >= S.comboCount) this.waveRequested = true;
  }

  // main 每幀呼叫：若這段揮到命中幀且尚未結算，回傳這段的傷害資料，否則 null
  consumeHitInfo() {
    if (!this.attacking || this.hitApplied) return null;
    const half = this.swingDuration * 0.5;
    if (this.swingTimer <= half) {
      this.hitApplied = true;
      const S = CONFIG.sword;
      const isFinisher = this.comboStep >= S.comboCount;
      return {
        finisher: isFinisher,
        damage: isFinisher ? S.finisherDamage : S.damage,
        range: isFinisher ? S.finisherRange : S.range,
        arc: isFinisher ? S.finisherArc : S.arc,
      };
    }
    return null;
  }

  // main 每幀呼叫：若第 5 段要發射劍氣，回傳 true 一次
  consumeWaveRequest() {
    if (this.waveRequested) {
      this.waveRequested = false;
      return true;
    }
    return false;
  }

  get isInvulnerable() {
    return this.invulnTimer > 0 || this.dodgeTimer > 0;
  }

  takeDamage(amount, fromPos) {
    if (!this.alive) return false;
    if (this.isInvulnerable) return false; // 無敵/閃避中免傷
    this.health = Math.max(0, this.health - amount);
    this.invulnTimer = CONFIG.player.invulnTime;
    this.hurtFlash = 0.35;

    // 依受擊方向朝反方向擊退
    if (fromPos) {
      const kx = this.pos.x - fromPos.x;
      const kz = this.pos.z - fromPos.z;
      const len = Math.hypot(kx, kz) || 1;
      const power = CONFIG.player.knockbackPower;
      this.knockback.set((kx / len) * power, 0, (kz / len) * power);
      this.velY = CONFIG.player.knockbackUp; // 同時小跳一下
      this.onGround = false;
    }

    if (this.health <= 0) {
      this.alive = false;
    }
    return true; // 真的受傷了
  }

  // 開始施法姿勢 (持續 duration 秒)
  startCast(duration) {
    this.castTimer = duration;
  }

  // 開始閃避空翻。dir: 世界座標方向; axis: "pitch"(前後翻)/"roll"(側翻); sign: 翻轉方向
  startDodge(dir, axis, sign) {
    if (this.dodgeCooldown > 0 || this.dodgeTimer > 0 || !this.alive) return false;
    this.dodgeTimer = CONFIG.dodge.duration;
    this.dodgeCooldown = CONFIG.dodge.cooldown;
    this.dodgeDir.copy(dir).normalize();
    this.flipAxis = axis;
    this.flipSign = sign;
    return true;
  }

  respawn() {
    this.health = this.maxHealth;
    this.alive = true;
    this.pos.set(0, 0, 0);
    this.velY = 0;
    this.facing = 0;
  }

  // dir: 世界座標的移動方向 (已正規化或零向量); dt: 秒
  update(dt, moveDir, wantJump, world, moving) {
    const p = CONFIG.player;

    // 計時器遞減
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
    if (this.castTimer > 0) this.castTimer -= dt;

    const dodging = this.dodgeTimer > 0;

    // ---- 水平移動 ----
    if (dodging) {
      // 閃避：沿固定方向高速衝刺 (忽略一般輸入)
      const next = this.pos.clone();
      next.x += this.dodgeDir.x * CONFIG.dodge.speed * dt;
      next.z += this.dodgeDir.z * CONFIG.dodge.speed * dt;
      const resolved = world.resolveCollision(next, p.radius);
      this.pos.x = resolved.x;
      this.pos.z = resolved.z;
    } else if (moveDir.lengthSq() > 0) {
      const speed = moving.run ? p.runSpeed : p.walkSpeed;
      const next = this.pos.clone();
      next.x += moveDir.x * speed * dt;
      next.z += moveDir.z * speed * dt;
      const resolved = world.resolveCollision(next, p.radius);
      this.pos.x = resolved.x;
      this.pos.z = resolved.z;

      const moveAngle = Math.atan2(moveDir.x, moveDir.z);
      if (moving.strafe) {
        // 平行移動：上半身固定朝攝影機前方，下半身(腿)轉向移動方向
        this.facing = lerpAngle(this.facing, moving.camForward, p.turnLerp);
        this._targetLegYaw = moveAngle - this.facing;
      } else {
        // 一般：整體轉向移動方向，腿不額外偏轉
        this.facing = lerpAngle(this.facing, moveAngle, p.turnLerp);
        this._targetLegYaw = 0;
      }
    } else {
      // 沒移動：腿回正
      this._targetLegYaw = 0;
      // 平行移動時即使不動也保持上半身朝前
      if (moving.strafe) this.facing = lerpAngle(this.facing, moving.camForward, p.turnLerp);
    }

    // ---- 受擊擊退：獨立位移，疊加在移動之上並逐漸衰減 ----
    if (this.knockback.lengthSq() > 0.001) {
      const next = this.pos.clone();
      next.x += this.knockback.x * dt;
      next.z += this.knockback.z * dt;
      const resolved = world.resolveCollision(next, p.radius);
      this.pos.x = resolved.x;
      this.pos.z = resolved.z;
      this.knockback.multiplyScalar(0.86); // 摩擦衰減
      if (this.knockback.lengthSq() < 0.02) this.knockback.set(0, 0, 0);
    }

    // ---- 垂直：地形貼合 + 跳躍 + 閃避騰空 + 上樓 ----
    // 傳入目前腳底高度，讓 getGroundY 納入可站立的建築表面 (樓板/樓梯)
    const groundY = world.getGroundY(this.pos.x, this.pos.z, this.pos.y);

    if (wantJump && this.onGround && !dodging) {
      this.velY = p.jumpSpeed;
      this.onGround = false;
    }

    if (this.onGround && !dodging) {
      if (groundY < this.pos.y - 0.7) {
        // 腳下支撐明顯消失 (例如站的樓板被炸掉、走到樓板邊緣落空) → 自然下落。
        // 門檻放寬到 0.7 (>單階 0.4)，讓逐階下樓時平順吸附、不會每階誤判成墜落。
        this.onGround = false;
        this.velY = 0;
      } else {
        // 站在地面 / 走上下坡或樓梯：吸附到腳下表面
        this.pos.y = groundY;
        this.velY = 0;
      }
    } else {
      // 騰空中 (跳躍或閃避)：套重力
      this.velY -= p.gravity * dt;
      this.pos.y += this.velY * dt;
      if (this.pos.y <= groundY) {
        this.pos.y = groundY;
        this.velY = 0;
        this.onGround = true;
      }
    }

    // 閃避倒數
    if (dodging) {
      this.dodgeTimer -= dt;
      if (this.dodgeTimer <= 0) {
        // 閃避結束，把翻轉歸零
        this.group.rotation.set(0, this.facing, 0);
      }
    }

    // 套用位置到 mesh (y 之後在 _animate 會再加 bob/翻滾偏移)
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;

    // 平行移動：下半身(腿)平滑轉向移動方向 (相對上半身)
    this.legYaw = lerpAngle(this.legYaw, this._targetLegYaw || 0, 0.25);
    if (this.legsRoot) this.legsRoot.rotation.y = this.legYaw;

    // 攻擊冷卻
    if (this.attackTimer > 0) this.attackTimer -= dt;

    // 動畫
    this._animate(dt, moveDir.lengthSq() > 0, moving.run);

    // 受傷閃爍 (整體變紅)
    this._applyHurtFlash();
  }

  _applyHurtFlash() {
    const flashing = this.hurtFlash > 0;
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.material.emissive) {
        obj.material.emissive.setHex(flashing ? 0x661111 : 0x000000);
      }
    });
  }

  _animate(dt, isMoving, running) {
    // ---- 閃避空翻：人物抱團，繞「身體中心」翻 360 度 ----
    if (this.dodgeTimer > 0) {
      const d = CONFIG.dodge;
      const progress = 1 - this.dodgeTimer / d.duration; // 0→1
      const h = 0.9;                    // 身體中心離腳底高度 (翻轉支點)
      const arc = Math.sin(progress * Math.PI) * d.jumpHeight;
      const mag = progress * Math.PI * 2; // 翻轉量 0→2π

      // 用四元數明確組合：先朝向 facing，再繞指定的「世界軸」翻轉，
      // 避免歐拉角順序在 facing≠0 時把翻轉平面轉歪。
      const spin = mag * this.flipSign;
      const qFace = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.facing);

      // 角色的前方向量 (水平) 與右方向量 (水平)
      const fwd = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
      const rightV = new THREE.Vector3(Math.cos(this.facing), 0, -Math.sin(this.facing));

      let axisVec, offX, offZ;
      if (this.flipAxis === "roll") {
        // 側翻：繞「前進方向軸」翻滾 (身體往左/右倒)，位移往側邊
        axisVec = fwd;
        offX = rightV.x;
        offZ = rightV.z;
      } else {
        // 前/後空翻：繞「左右軸」翻滾，位移往前後
        axisVec = rightV;
        offX = fwd.x;
        offZ = fwd.z;
      }

      const qSpin = new THREE.Quaternion().setFromAxisAngle(axisVec, spin);
      this.group.quaternion.copy(qSpin).multiply(qFace);

      // 位置補償：讓翻轉支點在身體中心 (高度 h)
      const dy = h - Math.cos(spin) * h;
      const along = Math.sin(spin) * h;
      this.group.position.set(
        this.pos.x + offX * along,
        this.pos.y + arc + dy,
        this.pos.z + offZ * along
      );

      // 抱團：手腳與關節全部收起縮成一球
      this.legLPivot.rotation.x = -2.4;
      this.legRPivot.rotation.x = -2.4;
      this.kneeL.rotation.x = 2.2;
      this.kneeR.rotation.x = 2.2;
      this.armLPivot.rotation.x = 2.8;
      this.armRPivot.rotation.x = 2.8;
      this.elbowL.rotation.x = -2.0;
      this.elbowR.rotation.x = -2.0;
      return;
    }

    // 非閃避：清掉翻轉殘留
    if (this.group.rotation.x !== 0 || this.group.rotation.z !== 0) {
      this.group.rotation.x = 0;
      this.group.rotation.z = 0;
    }

    const walking = isMoving && this.onGround;
    const targetRatio = walking ? (running ? 1.0 : 0.6) : 0;
    this.speedRatio += (targetRatio - this.speedRatio) * Math.min(1, dt * 10);

    const cadence = running ? 13 : 9;
    if (walking) this.walkPhase += dt * cadence;

    const s = Math.sin(this.walkPhase);
    // 跑步跨步明顯加大 (走路 0.9、跑步 1.6)
    const maxAmp = running ? 1.6 : 0.9;
    const amp = maxAmp * this.speedRatio;

    // ---- 腿：大腿大幅擺動 + 膝蓋在後擺時彎曲 ----
    this.legLPivot.rotation.x = s * amp;
    this.legRPivot.rotation.x = -s * amp;
    // 膝蓋：腿往後擺時彎曲更多 (跑步時抬腿更高)
    this.kneeL.rotation.x = Math.max(0, -s) * amp * 1.4;
    this.kneeR.rotation.x = Math.max(0, s) * amp * 1.4;

    // ---- 手臂：與腿反相擺動 + 手肘微彎 + 手腕輕擺 ----
    this.armLPivot.rotation.x = -s * amp * 0.95;
    this.elbowL.rotation.x = -0.25 - Math.max(0, s) * amp * 0.6;
    if (this.wristL) this.wristL.rotation.x = s * 0.2 * this.speedRatio;
    if (!this.attacking) {
      this.armRPivot.rotation.x = s * amp * 0.95 + 0.15;
      this.elbowR.rotation.x = -0.25 - Math.max(0, -s) * amp * 0.6;
      if (this.wristR) this.wristR.rotation.x = -s * 0.2 * this.speedRatio;
    }

    // 身體上下起伏 (跑步彈跳更大) + 輕微搖擺
    const bobAmt = running ? 0.16 : 0.1;
    const bob = Math.abs(Math.cos(this.walkPhase)) * bobAmt * this.speedRatio;
    this.group.position.y = this.pos.y + bob;
    this.group.rotation.z = s * 0.05 * this.speedRatio;

    // 頸關節：隨走路輕微點頭 + 左右微轉，增加生氣
    if (this.headPivot) {
      this.headPivot.rotation.x = s * 0.04 * this.speedRatio;
      this.headPivot.rotation.y = Math.cos(this.walkPhase) * 0.05 * this.speedRatio;
    }

    // ---- 施法姿勢：左手高舉朝天召喚閃電 (施法期間覆蓋左手走路擺動) ----
    if (this.castTimer > 0) {
      this.armLPivot.rotation.x = 2.9 + Math.sin(performance.now() * 0.02) * 0.15; // 舉高微顫
      this.armLPivot.rotation.z = 0.3;
      this.elbowL.rotation.x = -0.1;
    } else {
      this.armLPivot.rotation.z = 0;
    }

    // 連段窗口倒數 (供接續下一段)
    if (this.comboWindowTimer > 0) this.comboWindowTimer -= dt;

    // ---- 連段揮劍：前 4 段交替劈砍，第 5 段大橫掃 ----
    if (this.attacking) {
      this.swingTimer -= dt;
      const S = CONFIG.sword;
      const progress = 1 - this.swingTimer / this.swingDuration;
      const e = 1 - Math.pow(1 - progress, 3); // easeOut
      const isFinisher = this.comboStep >= S.comboCount;

      if (isFinisher) {
        // 第 5 段：大範圍橫掃 (手臂由右後方水平掃到左前方) + 身體大幅扭轉
        this.armRPivot.rotation.x = -1.4;             // 手臂水平前舉
        this.armRPivot.rotation.y = 1.7 - e * 3.4;    // 右(+)掃到左(-) 接近半圈
        this.armRPivot.rotation.z = 0.2;
        this.elbowR.rotation.x = -0.1;
        if (this.wristR) this.wristR.rotation.x = -0.3 + Math.sin(e * Math.PI) * 0.6; // 甩腕
        this.armLPivot.rotation.x = 0.2;
        this.armLPivot.rotation.y = -0.8 + e * 1.2;
        this.bodyTwist = (0.6 - e * 1.2) * 0.8;       // 大幅轉腰
        this.bodyPitch = Math.sin(progress * Math.PI) * 0.2;
      } else {
        // 前 4 段各有不同軌跡：1 上劈 / 2 右斜劈 / 3 左斜劈 / 4 突刺
        const raise = progress < 0.3 ? progress / 0.3 : 1;
        const chop = progress < 0.3 ? 0 : (progress - 0.3) / 0.7;
        const ce = 1 - Math.pow(1 - chop, 3);
        const step = this.comboStep;

        if (step === 4) {
          // 突刺：手臂前伸、手肘由彎到直、手腕前戳，身體前傾
          this.armRPivot.rotation.x = -1.5;
          this.armRPivot.rotation.y = 0;
          this.armRPivot.rotation.z = 0;
          this.elbowR.rotation.x = -1.4 + ce * 1.3;   // 收回 → 刺出
          if (this.wristR) this.wristR.rotation.x = -0.3 + ce * 0.3;
          this.armLPivot.rotation.x = 0.3;
          this.armLPivot.rotation.y = 0.3;
          this.bodyTwist = -0.15 + ce * 0.1;
          this.bodyPitch = ce * 0.35;                  // 前傾送出
        } else {
          // 1 上劈(sideSign 0) / 2 右斜(+1) / 3 左斜(-1)
          const sideSign = step === 2 ? 1 : step === 3 ? -1 : 0;
          this.armRPivot.rotation.x = -Math.PI + ((-0.4) - (-Math.PI)) * ce * raise;
          this.armRPivot.rotation.y = sideSign * (0.9 - ce * 1.8);  // 斜劈左右掃
          this.armRPivot.rotation.z = 0;
          this.elbowR.rotation.x = -0.1 - (1 - ce) * 0.3;
          // 手腕甩動：劈到後段快速下壓 (加速感)
          if (this.wristR) this.wristR.rotation.x = -0.2 - ce * 0.5;
          this.armLPivot.rotation.x = 0.2 - ce * 0.3;
          this.armLPivot.rotation.y = 0;
          this.bodyTwist = sideSign * (0.2 - ce * 0.4) * 0.6;
          this.bodyPitch = -0.12 * raise + ce * 0.32;
        }
      }

      // 一段結束：接續下一段 或 收招
      if (this.swingTimer <= 0) {
        if (this.comboQueued && this.comboStep < S.comboCount) {
          this._startSwing(this.comboStep + 1);
        } else {
          this.attacking = false;
          this.comboStep = 0;
          this.comboWindowTimer = S.comboWindow;
          this.attackTimer = S.cooldown;
          this.armRPivot.rotation.y = 0;
          this.armRPivot.rotation.z = 0;
          this.armLPivot.rotation.y = 0;
          if (this.wristR) this.wristR.rotation.x = 0;
          this.bodyTwist = 0;
          this.bodyPitch = 0;
        }
      }
    } else {
      this.bodyTwist = (this.bodyTwist || 0) * 0.8;
      this.bodyPitch = (this.bodyPitch || 0) * 0.8;
    }

    // 整體朝向只用 facing；上半身的扭轉/前傾/重心套在 spine (腰)，下半身站穩更自然
    this.group.rotation.y = this.facing;
    const busy = this.attacking || this.castTimer > 0 || this.dodgeTimer > 0;
    if (this.spine) {
      const now = performance.now() * 0.001;
      // 走路：上半身反向扭轉 + 重心左右轉移 (rotation.z)
      const walkTwist = busy ? 0 : Math.sin(this.walkPhase) * 0.1 * this.speedRatio;
      const weightShift = busy ? 0 : Math.cos(this.walkPhase) * 0.06 * this.speedRatio;
      // 待機呼吸：站著不動時 (speedRatio≈0) 腰部緩慢起伏
      const idle = 1 - Math.min(1, this.speedRatio * 3);
      const breathe = busy ? 0 : Math.sin(now * 1.6) * 0.03 * idle;

      this.spine.rotation.y = (this.bodyTwist || 0) + walkTwist;
      this.spine.rotation.x = (this.bodyPitch || 0) + breathe;
      this.spine.rotation.z = weightShift;

      // 待機呼吸：手臂與頭極輕微起伏，避免完全僵住
      if (!busy && idle > 0.5) {
        const b = Math.sin(now * 1.6) * 0.05 * idle;
        this.armLPivot.rotation.x += b;
        this.armRPivot.rotation.x += b;
        if (this.headPivot) this.headPivot.rotation.x += Math.sin(now * 1.6 + 0.5) * 0.02 * idle;
      }
    }

    // 走路時腳掌隨膝擺動輕微翹起 (觸地感)，讓步伐更自然
    if (!busy && this.speedRatio > 0.05) {
      const sw = Math.sin(this.walkPhase);
      // 已由膝關節帶動，這裡加身體整體極輕微上下 (走路節奏，疊加在既有 bob 上)
    }
  }
}

// 角度插值 (處理 -PI ~ PI 環繞)
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
