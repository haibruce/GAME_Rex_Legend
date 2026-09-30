import { CONFIG } from "./config.js";

// 經驗值 / 等級系統。
// 擊殺史萊姆獲得 XP，升級提升血量上限與魔法強度倍率。
export class Progression {
  constructor() {
    this.reset();
  }

  reset() {
    this.level = 1;
    this.xp = 0;
    this.xpToNext = CONFIG.progression.baseXp;
    this.bonusMaxHealth = 0;   // 升級累加的血量上限
    this.magicMultiplier = 1;  // 魔法傷害倍率
  }

  // 擊殺獲得 XP，回傳這次是否升級 (可能一次升多級)
  addKill() {
    let leveledUp = false;
    this.xp += CONFIG.progression.xpPerKill;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this._levelUp();
      leveledUp = true;
    }
    return leveledUp;
  }

  _levelUp() {
    const P = CONFIG.progression;
    this.level++;
    this.bonusMaxHealth += P.healthPerLevel;
    this.magicMultiplier += P.magicPerLevel;
    // 下一級所需 XP 遞增
    this.xpToNext = Math.round(this.xpToNext * P.xpGrowth);
  }

  // 測試用：直接升一級
  forceLevelUp() {
    this._levelUp();
  }

  get maxHealth() {
    return CONFIG.player.maxHealth + this.bonusMaxHealth;
  }
}
