// 遊戲全域參數 —— 想調整手感、難度都改這裡

export const CONFIG = {
  world: {
    size: 200,            // 地面邊長 (正方形)
    obstacleCount: 130,   // 隨機障礙物 (樹/石/木箱等) 數量 (加倍)
    treeRespawn: 12,      // 樹木炸毀後幾秒重生
    groundColor: 0x4a7a3a,
    skyColor: 0x89c4f4,
    fogNear: 60,
    fogFar: 180,
  },

  player: {
    radius: 0.6,          // 碰撞半徑
    height: 1.8,
    walkSpeed: 8,
    runSpeed: 14,
    jumpSpeed: 9,
    gravity: 25,
    maxHealth: 500,
    turnLerp: 0.18,       // 轉身平滑度
    invulnTime: 0.6,      // 受傷後無敵閃爍時間
    knockbackPower: 9,    // 受擊擊退初速
    knockbackUp: 4,       // 受擊時的小跳高度
  },

  dodge: {
    speed: 20,            // 閃避衝刺速度
    duration: 0.45,       // 閃避持續時間 (含空翻)
    cooldown: 0.8,        // 冷卻秒數
    jumpHeight: 2.2,      // 空翻時騰空高度
    invuln: true,         // 閃避期間是否無敵
  },

  lightning: {
    duration: 5.0,        // 施法持續時間 (秒)
    cooldown: 2.0,        // 施法結束後的冷卻秒數 (縮短)
    strikeInterval: 1.0,  // 每隔幾秒觸發一波落雷
    boltsPerWave: 12,     // 一波同時落下的雷數 (Lv1) — x1.5
    boltsPerLevel: 3,     // 每升一級一波多幾道雷 (數量無上限)
    spreadPerLevel: 1.2,  // 每升一級落雷圓半徑增加
    forwardMin: 2,        // (圓形分布未使用，保留相容)
    forwardMax: 16,       // 落雷圓形基礎半徑 (Lv1) — 加大
    spread: 3,            // (圓形分布未使用，保留相容)
    spreadMax: 6,         // (保留相容)
    reachMax: 28,         // 落雷圓形半徑上限 — 加大
    boltRadius: 1.3,      // 單道雷的傷害半徑
    damage: 34,           // 單道雷傷害
    color: 0x9fd8ff,      // 閃電顏色

    // 開場龍捲風 (施法最初，以玩家為圓心)
    tornadoDuration: 2.0, // 龍捲風持續秒數
    tornadoRadius: 14,    // 捲入範圍半徑
    tornadoSpin: 6.4,     // 怪物繞玩家旋轉角速度 (弧度/秒) — x2
    tornadoPull: 2.0,     // 每秒往中心拉近的速度
    tornadoDps: 40,       // 龍捲風每秒對捲入怪物的傷害 — x2
  },

  flame: {
    baseLength: 10,       // 火焰長條長度 (Lv1)
    lengthPerLevel: 0.4,  // 每級增加長度 (平緩成長, 避免高等覆蓋全場)
    baseWidth: 2.2,       // 火焰長條寬度 (Lv1)
    widthPerLevel: 0.08,  // 每級增加寬度 (平緩成長)
    maxLength: 24,        // 火焰長度上限 (範圍封頂, 不再無限變大)
    maxWidth: 5,          // 火焰寬度上限
    dps: 60,              // 每秒基礎傷害 (持續施放)
    dpsPerLevel: 14,      // 每升一級增加的每秒傷害 (加強攻擊力, 無上限)
    color: 0xff6a2b,      // 火焰顏色

    // 吹飛：持續被火焰噴到的怪物，每隔一段時間被吹飛一次，力道隨等級提升
    knockbackInterval: 0.5,  // 同一隻怪多久被吹飛一次 (秒)
    knockbackBase: 10,       // Lv1 水平吹飛初速
    knockbackPerLevel: 1.6,  // 每升一級增加的水平吹飛初速
    knockbackUp: 9,          // 吹飛的垂直上拋初速
    knockbackDamage: 8,      // 落地時的額外傷害 (隨 dps 相關, 小量)
  },

  bomb: {
    maxOnField: 40,       // 場上同時存在的炸彈數 (預設 = 上限 MAX)
    maxOnFieldLimit: 40,  // 選單滑桿上限
    spawnInterval: 3,     // 每隔幾秒嘗試生成一顆 (數量多、生成快一點)
    triggerRadius: 1.5,   // 玩家靠多近會踩爆 (引信觸發)
    pickupRadius: 12.0,   // 玩家靠多近可按 E 拾取
    startInventory: 50,   // 開場預設攜帶的炸彈庫存

    // 投擲 (庫存炸彈丟出去)
    throwSpeed: 18,       // 水平投擲初速
    throwUp: 10,          // 垂直上拋初速
    throwGravity: 28,     // 投擲物重力
    fuse: 3.0,            // 引信秒數 (觸發後幾秒爆炸)
    blastRadius: 26,      // 爆炸範圍半徑 (加大)
    damage: 500,          // 爆炸傷害 (幾乎秒殺範圍內敵人)
    playerDamage: 80,     // 對玩家的傷害 (目前 main 未套用)
    color: 0x222222,      // 炸彈本體顏色
    blastDuration: 1.6,   // 爆炸特效持續時間 (拉長)

    // 擊飛：怪物以炸彈為圓心飛出去，落地後才判定失血
    launchSpeed: 26,      // 水平飛出初速 (離爆心越近越快)
    launchUp: 18,         // 垂直上拋初速
    launchGravity: 30,    // 擊飛時的重力 (落下加速度)
  },

  megaBoss: {
    summonAt: 30,         // 每累積擊殺此數量，召喚一隻大 Boss
    healthMult: 60,       // 血量 = 普通史萊姆 x 此倍率 (再加厚)
    scale: 4.5,           // 體型倍率 (相對普通史萊姆)
    speedMult: 1.0,       // 移動速度倍率
    attackDamage: 40,     // 接觸傷害
    attackCooldown: 0.8,  // 接觸攻擊冷卻 (縮短=更頻繁)
    spawnDist: 45,        // 以玩家為原點，在此距離外出現
    skillCooldown: 2.5,   // 專屬技能冷卻秒數 (縮短=技能更頻繁)
  },

  progression: {
    baseXp: 50,           // 升到 2 級所需 XP (降低=升級更快)
    xpGrowth: 1.2,        // 每級所需 XP 成長倍率 (放緩)
    xpPerKill: 50,        // 每擊殺一隻史萊姆的 XP (提高=升級更快)
    healthPerLevel: 60,   // 每升一級增加的血量上限
    magicPerLevel: 0.25,  // 每升一級增加的魔法傷害倍率
  },

  camera: {
    distance: 7,          // 攝影機與角色距離
    height: 3.2,          // 攝影機高度
    lookHeight: 1.6,      // 看向角色身上的高度
    minPitch: -0.6,       // 上下視角限制 (弧度)
    maxPitch: 0.9,
    sensitivity: 0.0024,  // 滑鼠靈敏度 (PC)
    touchSensitivity: 0.004, // 觸控視角靈敏度 (手機，獨立)
    minDistance: 3,       // 視角最近距離 (縮放下限)
    maxDistance: 16,      // 視角最遠距離 (縮放上限)
    zoomStep: 1.2,        // 滾輪每格縮放量
  },

  sword: {
    range: 3.2,           // 攻擊距離
    arc: Math.PI * 0.6,   // 攻擊扇形角度 (前方)
    damage: 34,
    cooldown: 0.5,        // 單擊冷卻秒數
    swingTime: 0.28,      // 每段揮劍動畫時間 (連段流暢)

    // 連段 (左鍵按住連續劈砍)
    comboCount: 5,        // 連段總段數
    comboWindow: 0.6,     // 一段揮出後多久內可接下一段 (自動連段)
    finisherDamage: 60,   // 第 5 段大橫掃傷害
    finisherArc: Math.PI * 1.1, // 第 5 段橫掃扇形 (接近半圈)
    finisherRange: 4.2,   // 第 5 段橫掃距離
    finisherSwingTime: 0.5, // 第 5 段動畫時間 (較長更有份量)
  },

  swordWave: {
    speed: 34,            // 劍氣飛行速度
    range: 40,            // 飛行最遠距離
    width: 3.2,           // 命中判定寬度 (半寬)
    damage: 55,           // 劍氣傷害
    color: 0x9fe8ff,      // 劍氣顏色

    // 前四段的短距離劍氣
    shortSpeed: 26,       // 飛行速度
    shortRange: 7,        // 短飛行距離
    shortWidth: 1.8,      // 命中寬度 (半寬)
    shortDamage: 22,      // 傷害
  },

  slime: {
    count: 60,            // 場上同時存在數量 (進遊戲預設 = MAX)
    maxCount: 60,         // 選單滑桿上限
    radius: 0.9,
    maxHealth: 100,
    speed: 3.2,
    detectRange: 30,      // 偵測玩家範圍
    attackRange: 1.8,
    attackDamage: 12,
    attackCooldown: 1.2,
    color: 0x39d353,
    respawnDelay: 3,      // 死亡後重生秒數
    hpBarShowDist: 25,    // 超過此距離不顯示血條 (頭目較大放寬)
    lodDist: 35,          // 超過此距離：簡化顯示、跳過動畫運算
    cullDist: 90,         // 超過此距離：完全不更新 (只留位置)
    lowSegments: 6,       // 遠方低模的球體分段數

    // 中頭目：血量 3 倍、體型較大、移動略慢、傷害較高
    bossChance: 0.15,     // 生成時成為頭目的機率
    bossHealthMult: 3,    // 血量倍率
    bossScale: 1.8,       // 體型倍率
    bossColor: 0x1f9d55,  // 頭目顏色 (深綠)
    bossSpeedMult: 0.7,   // 速度倍率
    bossDamageMult: 2,    // 攻擊傷害倍率
  },

  rabbit: {
    spawnChance: 0.45,    // 生成敵人時成為兔子的機率 (增加)
    radius: 0.7,
    // 血量=普通史萊姆2倍、速度=2倍、攻擊力相等
    healthMult: 2,
    speedMult: 2,
    color: 0xdcc6b0,      // 兔子毛色
    detectRange: 34,
    attackRange: 2.4,     // 跳躍踢擊距離較遠
    attackCooldown: 1.4,
    hopHeight: 1.6,       // 移動跳躍高度
    hopInterval: 0.6,     // 每次跳躍間隔
    kickHeight: 2.6,      // 踢擊躍起高度
    hpBarShowDist: 25,
  },
};
