// 鍵盤 / 滑鼠輸入管理 (含 Pointer Lock)

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.attackQueued = false;
    this.leftDown = false;     // 左鍵是否按住 (連段用)
    this.dodgeQueued = false;
    this.actionQueued = false; // E 鍵：拾取/投擲炸彈
    this.locked = false;

    // 右鍵狀態：短按放閃電、長按 (>=1秒) 持續放火焰
    this.rightDown = false;
    this.rightDownAt = 0;
    this.rightClickQueued = false; // 短按 (放開時 <1秒) 觸發一次

    // 擋掉右鍵選單，讓右鍵能拿來施法
    document.addEventListener("contextmenu", (e) => e.preventDefault());

    this.capsLockOn = false;

    window.addEventListener("keydown", (e) => {
      // E 鍵：單次動作 (拾取/投擲炸彈)，忽略按住連發
      if (e.code === "KeyE" && !e.repeat) {
        this.actionQueued = true;
      }
      this.keys[e.code] = true;
      // Caps Lock 是鎖定鍵，用 modifier state 讀取實際開關狀態
      if (typeof e.getModifierState === "function") {
        this.capsLockOn = e.getModifierState("CapsLock");
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
      if (typeof e.getModifierState === "function") {
        this.capsLockOn = e.getModifierState("CapsLock");
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (typeof e.getModifierState === "function") {
        this.capsLockOn = e.getModifierState("CapsLock");
      }
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.attackQueued = true;
        this.leftDown = true; // 按住連段用
      } else if (e.button === 1) {
        this.dodgeQueued = true; // 滑鼠中鍵：閃避
        e.preventDefault();
      } else if (e.button === 2) {
        this.rightDown = true;
        this.rightDownAt = performance.now();
        e.preventDefault();
      }
    });

    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2 && this.rightDown) {
        const held = (performance.now() - this.rightDownAt) / 1000;
        if (held < 1.0) this.rightClickQueued = true; // 短按 → 閃電
        this.rightDown = false;
      }
    });

    // 避免中鍵觸發瀏覽器自動捲動
    document.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock() {
    this.canvas.requestPointerLock();
  }

  isDown(code) {
    return !!this.keys[code];
  }

  // Caps Lock 是否開啟 (用來當奔跑開關)
  isCapsLockOn() {
    return this.capsLockOn;
  }

  // 每幀讀取後歸零累積量
  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  consumeAttack() {
    const a = this.attackQueued;
    this.attackQueued = false;
    return a;
  }

  isLeftHeld() {
    return this.leftDown;
  }

  consumeDodge() {
    const d = this.dodgeQueued;
    this.dodgeQueued = false;
    return d;
  }

  consumeAction() {
    const a = this.actionQueued;
    this.actionQueued = false;
    return a;
  }

  // 右鍵短按 (放開時 <1秒)：觸發一次閃電
  consumeRightClick() {
    const c = this.rightClickQueued;
    this.rightClickQueued = false;
    return c;
  }

  // 右鍵是否已按住達到火焰施放門檻 (>=1秒)
  isRightHeldForFire() {
    return this.rightDown && (performance.now() - this.rightDownAt) / 1000 >= 1.0;
  }
}
