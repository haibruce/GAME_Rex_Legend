import * as THREE from "three";
import { CONFIG } from "./config.js";
import { Input } from "./input.js";
import { World } from "./world.js";
import { Player } from "./player.js";
import { Slime } from "./slime.js";
import { Rabbit } from "./rabbit.js";
import { LightningMagic, FlameMagic, SwordWave } from "./magic.js";
import { Progression } from "./progression.js";
import { BombManager } from "./bomb.js";
import { MegaBoss } from "./megaboss.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.input = new Input(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

    this.world = new World(this.scene);
    this.player = new Player(this.scene);
    this.magic = new LightningMagic(this.scene);
    this.flame = new FlameMagic(this.scene);
    this.progression = new Progression();
    this.bombs = new BombManager(this.scene, this.world);

    this.slimes = [];
    this.respawnQueue = []; // 待重生計時
    this.score = 0;
    this.running = false;

    // 擊殺分類統計 (種類 → 累積擊殺數)
    this.killCounts = { slime: 0, boss: 0, rabbit: 0 };
    this.killSinceBoss = 0; // 距上次召喚大 Boss 的擊殺數
    this.megaBosses = [];   // 場上的大 Boss
    this.swordWaves = [];   // 飛行中的劍氣

    // 攝影機環繞角度與距離 (距離可縮放)
    this.camYaw = 0;
    this.camPitch = 0.25;
    this.camDistance = CONFIG.camera.distance; // 目前縮放距離

    this._spawnInitialSlimes();
    this._resize();
    window.addEventListener("resize", () => this._resize());

    // UI
    this.hp_fill = document.getElementById("health-fill");
    this.hp_text = document.getElementById("health-text");
    this.scoreEl = document.getElementById("score");
    this.crosshair = document.getElementById("crosshair");
    this.startScreen = document.getElementById("start-screen");
    this.deathScreen = document.getElementById("death-screen");
    this.pauseScreen = document.getElementById("pause-screen");
    this.hurtVignette = document.getElementById("hurt-vignette");
    this.levelEl = document.getElementById("level");
    this.xpFill = document.getElementById("xp-fill");
    this.levelupEl = document.getElementById("levelup");
    this.killSlimeEl = document.getElementById("kill-slime");
    this.killBossEl = document.getElementById("kill-boss");
    this.killRabbitEl = document.getElementById("kill-rabbit");
    this.bossWarnEl = document.getElementById("boss-warn");
    this.bombInvEl = document.getElementById("bomb-count-inv");
    this.pickupHintEl = document.getElementById("pickup-hint");

    this.paused = false;
    this.targetSlimeCount = CONFIG.slime.count;

    document.getElementById("start-btn").addEventListener("click", () => this._start());
    document.getElementById("respawn-btn").addEventListener("click", () => this._respawn());
    document.getElementById("resume-btn").addEventListener("click", () => this._resume());
    this._setupMenu();

    // 平台偵測：手機顯示觸控介面、切換操作與顯示
    this.isMobile = this.input.isTouch;
    if (this.isMobile) {
      document.body.classList.add("mobile");
      const tui = document.getElementById("touch-ui");
      if (tui) tui.classList.add("hidden"); // 開始後才顯示
      const bombBtn = document.getElementById("tc-bomb");
      const escBtn = document.getElementById("tc-esc");
      if (bombBtn) bombBtn.addEventListener("click", () => this._handleBombActionForce());
      if (escBtn) escBtn.addEventListener("click", () => { this.paused ? this._resume() : this._pause(); });
      this._setupActionButtons();
    }

    // 桌機：遊戲中失去滑鼠鎖定 (ESC/切換視窗) 自動暫停 (手機不用 pointer lock)
    document.addEventListener("pointerlockchange", () => {
      if (this.isMobile) return;
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && this.running && this.player.alive) {
        this._pause();
      }
    });

    // PC 滑鼠滾輪：縮放第三人稱距離
    window.addEventListener("wheel", (e) => {
      if (!this.running || this.paused) return;
      this._zoomCamera(Math.sign(e.deltaY) * CONFIG.camera.zoomStep);
    }, { passive: true });

    this.clock = new THREE.Clock();
    this._loop();
  }

  _spawnInitialSlimes() {
    const n = this.targetSlimeCount ?? CONFIG.slime.count;
    for (let i = 0; i < n; i++) {
      this.slimes.push(this._makeSlime());
    }
  }

  // 依機率生成敵人：兔子 / 史萊姆頭目 / 普通史萊姆
  _makeSlime() {
    const pos = this._randomSpawnPos();
    if (Math.random() < CONFIG.rabbit.spawnChance) {
      return new Rabbit(this.scene, pos);
    }
    const isBoss = Math.random() < CONFIG.slime.bossChance;
    return new Slime(this.scene, pos, isBoss);
  }

  _randomSpawnPos() {
    const bound = this.world.bound - 5;
    let x, z;
    do {
      x = (Math.random() - 0.5) * bound * 2;
      z = (Math.random() - 0.5) * bound * 2;
    } while (Math.hypot(x, z) < 15); // 別生在玩家臉上
    return new THREE.Vector3(x, 0, z);
  }

  _start() {
    this.startScreen.classList.add("hidden");
    this.running = true;
    this.paused = false;
    if (this.isMobile) {
      const tui = document.getElementById("touch-ui");
      if (tui) tui.classList.remove("hidden"); // 顯示觸控介面
      // 手機不需 pointer lock，視角用觸控拖曳
    } else {
      this.crosshair.style.display = "block";
      this.input.requestLock();
    }
  }

  // 炸彈鈕/觸控直接觸發拾取或投擲 (不經 E 鍵佇列)
  _handleBombActionForce() {
    this.bombs.handleAction(this.player.pos, this.player.facing);
  }

  // 手機攻擊/魔法改為獨立按鈕，複用 input 的旗標:
  // - 攻擊鈕: 按住 = leftDown (連段)，按下瞬間也觸發首擊 (attackQueued)
  // - 魔法鈕: 按住 = rightDown (>=1秒轉火焰)，放開時 <1秒 = 短按閃電 (rightClickQueued)
  _setupActionButtons() {
    const atk = document.getElementById("tc-attack");
    const mag = document.getElementById("tc-magic");

    if (atk) {
      const down = (e) => {
        e.preventDefault();
        this.input.leftDown = true;      // 按住連段
        this.input.attackQueued = true;  // 首擊
      };
      const up = (e) => {
        e.preventDefault();
        this.input.leftDown = false;
      };
      atk.addEventListener("touchstart", down, { passive: false });
      atk.addEventListener("touchend", up, { passive: false });
      atk.addEventListener("touchcancel", up, { passive: false });
      // 保底: 支援滑鼠 (桌機測試觸控 UI)
      atk.addEventListener("mousedown", down);
      atk.addEventListener("mouseup", up);
    }

    if (mag) {
      const down = (e) => {
        e.preventDefault();
        this.input.rightDown = true;                  // 按住 → 依時間轉火焰
        this.input.rightDownAt = performance.now();
      };
      const up = (e) => {
        e.preventDefault();
        if (this.input.rightDown) {
          const held = (performance.now() - this.input.rightDownAt) / 1000;
          if (held < 1.0) this.input.rightClickQueued = true; // 短按 → 閃電
          this.input.rightDown = false;
        }
      };
      mag.addEventListener("touchstart", down, { passive: false });
      mag.addEventListener("touchend", up, { passive: false });
      mag.addEventListener("touchcancel", up, { passive: false });
      mag.addEventListener("mousedown", down);
      mag.addEventListener("mouseup", up);
    }
  }

  _respawn() {
    this.deathScreen.classList.add("hidden");
    this.crosshair.style.display = "block";
    this.player.respawn();
    this.score = 0;
    this.killCounts = { slime: 0, boss: 0, rabbit: 0 };
    this.killSinceBoss = 0;
    this.megaBosses = [];
    for (const w of this.swordWaves) w.dispose();
    this.swordWaves = [];
    this.progression.reset();
    this.player.maxHealth = this.progression.maxHealth;
    this.player.health = this.player.maxHealth;
    // 清掉並重建史萊姆
    for (const s of this.slimes) s.dispose();
    this.slimes = [];
    this.respawnQueue = [];
    this._spawnInitialSlimes();
    this.bombs.reset();
    this.running = true;
    this.paused = false;
    this.input.requestLock();
  }

  // 設定選單：怪物數量、滑鼠靈敏度 (即時套用)
  _setupMenu() {
    const countSlider = document.getElementById("slime-count");
    const countVal = document.getElementById("slime-count-val");
    countSlider.value = String(CONFIG.slime.count);
    countVal.textContent = String(CONFIG.slime.count);
    countSlider.addEventListener("input", () => {
      const n = parseInt(countSlider.value, 10);
      countVal.textContent = String(n);
      this.targetSlimeCount = n;
      this._applySlimeCount();
    });

    // 滑鼠靈敏度 (PC)：1~10 對應實際係數 (預設 4 = 目前手感)
    const sensSlider = document.getElementById("sensitivity");
    const sensVal = document.getElementById("sensitivity-val");
    const baseSens = CONFIG.camera.sensitivity / 4;
    if (sensSlider) {
      sensSlider.addEventListener("input", () => {
        const v = parseInt(sensSlider.value, 10);
        sensVal.textContent = String(v);
        CONFIG.camera.sensitivity = baseSens * v;
      });
    }

    // 觸控靈敏度 (手機)：與滑鼠獨立，1~10 對應實際係數 (預設 4 = 目前手感)
    const touchSlider = document.getElementById("touch-sensitivity");
    const touchVal = document.getElementById("touch-sensitivity-val");
    const baseTouch = CONFIG.camera.touchSensitivity / 4;
    if (touchSlider) {
      touchSlider.addEventListener("input", () => {
        const v = parseInt(touchSlider.value, 10);
        touchVal.textContent = String(v);
        CONFIG.camera.touchSensitivity = baseTouch * v;
      });
    }

    // 依平台只顯示對應的靈敏度設定 (手機顯示觸控、PC 顯示滑鼠)
    const mouseSetting = document.getElementById("setting-mouse-sens");
    const touchSetting = document.getElementById("setting-touch-sens");
    if (this.input.isTouch) {
      if (mouseSetting) mouseSetting.style.display = "none";
    } else {
      if (touchSetting) touchSetting.style.display = "none";
    }

    // 炸彈數量
    const bombSlider = document.getElementById("bomb-count");
    const bombVal = document.getElementById("bomb-count-val");
    if (bombSlider) {
      bombSlider.value = String(CONFIG.bomb.maxOnField);
      bombVal.textContent = String(CONFIG.bomb.maxOnField);
      bombSlider.max = String(CONFIG.bomb.maxOnFieldLimit);
      bombSlider.addEventListener("input", () => {
        const n = parseInt(bombSlider.value, 10);
        bombVal.textContent = String(n);
        this.bombs.maxOnField = n;
      });
    }

    // 測試工具：+10 等級
    const levelBtn = document.getElementById("levelup-test-btn");
    if (levelBtn) {
      levelBtn.addEventListener("click", () => {
        for (let i = 0; i < 10; i++) this.progression.forceLevelUp();
        this.player.maxHealth = this.progression.maxHealth;
        this.player.health = this.player.maxHealth;
        this._showLevelUp();
      });
    }
  }

  // 讓場上 (含待重生) 的史萊姆總數趨近目標值
  _applySlimeCount() {
    const alive = this.slimes.filter((s) => s.alive);
    const pending = this.respawnQueue.length;
    let total = alive.length + pending;

    // 太多 → 直接移除多的 (從尾端拿)
    while (total > this.targetSlimeCount) {
      if (this.respawnQueue.length > 0) {
        this.respawnQueue.pop();
      } else {
        const s = this.slimes.find((x) => x.alive);
        if (!s) break;
        s.dispose();
        this.slimes = this.slimes.filter((x) => x !== s);
      }
      total--;
    }
    // 太少 → 補生成
    while (total < this.targetSlimeCount) {
      this.slimes.push(this._makeSlime());
      total++;
    }
  }

  _pause() {
    this.paused = true;
    this.crosshair.style.display = "none";
    this.pauseScreen.classList.remove("hidden");
  }

  _resume() {
    this.pauseScreen.classList.add("hidden");
    this.paused = false;
    if (this.isMobile) return; // 手機不需 pointer lock
    this.crosshair.style.display = "block";
    this.input.requestLock();
  }

  _die() {
    this.running = false;
    this.paused = false;
    this.pauseScreen.classList.add("hidden");
    this.crosshair.style.display = "none";
    document.getElementById("death-score").textContent = `擊殺數: ${this.score}`;
    this.deathScreen.classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _updateCameraFromMouse() {
    const { dx, dy } = this.input.consumeMouse();
    const cam = CONFIG.camera;
    // 手機與 PC 用各自的靈敏度 (選單可分別調整)
    const sens = this.isMobile ? cam.touchSensitivity : cam.sensitivity;
    // 手機拖曳右=視角右轉 (較直覺)；PC 沿用原本反向
    this.camYaw += (this.isMobile ? dx : -dx) * sens;
    this.camPitch += dy * sens;
    this.camPitch = Math.max(cam.minPitch, Math.min(cam.maxPitch, this.camPitch));
  }

  // 依攝影機朝向把 WASD / 觸控搖桿 轉成世界移動方向
  _getMoveDir() {
    const forward = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const dir = new THREE.Vector3();

    // 觸控搖桿優先 (手機)
    const tm = this.input.touchMove;
    if (tm) {
      dir.addScaledVector(forward, tm.z);
      dir.addScaledVector(right, -tm.x); // 與鍵盤 A/D 反轉一致
    } else {
      if (this.input.isDown("KeyW")) dir.add(forward);
      if (this.input.isDown("KeyS")) dir.sub(forward);
      if (this.input.isDown("KeyD")) dir.sub(right);   // A/D 反轉
      if (this.input.isDown("KeyA")) dir.add(right);
    }

    if (dir.lengthSq() > 0) dir.normalize();
    return dir;
  }

  _positionCamera() {
    const cam = CONFIG.camera;
    const p = this.player.pos;
    const lookY = p.y + cam.lookHeight; // 注視點 (角色身上)

    // 計算某個距離下的攝影機位置
    const camPosAt = (dist) => {
      const horiz = Math.cos(this.camPitch) * dist;
      const offX = Math.sin(this.camYaw) * horiz;
      const offZ = Math.cos(this.camYaw) * horiz;
      const offY = cam.height + Math.sin(this.camPitch) * dist;
      return new THREE.Vector3(p.x - offX, p.y + offY, p.z - offZ);
    };

    // 目前縮放距離
    let dist = this.camDistance;
    let desired = camPosAt(dist);

    // 防穿地：若攝影機位置低於該處地面 (+緩衝)，就縮短距離、保持向上仰角，
    // 讓鏡頭往角色拉近並上抬，而不是鑽到地板下。
    const margin = 0.8;
    for (let i = 0; i < 6; i++) {
      const groundAtCam = this.world.getHeight(desired.x, desired.z) + margin;
      if (desired.y >= groundAtCam) break;
      dist *= 0.8; // 拉近
      if (dist < cam.minDistance * 0.5) { dist = cam.minDistance * 0.5; desired = camPosAt(dist); break; }
      desired = camPosAt(dist);
    }
    // 最後保險：仍不低於地面
    const floorY = this.world.getHeight(desired.x, desired.z) + margin;
    if (desired.y < floorY) desired.y = floorY;

    this.camera.position.lerp(desired, 0.25);
    this.camera.lookAt(p.x, lookY, p.z);
  }

  // 縮放攝影機距離 (delta>0 拉遠、<0 拉近)
  _zoomCamera(delta) {
    const cam = CONFIG.camera;
    this.camDistance = Math.max(cam.minDistance, Math.min(cam.maxDistance, this.camDistance + delta));
  }

  _handleAttack() {
    // 按住左鍵 → 持續嘗試攻擊/接續連段 (startAttack 內部有冷卻與連段窗口控制)
    if (this.input.isLeftHeld() || this.input.consumeAttack()) {
      this.player.startAttack();
    }
  }

  // 玩家受傷：畫面紅色暈染閃一下
  _flashHurt() {
    this.hurtVignette.classList.add("show");
    clearTimeout(this._hurtTimer);
    this._hurtTimer = setTimeout(() => {
      this.hurtVignette.classList.remove("show");
    }, 80);
  }

  // 中鍵閃避：依 A/S/D 決定方向，預設向前 (W 或無方向鍵時)
  _handleDodge() {
    if (!this.input.consumeDodge()) return;

    // 以攝影機朝向為基準的前 / 右向量
    const forward = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));

    let dir = new THREE.Vector3();
    let axis = "pitch";  // 前空翻
    let sign = 1;

    // A/D 側翻 (往左/右)、W/預設前翻、S 後翻
    if (this.input.isDown("KeyS")) {
      dir.copy(forward).multiplyScalar(-1); // 後翻
      axis = "pitch";
      sign = -1;
    } else if (this.input.isDown("KeyA")) {
      // 往左側翻：位移往左 (=-right)，繞前進軸負向
      dir.copy(right).multiplyScalar(-1);
      axis = "roll";
      sign = -1;
    } else if (this.input.isDown("KeyD")) {
      // 往右側翻：位移往右 (=+right)，繞前進軸正向
      dir.copy(right);
      axis = "roll";
      sign = 1;
    } else {
      dir.copy(forward);                     // 預設向前空翻
      axis = "pitch";
      sign = 1;
    }

    this.player.startDodge(dir, axis, sign);
  }

  // 右鍵：短按放閃電，長按 (>=1秒) 持續放火焰
  _handleMagic(dt) {
    // 同步魔法傷害倍率與等級 (經驗值升級提升強度與範圍)
    this.magic.damageMultiplier = this.progression.magicMultiplier;
    this.magic.level = this.progression.level;
    this.flame.damageMultiplier = this.progression.magicMultiplier;

    // 短按(PC 右鍵) 或 觸控雙擊 → 閃電
    if (this.input.consumeRightClick() || this.input.consumeMagic()) {
      if (this.magic.cast()) {
        this.player.startCast(CONFIG.lightning.duration + CONFIG.lightning.tornadoDuration);
      }
    }

    // 長按 → 火焰 (持續)
    const firing = this.input.isRightHeldForFire();
    if (firing) this.player.startCast(0.2); // 維持舉手施法姿勢
    // 計分由 justDied 掃描統一處理，這裡不重複
    this.flame.update(dt, firing, this.player, this.slimes, () => {}, this.progression.level);
  }

  // E 鍵：身邊有炸彈就拾取，否則有庫存就投擲
  _handleBombAction() {
    if (!this.input.consumeAction()) return;
    this.bombs.handleAction(this.player.pos, this.player.facing);
  }

  // 敵人被擊殺：分類統計 + 計分 + 檢查是否召喚大 Boss
  _onEnemyKilled(enemy) {
    // 大 Boss 死亡：只計分，不納入分類統計、不觸發召喚
    if (enemy.isMega) {
      this._gainXp();
      return;
    }

    // 分類：兔子 / 史萊姆頭目 / 普通史萊姆
    let kind = "slime";
    if (enemy.isRabbit) kind = "rabbit";
    else if (enemy.isBoss) kind = "boss";
    this.killCounts[kind]++;
    this.killSinceBoss++;

    this._gainXp();

    // 達到門檻 → 召喚大 Boss
    if (this.killSinceBoss >= CONFIG.megaBoss.summonAt) {
      this.killSinceBoss = 0;
      this._summonMegaBoss();
    }
  }

  // 依「累積擊殺最多的種類」召喚對應大 Boss
  _summonMegaBoss() {
    const c = this.killCounts;
    let kind = "slime";
    if (c.rabbit >= c.slime && c.rabbit >= c.boss) kind = "rabbit";
    else if (c.boss >= c.slime && c.boss >= c.rabbit) kind = "boss";

    // 以玩家為原點，隨機方向、指定距離外出現
    const ang = Math.random() * Math.PI * 2;
    const d = CONFIG.megaBoss.spawnDist;
    const x = this.player.pos.x + Math.cos(ang) * d;
    const z = this.player.pos.z + Math.sin(ang) * d;
    const bx = Math.max(-this.world.bound, Math.min(this.world.bound, x));
    const bz = Math.max(-this.world.bound, Math.min(this.world.bound, z));

    const boss = new MegaBoss(this.scene, new THREE.Vector3(bx, 0, bz), kind);
    this.slimes.push(boss);       // 併入敵人陣列，共用更新/命中邏輯
    this.megaBosses.push(boss);
    this._showBossWarning(kind);
  }

  _showBossWarning(kind) {
    if (!this.bossWarnEl) return;
    const name = kind === "rabbit" ? "巨型兔王" : kind === "boss" ? "史萊姆之王" : "巨型史萊姆";
    this.bossWarnEl.textContent = `⚠ ${name} 出現了！`;
    this.bossWarnEl.classList.add("show");
    clearTimeout(this._bossWarnTimer);
    this._bossWarnTimer = setTimeout(() => this.bossWarnEl.classList.remove("show"), 2500);
  }

  // 統一處理擊殺：計分、給經驗值、視情況重生
  _gainXp() {
    this.score++;
    const leveled = this.progression.addKill();
    if (leveled) {
      // 升級：血量上限提高並回滿
      this.player.maxHealth = this.progression.maxHealth;
      this.player.health = this.player.maxHealth;
      this._showLevelUp();
    }
    const aliveCount = this.slimes.filter((s) => s.alive).length;
    if (aliveCount + this.respawnQueue.length <= this.targetSlimeCount) {
      this.respawnQueue.push(CONFIG.slime.respawnDelay);
    }
  }

  _showLevelUp() {
    if (!this.levelupEl) return;
    this.levelupEl.textContent = `升級！ Lv.${this.progression.level}`;
    this.levelupEl.classList.add("show");
    clearTimeout(this._levelupTimer);
    this._levelupTimer = setTimeout(() => this.levelupEl.classList.remove("show"), 1500);
  }

  _resolveSwordHits() {
    // 第 5 段起手 → 發射劍氣
    if (this.player.consumeWaveRequest()) {
      this._fireSwordWave();
    }

    // 取得當前段的命中資料 (每段只判定一次)
    const info = this.player.consumeHitInfo();
    if (!info) return;

    // 前四段 (非收尾) 也附帶一道短距離劍氣
    if (!info.finisher) this._fireSwordWave(true);

    const p = this.player.pos;
    const facing = this.player.facing;
    const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));

    for (const slime of this.slimes) {
      if (!slime.alive) continue;
      const dx = slime.pos.x - p.x;
      const dz = slime.pos.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > info.range + slime.radius) continue;

      const toSlime = new THREE.Vector3(dx, 0, dz).normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, fwd.dot(toSlime))));
      if (angle <= info.arc / 2) {
        slime.takeDamage(info.damage, p); // 擊殺計分統一由 justDied 掃描處理
      }
    }
  }

  // 發射劍氣投射物。short=true 為前四段的短距離劍氣。
  _fireSwordWave(short = false) {
    const facing = this.player.facing;
    const wave = new SwordWave(
      this.scene,
      new THREE.Vector3(this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z),
      facing,
      short
    );
    this.swordWaves.push(wave);
  }

  _updateSwordWaves(dt) {
    for (const w of this.swordWaves) {
      w.update(dt, this.slimes);
    }
    this.swordWaves = this.swordWaves.filter((w) => {
      if (w.done) { w.dispose(); return false; }
      return true;
    });
  }

  _updateSlimes(dt) {
    for (const slime of this.slimes) {
      const hit = slime.update(dt, this.player.pos, this.world, this.camera);
      if (hit && this.player.alive) {
        // 傳入史萊姆位置，讓玩家朝反方向被擊退 (頭目傷害較高)
        const hurt = this.player.takeDamage(slime.attackDamage, slime.pos);
        if (hurt) this._flashHurt(); // 真的受傷才閃畫面
        if (!this.player.alive) this._die();
      }

      // 大 Boss 專屬技能處理
      if (slime.isMega && slime.alive) {
        // 技能範圍傷害 (震地/飛撲落地衝擊)
        const sk = slime.consumeSkillDamage();
        if (sk && this.player.alive) {
          const pd = Math.hypot(this.player.pos.x - sk.x, this.player.pos.z - sk.z);
          if (pd <= sk.radius) {
            const hurt = this.player.takeDamage(sk.damage, { x: sk.x, z: sk.z });
            if (hurt) this._flashHurt();
            if (!this.player.alive) this._die();
          }
        }
        // 召喚小史萊姆 (史萊姆之王)
        const summon = slime.consumeSummon();
        for (let i = 0; i < summon; i++) {
          if (this.slimes.length < 120) { // 上限保護
            const ang = Math.random() * Math.PI * 2;
            const r = slime.radius + 2 + Math.random() * 3;
            const sx = slime.pos.x + Math.cos(ang) * r;
            const sz = slime.pos.z + Math.sin(ang) * r;
            this.slimes.push(new Slime(this.scene, new THREE.Vector3(sx, 0, sz), false));
          }
        }
      }
    }
    // 掃描「剛死亡」的敵人 (涵蓋劍/魔法/炸彈擊飛致死) 來計分與分類統計
    for (const s of this.slimes) {
      if (s.justDied) {
        s.justDied = false;
        this._onEnemyKilled(s);
      }
    }

    // 移除已消失的
    this.slimes = this.slimes.filter((s) => {
      if (s.shouldRemove) {
        s.dispose();
        return false;
      }
      return true;
    });
    // 同步清理大 Boss 追蹤陣列
    this.megaBosses = this.megaBosses.filter((b) => b.alive || !b.shouldRemove);

    // 處理重生
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      this.respawnQueue[i] -= dt;
      if (this.respawnQueue[i] <= 0) {
        this.respawnQueue.splice(i, 1);
        this.slimes.push(this._makeSlime());
      }
    }
  }

  _updateMagic(dt) {
    // 計分統一由 _updateSlimes 的 justDied 掃描處理，這裡不重複計分
    this.magic.update(dt, this.player, this.slimes, this.world, () => {});
  }

  _updateBombs(dt) {
    this.bombs.update(dt, this.player.pos, (x, z, radius, dmg, playerDmg) => {
      // 炸毀範圍內的可破壞物件 (樹木/木箱/房子塊)
      this.world.applyExplosion(x, z, radius);

      // 超大規模爆炸：範圍內敵人以爆心為圓心「擊飛」出去，落地後才判定失血
      const B = CONFIG.bomb;
      for (const slime of this.slimes) {
        if (!slime.alive || slime.launched) continue;
        const ddx = slime.pos.x - x;
        const ddz = slime.pos.z - z;
        const d = Math.hypot(ddx, ddz);
        if (d <= radius + slime.radius) {
          // 離爆心越近飛越快；方向由爆心指向敵人
          const inv = d > 0.01 ? 1 / d : 0;
          const nx = d > 0.01 ? ddx * inv : (Math.random() - 0.5);
          const nz = d > 0.01 ? ddz * inv : (Math.random() - 0.5);
          const power = B.launchSpeed * (1 - d / (radius + slime.radius) * 0.5);
          const vel = new THREE.Vector3(nx * power, B.launchUp, nz * power);
          slime.launch(vel, dmg); // 落地後才扣血
        }
      }
    });
  }

  _updateHUD() {
    const maxHp = this.player.maxHealth;
    const pct = (this.player.health / maxHp) * 100;
    this.hp_fill.style.width = `${pct}%`;
    this.hp_text.textContent = `HP ${Math.round(this.player.health)} / ${maxHp}`;
    this.scoreEl.textContent = `擊殺: ${this.score}`;

    // 等級與經驗值
    if (this.levelEl) {
      const pr = this.progression;
      this.levelEl.textContent = `Lv.${pr.level}`;
      const xpPct = (pr.xp / pr.xpToNext) * 100;
      this.xpFill.style.width = `${xpPct}%`;
    }

    // 擊殺分類計數
    if (this.killSlimeEl) {
      this.killSlimeEl.textContent = String(this.killCounts.slime);
      this.killBossEl.textContent = String(this.killCounts.boss);
      this.killRabbitEl.textContent = String(this.killCounts.rabbit);
    }

    // 炸彈庫存 + 拾取提示
    if (this.bombInvEl) this.bombInvEl.textContent = String(this.bombs.inventory);
    if (this.pickupHintEl) {
      const canPick = this.bombs.hasPickable(this.player.pos);
      this.pickupHintEl.classList.toggle("show", canPick);
    }
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05); // 夾住避免卡頓爆衝

    if (this.running && !this.paused) {
      // 手機雙指縮放
      const pinch = this.input.consumePinch();
      if (pinch) this._zoomCamera(pinch * 0.02);

      this._updateCameraFromMouse();
      this._handleAttack();
      this._handleDodge();
      this._handleMagic(dt);
      this._handleBombAction();

      const moveDir = this._getMoveDir();
      const wantJump = this.input.isDown("Space");
      const run = this.isMobile ? true : this.input.isCapsLockOn(); // 手機預設跑步；PC 用 Caps Lock
      // Shift = 平行移動 (上半身固定朝前，下半身轉向移動方向)
      const strafe = this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight");
      // 平行移動時，角色上半身固定朝攝影機前方
      const camForward = this.camYaw;

      this.player.update(dt, moveDir, wantJump, this.world, { run, strafe, camForward });
      this._resolveSwordHits();
      this._updateSwordWaves(dt);
      this._updateSlimes(dt);
      this._updateMagic(dt);
      this._updateBombs(dt);
      this.world.update(dt); // 更新可破壞物件的飛散碎片
      this._positionCamera();
      this._updateHUD();
    }

    this.renderer.render(this.scene, this.camera);
  }
}

new Game();
