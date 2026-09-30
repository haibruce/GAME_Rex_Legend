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

    // 平台偵測：是否為觸控裝置 (手機/平板)
    this.isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

    // 觸控搖桿狀態
    this.touchMove = null;     // {x, z} 正規化移動方向，null=沒在移動
    this.touchRun = true;      // 手機預設跑步
    this.magicQueued = false;  // (保留) 觸控魔法佇列
    this.pinchDelta = 0;       // 雙指縮放累積量

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

    if (this.isTouch) this._setupTouch();
  }

  // 觸控操作：左半搖桿移動、右半拖曳視角 + 點擊攻擊 / 雙擊魔法
  _setupTouch() {
    const moveZone = document.getElementById("tc-move-zone");
    const lookZone = document.getElementById("tc-look-zone");
    const base = document.getElementById("tc-stick-base");
    const knob = document.getElementById("tc-stick-knob");

    // ---- 左半：虛擬搖桿 ----
    let moveId = null, ox = 0, oy = 0;
    const R = 60; // 搖桿最大位移
    if (moveZone) {
      moveZone.addEventListener("touchstart", (e) => {
        const t = e.changedTouches[0];
        moveId = t.identifier;
        ox = t.clientX; oy = t.clientY;
        if (base) { base.style.display = "block"; base.style.left = ox + "px"; base.style.top = oy + "px"; }
        if (knob) knob.style.transform = "translate(-50%,-50%)";
        e.preventDefault();
      }, { passive: false });
      moveZone.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== moveId) continue;
          let dx = t.clientX - ox, dy = t.clientY - oy;
          const len = Math.hypot(dx, dy);
          const cl = Math.min(len, R);
          const nx = len > 0 ? dx / len : 0, ny = len > 0 ? dy / len : 0;
          if (knob) knob.style.transform = `translate(${-50 + nx * cl / R * 50}%, ${-50 + ny * cl / R * 50}%)`;
          // 螢幕 y 往下 = 世界前方 (螢幕上=前)，這裡 z 用 -ny (上滑=前進)
          if (len > 8) this.touchMove = { x: nx, z: -ny };
          else this.touchMove = null;
        }
        e.preventDefault();
      }, { passive: false });
      const endMove = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === moveId) { moveId = null; this.touchMove = null; if (base) base.style.display = "none"; }
        }
      };
      moveZone.addEventListener("touchend", endMove);
      moveZone.addEventListener("touchcancel", endMove);
    }

    // ---- 右半：單指拖曳視角 (攻擊/魔法改用獨立按鈕，這裡不再處理點擊) ----
    let lookId = null, lx = 0, ly = 0;
    if (lookZone) {
      lookZone.addEventListener("touchstart", (e) => {
        if (lookId !== null) return; // 已有一指在轉視角
        const t = e.changedTouches[0];
        lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        e.preventDefault();
      }, { passive: false });
      lookZone.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== lookId) continue;
          this.mouseDX += t.clientX - lx; this.mouseDY += t.clientY - ly;
          lx = t.clientX; ly = t.clientY;
        }
        e.preventDefault();
      }, { passive: false });
      const endLook = (e) => {
        for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
      };
      lookZone.addEventListener("touchend", endLook);
      lookZone.addEventListener("touchcancel", endLook);
    }

    // ---- 雙指縮放 (pinch)：全畫面偵測，兩指距離變化 → 縮放量 ----
    this.pinchDelta = 0;
    let pinchPrev = null;
    const activeTouches = new Map();
    const trackPinch = (e) => {
      for (const t of e.changedTouches) activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    };
    document.addEventListener("touchstart", trackPinch, { passive: true });
    document.addEventListener("touchmove", (e) => {
      for (const t of e.touches) {
        if (activeTouches.has(t.identifier)) activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
      if (e.touches.length >= 2) {
        const a = e.touches[0], b = e.touches[1];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinchPrev !== null) this.pinchDelta += (pinchPrev - d); // 併攏(距離減小)=拉近
        pinchPrev = d;
      }
    }, { passive: true });
    const clearPinch = (e) => {
      for (const t of e.changedTouches) activeTouches.delete(t.identifier);
      if (e.touches.length < 2) pinchPrev = null;
    };
    document.addEventListener("touchend", clearPinch, { passive: true });
    document.addEventListener("touchcancel", clearPinch, { passive: true });
  }

  // 讀取並清除累積的縮放量 (雙指 pinch)
  consumePinch() {
    const d = this.pinchDelta;
    this.pinchDelta = 0;
    return d;
  }

  consumeMagic() {
    const m = this.magicQueued;
    this.magicQueued = false;
    return m;
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
