const TICK_MS = 100;
const UI_MS = 250;
const OFFLINE_MAX_SECONDS = 86400;
const SAVE_KEY = "hierarchy-idle-save";

const CURRENCIES = [
  { id: "dust", name: "Dust", color: "#8b949e", baseRate: 1, exchangeRatio: 10, exchangeTokenCost: 1 },
  { id: "clay", name: "Clay", color: "#d4a574", exchangeRatio: 100, exchangeTokenCost: 1 },
  { id: "stone", name: "Stone", color: "#79c0ff", exchangeRatio: 1000, exchangeTokenCost: 1 },
  { id: "metal", name: "Metal", color: "#a5d6ff", exchangeRatio: 10000, exchangeTokenCost: 1 },
  { id: "gold", name: "Gold", color: "#f0b429", exchangeRatio: 100000, exchangeTokenCost: 1 },
  { id: "platinum", name: "Platinum", color: "#e5e4e2", exchangeRatio: 1000000, exchangeTokenCost: 1 },
  { id: "crystal", name: "Crystal", color: "#c084fc", exchangeRatio: 10000000, exchangeTokenCost: 1 },
  { id: "adamant", name: "Adamant", color: "#f87171", exchangeRatio: 100000000, exchangeTokenCost: 1 },
  { id: "orichalcum", name: "Orichalcum", color: "#f4a261", exchangeRatio: 1000000000, exchangeTokenCost: 1 },
  { id: "eternium", name: "Eternium", color: "#c77dff" },
];

const NUMBER_SUFFIXES = [
  "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc",
  "UDc", "DDc", "TDc", "QaDc", "QiDc", "SxDc", "SpDc", "OcDc", "NoDc", "Vg",
  "UVg", "DVg", "TVg", "QaVg", "QiVg", "SxVg", "SpVg", "OcVg", "NoVg", "Tg",
  "UTg", "DTg", "TTg", "QaTg", "QiTg", "SxTg", "SpTg", "OcTg", "NoTg", "Qg",
];

function exchangeRatio(tier) {
  return CURRENCIES[tier].exchangeRatio ?? 0;
}

function exchangeTokenCost(tier) {
  return CURRENCIES[tier].exchangeTokenCost ?? 0;
}
const BOOSTER_BASE_COST = 1;
const BOOSTER_COST_MULT = 1;
const BOOSTER_EFFECT = 1;

const TOKEN_BASE_RATE = 1;
const TOKEN_UPGRADE_BASE_COST = 250;
const TOKEN_UPGRADE_COST_MULT = 10;
const TOKEN_UPGRADE_EFFECT = 1;

const BATCH_FRACTION = 0.1;

const PRODUCTION_UPGRADE_MULT = 2;
const PRODUCTION_MILESTONE_BASE = 10;
const PRODUCTION_MILESTONE_MULT = 10;

const STAR_REWARD_BASE = 1;
const STAR_REWARD_MULT = 1.4;

const TOKEN_STAR_UPGRADE_BASE_COST = 10;
const TOKEN_STAR_UPGRADE_COST_MULT = 4;

const STARTING_SHARDS = 0;
const DAILY_SHARD_BASE = 5;
const CLAIM_STARS_SHARD_COST = 25;
const PRESTIGE_COOLDOWNS_MS = [
  2 * 60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

const ACHIEVEMENT_MULT_PER_POINT = 0.1;

// Achievement tiers: skip early thresholds, concentrate rewards in midgame.
const DUST_ACHIEVEMENT_START = 2;
const DUST_ACHIEVEMENT_COUNT = 10;
const STAR_ACHIEVEMENT_START = 1;
const STAR_ACHIEVEMENT_COUNT = 5;
const TOKEN_ACHIEVEMENT_START = 4;
const TOKEN_ACHIEVEMENT_COUNT = 8;
const FIRST_BUY_MINERAL_TIER = 2;

const RESOURCE_BOXES = [
  { id: "30m-tokens", name: "30 Minute Token Box", seconds: 1800, shardCost: 2, tokensOnly: true },
  { id: "1h", name: "1 Hour Crate", seconds: 3600, shardCost: 4 },
  { id: "6h", name: "6 Hour Crate", seconds: 21600, shardCost: 16 },
  { id: "24h", name: "24 Hour Crate", seconds: 86400, shardCost: 48 },
];

const state = {
  amounts: CURRENCIES.map(() => 0),
  boosters: CURRENCIES.map(() => 0),
  tokenUpgrades: 0,
  tokenStarUpgrades: 0,
  tokens: 0,
  shards: STARTING_SHARDS,
  dailyStreak: 0,
  lastDailyClaimDay: null,
  upgradePoints: 0,
  inactiveStars: 0,
  prestigeCount: 0,
  lastPrestigeAt: 0,
  completedAchievements: [],
  claimedAchievements: [],
  totalStarsEarned: 0,
  boxesOpened: 0,
  lifetimeDustCollected: 0,
  totalTokensSpent: 0,
  lifetimeTokenUpgrades: 0,
  firstMineralBought: CURRENCIES.map(() => false),
  productionUpgrades: CURRENCIES.map(() => 0),
  unlocked: CURRENCIES.map((_, i) => i === 0),
  lastTick: Date.now(),
};

const gameEl = document.getElementById("game");
const upgradeListEl = document.getElementById("upgrade-list");
const boxListEl = document.getElementById("box-list");
const dailyClaimRowEl = document.getElementById("daily-claim-row");
const tokenCountEl = document.getElementById("token-count");
const tokenRateEl = document.getElementById("token-rate");
const upgradeCountEl = document.getElementById("upgrade-count");
const inactiveStarCountEl = document.getElementById("inactive-star-count");
const shardCountEl = document.getElementById("shard-count");
const prestigeRowEl = document.getElementById("prestige-row");
const achievementListEl = document.getElementById("achievement-list");
const headerAchievementMultEl = document.getElementById("header-achievement-mult");
const achievementProgressTextEl = document.getElementById("achievement-progress-text");
const achievementProgressClaimedEl = document.getElementById("achievement-progress-claimed");
const achievementProgressReadyEl = document.getElementById("achievement-progress-ready");

/** @type {Array<{ amountEl: HTMLElement, productionEl: HTMLElement, boostBtn?: HTMLButtonElement, boostDetail?: HTMLElement, exchangeBtn?: HTMLButtonElement }>} */
let cards = [];
/** @type {HTMLElement[]} */
let upgradeRows = [];
/** @type {HTMLElement[]} */
let boxRows = [];
let uiDirty = true;
let lastUIAt = 0;

function markDirty() {
  uiDirty = true;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setDisabled(btn, disabled) {
  if (btn.disabled !== disabled) btn.disabled = disabled;
}

function setWidth(el, width) {
  if (el.style.width !== width) el.style.width = width;
}

function isTierUnlocked(tier) {
  if (tier === 0) return true;
  return state.unlocked[tier];
}

function markMineralBought(tier) {
  if (tier <= 0) return;
  let changed = false;
  if (!state.firstMineralBought[tier]) {
    state.firstMineralBought[tier] = true;
  }
  if (!state.unlocked[tier]) {
    state.unlocked[tier] = true;
    changed = true;
  }
  if (changed) {
    buildUI();
    buildUpgradeUI();
    markDirty();
  }
}

function resetMineralVisibility() {
  state.unlocked = CURRENCIES.map((_, i) => {
    if (i === 0) return true;
    if (i === 1) return state.firstMineralBought[1];
    return false;
  });
}

function getDayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function getYesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return getDayKey(date);
}

function canClaimDaily() {
  return state.lastDailyClaimDay !== getDayKey();
}

function nextDailyStreak() {
  if (state.lastDailyClaimDay === getYesterdayKey()) {
    return state.dailyStreak + 1;
  }
  return 1;
}

function isDailyStreakBroken() {
  return state.lastDailyClaimDay !== null && state.lastDailyClaimDay !== getYesterdayKey();
}

function nextDailyShardReward() {
  return DAILY_SHARD_BASE * nextDailyStreak();
}

function claimDailyShards() {
  if (!canClaimDaily()) return;
  state.dailyStreak = nextDailyStreak();
  state.shards += DAILY_SHARD_BASE * state.dailyStreak;
  state.lastDailyClaimDay = getDayKey();
  checkAchievements();
  markDirty();
  updateUI(true);
}

function earnStars(amount) {
  if (amount <= 0) return;
  state.inactiveStars += amount;
  state.totalStarsEarned += amount;
  checkAchievements();
}

function spendStars(cost) {
  if (!canAfford(state.upgradePoints, cost)) return false;
  state.upgradePoints -= cost;
  state.inactiveStars += cost;
  return true;
}

function activateInactiveStars() {
  const activated = state.upgradePoints + state.inactiveStars;
  state.upgradePoints = activated;
  state.inactiveStars = 0;
  return activated;
}

function resetRunProgress() {
  state.amounts = CURRENCIES.map(() => 0);
  state.boosters = CURRENCIES.map(() => 0);
  state.tokenUpgrades = 0;
  state.tokens = 0;
  state.productionUpgrades = CURRENCIES.map(() => 0);
  state.tokenStarUpgrades = 0;
  resetMineralVisibility();
  state.lastTick = Date.now();
}

function prestigeCooldownMs(completedPrestigeCount) {
  if (completedPrestigeCount <= 0) return 0;
  const index = Math.min(completedPrestigeCount - 1, PRESTIGE_COOLDOWNS_MS.length - 1);
  return PRESTIGE_COOLDOWNS_MS[index];
}

function prestigeCooldownRemaining() {
  if (!state.lastPrestigeAt) return 0;
  return Math.max(0, state.lastPrestigeAt + prestigeCooldownMs(state.prestigeCount) - Date.now());
}

function canPrestige() {
  return prestigeCooldownRemaining() <= 0;
}

function prestige() {
  if (!canPrestige()) return;

  const totalStars = state.upgradePoints + state.inactiveStars;
  if (totalStars <= 0) {
    if (!confirm("Prestige anyway? You have no stars to carry over.")) return;
  } else if (!confirm("Prestige? Resets all minerals, tokens, and production. All stars become spendable.")) {
    return;
  }

  activateInactiveStars();
  resetRunProgress();
  state.prestigeCount += 1;
  state.lastPrestigeAt = Date.now();
  checkAchievements();
  markDirty();
  render();
}

function claimStarsWithShards() {
  if (state.inactiveStars <= 0 && state.upgradePoints <= 0) return;
  if (!canAfford(state.shards, CLAIM_STARS_SHARD_COST)) return;
  state.shards -= CLAIM_STARS_SHARD_COST;
  activateInactiveStars();
  markDirty();
  updateUI(true);
}

function formatBoxGrant(box) {
  if (box.tokensOnly) {
    return `${formatNum(tokenProductionRate() * box.seconds)} tokens`;
  }
  return formatProductionGrant(box.seconds);
}

function productionSnapshot() {
  return {
    tokens: tokenProductionRate(),
    amounts: CURRENCIES.map((_, i) => productionRate(i)),
  };
}

function formatProductionGrant(seconds) {
  const rates = productionSnapshot();
  const parts = [];
  if (rates.tokens * seconds > 0) parts.push(`${formatNum(rates.tokens * seconds)} tokens`);
  for (let i = 0; i < CURRENCIES.length; i++) {
    const gained = rates.amounts[i] * seconds;
    if (gained > 0) parts.push(`${formatNum(gained)} ${CURRENCIES[i].name}`);
  }
  return parts.length > 0 ? parts.join(", ") : "no production yet";
}

function showNotificationBanner(message, timerKey) {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;

  banner.textContent = message;
  banner.hidden = false;

  clearTimeout(showNotificationBanner[timerKey]);
  showNotificationBanner[timerKey] = setTimeout(() => {
    banner.hidden = true;
  }, 8000);
}

function showGrantBanner(title, seconds, tokensBefore, amountsBefore) {
  const parts = [];
  const tokenGain = state.tokens - tokensBefore;
  if (tokenGain > 0) parts.push(`+${formatNum(tokenGain)} tokens`);
  for (let i = 0; i < CURRENCIES.length; i++) {
    const gain = state.amounts[i] - amountsBefore[i];
    if (gain > 0) parts.push(`+${formatNum(gain)} ${CURRENCIES[i].name}`);
  }
  if (parts.length === 0) return;

  showNotificationBanner(
    `${title} (${formatDuration(seconds)}): ${parts.join(", ")}`,
    "grantTimer",
  );
}

function checkUnlocks() {
  let changed = false;
  if (!state.unlocked[1] && state.firstMineralBought[1]) {
    state.unlocked[1] = true;
    changed = true;
  }
  if (changed) {
    buildUI();
    buildUpgradeUI();
    markDirty();
  }
  checkAchievements();
}

function isAchievementClaimed(id) {
  return state.claimedAchievements.includes(id);
}

function isAchievementReady(id) {
  return state.completedAchievements.includes(id);
}

function isAchievementTracked(id) {
  return isAchievementClaimed(id) || isAchievementReady(id);
}

function achievementBonusPoints() {
  return ACHIEVEMENTS
    .filter((achievement) => isAchievementClaimed(achievement.id))
    .reduce((sum, achievement) => sum + achievement.bonusPoints, 0);
}

function achievementReadyPoints() {
  return ACHIEVEMENTS
    .filter((achievement) => isAchievementReady(achievement.id))
    .reduce((sum, achievement) => sum + achievement.bonusPoints, 0);
}

function totalAchievementPoints() {
  return ACHIEVEMENTS.reduce((sum, achievement) => sum + achievement.bonusPoints, 0);
}

function achievementMultiplier() {
  return 1 + achievementBonusPoints() * ACHIEVEMENT_MULT_PER_POINT;
}

function totalProductionMultiplier(tier) {
  return productionMultiplier(tier) * achievementMultiplier();
}

function checkAchievements() {
  const newlyCompleted = [];
  for (const achievement of ACHIEVEMENTS) {
    if (isAchievementTracked(achievement.id)) continue;
    if (!achievement.check()) continue;
    state.completedAchievements.push(achievement.id);
    newlyCompleted.push(achievement);
  }
  if (newlyCompleted.length === 0) return;
  markDirty();
  showAchievementCompleteBanner(newlyCompleted);
}

function claimAchievement(id) {
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
  if (!achievement || !isAchievementReady(id)) return;

  state.completedAchievements = state.completedAchievements.filter((entry) => entry !== id);
  state.claimedAchievements.push(id);
  state.shards += achievement.bonusPoints;
  markDirty();
  updateUI(true);
}

function showAchievementCompleteBanner(achievements) {
  const summary = achievements.map((achievement) => achievement.name).join(", ");
  const message = achievements.length === 1
    ? `Achievement complete: ${summary} — claim your reward!`
    : `Achievements complete: ${summary} — claim your rewards!`;
  showNotificationBanner(message, "achievementTimer");
}

function formatDuration(seconds) {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function applyProduction(dt) {
  if (dt <= 0) return;
  state.tokens += tokenProductionRate() * dt;
  for (let i = 0; i < CURRENCIES.length; i++) {
    const gain = productionRate(i) * dt;
    state.amounts[i] += gain;
    if (i === 0) state.lifetimeDustCollected += gain;
  }
}

function applyTokenProduction(dt) {
  if (dt <= 0) return;
  state.tokens += tokenProductionRate() * dt;
}

function flushProduction(maxDt = Infinity) {
  const now = Date.now();
  const dt = Math.min(Math.max(0, (now - state.lastTick) / 1000), maxDt);
  if (dt <= 0) return 0;
  applyProduction(dt);
  state.lastTick = now;
  return dt;
}

function applyOfflineProgress() {
  const rawElapsed = Math.max(0, (Date.now() - state.lastTick) / 1000);
  if (rawElapsed < 10) {
    state.lastTick = Date.now();
    return null;
  }

  const tokensBefore = state.tokens;
  const amountsBefore = state.amounts.slice();
  const dt = flushProduction(OFFLINE_MAX_SECONDS);
  checkUnlocks();

  return {
    dt,
    capped: rawElapsed > OFFLINE_MAX_SECONDS,
    tokensBefore,
    amountsBefore,
  };
}

function showOfflineBanner(report) {
  if (!report) return;
  const capped = report.capped ? `, capped at ${formatDuration(OFFLINE_MAX_SECONDS)}` : "";
  showGrantBanner(`While away${capped}`, report.dt, report.tokensBefore, report.amountsBefore);
}

function formatNum(n) {
  if (n == null || !Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n < 0) return `-${formatNum(-n)}`;
  if (n < 1000) {
    if (n < 10) return n.toFixed(2);
    if (n < 100) return n.toFixed(1);
    return n.toFixed(0);
  }

  const tier = Math.floor(Math.log10(n) / 3) - 1;
  if (tier >= NUMBER_SUFFIXES.length) {
    const exp = Math.floor(Math.log10(n));
    const mantissa = n / Math.pow(10, exp);
    return `${mantissa.toFixed(2)}e${exp}`;
  }

  const scale = Math.pow(10, (tier + 1) * 3);
  return (n / scale).toFixed(2) + NUMBER_SUFFIXES[tier];
}

function formatCount(n) {
  const value = Math.floor(Number(n));
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(value);
  return formatNum(value);
}

function dustAchievementBonus(power) {
  return 1;
}

function firstBuyBonusPoints(tier) {
  return tier-1;
}

function starAchievementBonus(power) {
  if (power <= 3) return 1;
  if (power <= 5) return 2;
  return 3;
}

function tokenAchievementBonus(power) {
  if (power <= 6) return 1;
  if (power <= 9) return 2;
  return 3;
}

function achievementProgressValue(current, target) {
  return {
    current: Math.min(current, target),
    target,
  };
}

function formatAchievementProgress(achievement) {
  if (isAchievementTracked(achievement.id)) return "Complete";
  const { current, target } = achievement.progress();
  return `${formatCount(current)}/${formatCount(target)} complete`;
}

function buildAchievements() {
  const achievements = [
    {
      id: "prestige_once",
      name: "Reborn",
      desc: "Prestige once",
      bonusPoints: 1,
      check: () => state.prestigeCount >= 1,
      progress: () => achievementProgressValue(state.prestigeCount, 1),
    },
    {
      id: "prestige_thrice",
      name: "Ascendant",
      desc: "Prestige 5 times",
      bonusPoints: 2,
      check: () => state.prestigeCount >= 5,
      progress: () => achievementProgressValue(state.prestigeCount, 5),
    },
    {
      id: "token_upgrades",
      name: "Token Tapper",
      desc: "Buy 5 token upgrades total",
      bonusPoints: 1,
      check: () => state.lifetimeTokenUpgrades >= 5,
      progress: () => achievementProgressValue(state.lifetimeTokenUpgrades, 5),
    },
    {
      id: "token_upgrades_50",
      name: "Token Master",
      desc: "Buy 50 token upgrades total",
      bonusPoints: 2,
      check: () => state.lifetimeTokenUpgrades >= 50,
      progress: () => achievementProgressValue(state.lifetimeTokenUpgrades, 50),
    },
    {
      id: "daily_streak",
      name: "Regular",
      desc: "Reach a 3-day login streak",
      bonusPoints: 2,
      check: () => state.dailyStreak >= 3,
      progress: () => achievementProgressValue(state.dailyStreak, 3),
    },
    {
      id: "open_boxes_5",
      name: "Unboxing",
      desc: "Open 5 resource boxes",
      bonusPoints: 1,
      check: () => state.boxesOpened >= 5,
      progress: () => achievementProgressValue(state.boxesOpened, 5),
    },
    {
      id: "open_boxes_25",
      name: "Crate Digger",
      desc: "Open 25 resource boxes",
      bonusPoints: 2,
      check: () => state.boxesOpened >= 25,
      progress: () => achievementProgressValue(state.boxesOpened, 25),
    },
  ];

  for (let i = 0; i < DUST_ACHIEVEMENT_COUNT; i++) {
    const power = DUST_ACHIEVEMENT_START + i;
    const threshold = Math.pow(1000, power);
    achievements.push({
      id: `dust_collect_${power}`,
      name: `Dust ${i + 1}`,
      desc: `Collect ${formatCount(threshold)} Dust total`,
      bonusPoints: dustAchievementBonus(power),
      check: () => state.lifetimeDustCollected >= threshold,
      progress: () => achievementProgressValue(state.lifetimeDustCollected, threshold),
    });
  }

  for (let tier = FIRST_BUY_MINERAL_TIER; tier < CURRENCIES.length; tier++) {
    const mineral = CURRENCIES[tier];
    achievements.push({
      id: `first_buy_${mineral.id}`,
      name: `First ${mineral.name}`,
      desc: `Buy your first ${mineral.name}`,
      bonusPoints: firstBuyBonusPoints(tier),
      check: () => state.firstMineralBought[tier],
      progress: () => achievementProgressValue(state.firstMineralBought[tier] ? 1 : 0, 1),
    });
  }

  for (let i = 0; i < STAR_ACHIEVEMENT_COUNT; i++) {
    const power = STAR_ACHIEVEMENT_START + i;
    const threshold = Math.pow(100, power);
    achievements.push({
      id: `stars_earned_${power}`,
      name: `Stars ${i + 1}`,
      desc: `Earn ${formatCount(threshold)} stars total`,
      bonusPoints: starAchievementBonus(power),
      check: () => state.totalStarsEarned >= threshold,
      progress: () => achievementProgressValue(state.totalStarsEarned, threshold),
    });
  }

  for (let i = 0; i < TOKEN_ACHIEVEMENT_COUNT; i++) {
    const power = TOKEN_ACHIEVEMENT_START + i;
    const threshold = Math.pow(10, power);
    achievements.push({
      id: `tokens_spent_${power}`,
      name: `Spend Tokens ${i + 1}`,
      desc: `Spend ${formatCount(threshold)} tokens on exchanges`,
      bonusPoints: tokenAchievementBonus(power),
      check: () => state.totalTokensSpent >= threshold,
      progress: () => achievementProgressValue(state.totalTokensSpent, threshold),
    });
  }

  return achievements;
}

const ACHIEVEMENTS = buildAchievements();

function boosterCost(tier) {
  return BOOSTER_BASE_COST * Math.pow(BOOSTER_COST_MULT, state.boosters[tier]);
}

function tokenUpgradeCost() {
  return TOKEN_UPGRADE_BASE_COST * Math.pow(TOKEN_UPGRADE_COST_MULT, state.tokenUpgrades);
}

function tokenStarUpgradeCost() {
  return TOKEN_STAR_UPGRADE_BASE_COST * Math.pow(TOKEN_STAR_UPGRADE_COST_MULT, state.tokenStarUpgrades);
}

function tokenProductionMultiplier() {
  return Math.pow(PRODUCTION_UPGRADE_MULT, state.tokenStarUpgrades);
}

function tokenProductionRate() {
  const base = TOKEN_BASE_RATE + state.tokenUpgrades * TOKEN_UPGRADE_EFFECT;
  return base * tokenProductionMultiplier();
}

function tokenUpgradeStarRange(upgradeCount) {
  const base = STAR_REWARD_BASE * Math.pow(STAR_REWARD_MULT, upgradeCount - 1);
  const min = Math.max(1, Math.floor(base));
  const max = Math.max(min, Math.floor(base * 2));
  return { min, max };
}

function rollTokenUpgradeStars(upgradeCount) {
  const { min, max } = tokenUpgradeStarRange(upgradeCount);
  return min + Math.floor(Math.random() * (max - min + 1));
}

function productionMilestoneThreshold(tier, level) {
  return PRODUCTION_MILESTONE_BASE * Math.pow(PRODUCTION_MILESTONE_MULT, level);
}

function productionUpgradeCost(tier, nextLevel) {
  if (nextLevel <= 1) return tier + 1;

  let cost = tier + 1;
  for (let level = 2; level <= nextLevel; level++) {
    cost *= level + 1;
  }
  return cost;
}

function productionMultiplier(tier) {
  return Math.pow(PRODUCTION_UPGRADE_MULT, state.productionUpgrades[tier]);
}

function baseProductionRate(tier) {
  const boosterTier = tier + 1;
  const fromBoosters = boosterTier < CURRENCIES.length
    ? state.boosters[boosterTier] * BOOSTER_EFFECT
    : 0;
  const mult = productionMultiplier(tier);
  if (tier === 0) {
    return (CURRENCIES[0].baseRate + fromBoosters) * mult;
  }
  return fromBoosters * mult;
}

function productionRate(tier) {
  return baseProductionRate(tier) * achievementMultiplier();
}

function milestoneMetForNextUpgrade(tier) {
  return productionRate(tier) >= productionMilestoneThreshold(tier, state.productionUpgrades[tier]);
}

function hasProduction(tier) {
  return tier < CURRENCIES.length - 1 || tier === 0;
}

function buyProductionUpgrade(tier) {
  if (!hasProduction(tier)) return;
  const nextLevel = state.productionUpgrades[tier] + 1;
  const cost = productionUpgradeCost(tier, nextLevel);
  if (!milestoneMetForNextUpgrade(tier)) return;
  if (!spendStars(cost)) return;
  state.productionUpgrades[tier] += 1;
  markDirty();
  updateUI(true);
}

function buyTokenStarUpgrade() {
  const cost = tokenStarUpgradeCost();
  if (!spendStars(cost)) return;
  state.tokenStarUpgrades += 1;
  markDirty();
  updateUI(true);
}

function canAfford(amount, cost) {
  return amount >= cost;
}

function batchSize(max) {
  return max > 0 ? Math.ceil(max * BATCH_FRACTION) : 0;
}

function maxAffordableBoosters(tier) {
  const remaining = state.amounts[tier];
  const owned = state.boosters[tier];
  const firstCost = BOOSTER_BASE_COST * Math.pow(BOOSTER_COST_MULT, owned);
  if (remaining < firstCost) return 0;

  if (BOOSTER_COST_MULT === 1) {
    return Math.floor(remaining / firstCost);
  }

  const ratio = (remaining * (BOOSTER_COST_MULT - 1)) / firstCost + 1;
  if (ratio <= 1) return 0;
  return Math.floor(Math.log(ratio) / Math.log(BOOSTER_COST_MULT));
}

function buyResourceBox(boxId) {
  const box = RESOURCE_BOXES.find((entry) => entry.id === boxId);
  if (!box || !canAfford(state.shards, box.shardCost)) return;

  const tokensBefore = state.tokens;
  const amountsBefore = state.amounts.slice();
  state.shards -= box.shardCost;
  state.boxesOpened += 1;
  if (box.tokensOnly) {
    applyTokenProduction(box.seconds);
  } else {
    applyProduction(box.seconds);
  }
  checkUnlocks();
  checkAchievements();
  markDirty();
  updateUI(true);
  showGrantBanner(`Opened ${box.name}`, box.seconds, tokensBefore, amountsBefore);
}

function maxAffordableExchanges(tier) {
  const ratio = exchangeRatio(tier);
  const tokenCost = exchangeTokenCost(tier);
  const byCurrency = Math.floor(state.amounts[tier] / ratio);
  const byTokens = Math.floor(state.tokens / tokenCost);
  return Math.min(byCurrency, byTokens);
}

function boosterBatchCost(tier, batch) {
  if (batch <= 0) return 0;
  const owned = state.boosters[tier];
  if (BOOSTER_COST_MULT === 1) {
    return BOOSTER_BASE_COST * batch;
  }
  return BOOSTER_BASE_COST
    * Math.pow(BOOSTER_COST_MULT, owned)
    * (Math.pow(BOOSTER_COST_MULT, batch) - 1)
    / (BOOSTER_COST_MULT - 1);
}

function buyBooster(tier) {
  if (tier === 0) return;
  const max = maxAffordableBoosters(tier);
  const batch = batchSize(max);
  if (batch === 0) return;
  const cost = boosterBatchCost(tier, batch);
  if (!canAfford(state.amounts[tier], cost)) return;
  state.amounts[tier] -= cost;
  state.boosters[tier] += batch;
  markDirty();
  updateUI(true);
}

function buyTokenUpgrade() {
  const cost = tokenUpgradeCost();
  if (!canAfford(state.amounts[0], cost)) return;
  state.amounts[0] -= cost;
  state.tokenUpgrades += 1;
  state.lifetimeTokenUpgrades += 1;
  earnStars(rollTokenUpgradeStars(state.tokenUpgrades));
  markDirty();
  updateUI(true);
}

function exchange(tier) {
  if (tier >= CURRENCIES.length - 1) return;
  const ratio = exchangeRatio(tier);
  const tokenCost = exchangeTokenCost(tier);
  const max = maxAffordableExchanges(tier);
  const batch = batchSize(max);
  if (batch === 0) return;
  const receivedTier = tier + 1;
  if (state.amounts[receivedTier] === 0) {
    markMineralBought(receivedTier);
  }
  state.amounts[tier] -= ratio * batch;
  state.amounts[receivedTier] += batch;
  state.totalTokensSpent += tokenCost * batch;
  state.tokens -= tokenCost * batch;
  checkUnlocks();
  checkAchievements();
  markDirty();
  updateUI(true);
}

function tick() {
  flushProduction(1);
  checkUnlocks();
  checkAchievements();
  markDirty();

  if (Date.now() - lastUIAt >= UI_MS) {
    updateUI();
  }
}

function buildUI() {
  gameEl.innerHTML = "";
  cards = [];
  CURRENCIES.forEach((cur, i) => {
    if (!isTierUnlocked(i)) return;

    const section = document.createElement("section");
    section.className = "currency-card";
    section.style.setProperty("--accent", cur.color);
    section.style.setProperty("--accent-dim", `${cur.color}88`);

    const header = document.createElement("div");
    header.className = "currency-header";

    const name = document.createElement("h2");
    name.className = "currency-name";
    name.textContent = cur.name;

    const stats = document.createElement("div");
    const amountEl = document.createElement("div");
    amountEl.className = "currency-amount";
    const productionEl = document.createElement("div");
    productionEl.className = "currency-production";
    stats.append(amountEl, productionEl);

    header.append(name, stats);

    const actions = document.createElement("div");
    actions.className = "currency-actions";

    const card = { amountEl, productionEl };

    if (i === 0) {
      const tokenUpgradeBtn = document.createElement("button");
      tokenUpgradeBtn.type = "button";
      tokenUpgradeBtn.className = "token-upgrade";
      tokenUpgradeBtn.dataset.action = "token-upgrade";
      tokenUpgradeBtn.append("Increase Tokens ");
      const tokenUpgradeDetail = document.createElement("span");
      tokenUpgradeDetail.className = "action-detail";
      tokenUpgradeBtn.append(tokenUpgradeDetail);
      actions.append(tokenUpgradeBtn);
      card.tokenUpgradeBtn = tokenUpgradeBtn;
      card.tokenUpgradeDetail = tokenUpgradeDetail;
    }

    if (i > 0) {
      const below = CURRENCIES[i - 1].name;
      const boostBtn = document.createElement("button");
      boostBtn.type = "button";
      boostBtn.className = "primary";
      boostBtn.dataset.action = "boost";
      boostBtn.dataset.tier = String(i);
      boostBtn.append(`Boost ${below} `);
      const boostDetail = document.createElement("span");
      boostDetail.className = "action-detail";
      boostBtn.append(boostDetail);
      actions.append(boostBtn);
      card.boostBtn = boostBtn;
      card.boostDetail = boostDetail;
    }

    if (i < CURRENCIES.length - 1) {
      const above = CURRENCIES[i + 1].name;
      const exchangeBtn = document.createElement("button");
      exchangeBtn.type = "button";
      exchangeBtn.className = "exchange";
      exchangeBtn.dataset.action = "exchange";
      exchangeBtn.dataset.tier = String(i);
      exchangeBtn.append(`Exchange → ${above} `);
      const exchangeDetail = document.createElement("span");
      exchangeDetail.className = "action-detail";
      exchangeBtn.append(exchangeDetail);
      actions.append(exchangeBtn);
      card.exchangeBtn = exchangeBtn;
      card.exchangeDetail = exchangeDetail;
    }

    section.append(header, actions);
    gameEl.append(section);
    cards[i] = card;
  });
}

function buildBoxUI() {
  boxListEl.innerHTML = "";
  boxRows = [];

  RESOURCE_BOXES.forEach((box) => {
    const row = document.createElement("div");
    row.className = "box-row";
    row.dataset.boxId = box.id;

    const info = document.createElement("div");
    info.className = "box-info";

    const title = document.createElement("h3");
    title.textContent = box.name;

    const desc = document.createElement("p");
    desc.className = "box-desc";

    info.append(title, desc);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "box-buy";
    btn.dataset.action = "buy-box";
    btn.dataset.boxId = box.id;

    row.append(info, btn);
    boxListEl.append(row);
    boxRows.push(row);
  });
}

function updateDailyClaimUI() {
  if (!dailyClaimRowEl) return;

  const canClaim = canClaimDaily();
  const nextStreak = nextDailyStreak();
  const reward = DAILY_SHARD_BASE * nextStreak;
  const desc = dailyClaimRowEl.querySelector(".box-desc");
  const btn = dailyClaimRowEl.querySelector(".daily-claim-btn");

  if (canClaim) {
    const streakText = state.lastDailyClaimDay === null
      ? "Starting streak"
      : isDailyStreakBroken()
        ? "Streak lost"
        : `Streak: ${formatCount(state.dailyStreak)}`;
    setText(
      desc,
      `${streakText} · Claim ${formatCount(reward)} ◆ (${formatCount(DAILY_SHARD_BASE)} × day ${formatCount(nextStreak)})`,
    );
    setDisabled(btn, false);
    setUpgradeBuyBtn(btn, "Daily Claim", `${formatCount(reward)} ◆`);
  } else {
    const nextReward = DAILY_SHARD_BASE * (state.dailyStreak + 1);
    setText(desc, `Claimed today · Streak: ${formatCount(state.dailyStreak)} · Tomorrow: ${formatCount(nextReward)} ◆`);
    setDisabled(btn, true);
    setUpgradeBuyBtn(btn, "Claimed", "Come back tomorrow");
  }
}

function updateBoxRow(row) {
  const box = RESOURCE_BOXES.find((entry) => entry.id === row.dataset.boxId);
  if (!box) return;

  const canBuy = canAfford(state.shards, box.shardCost);
  row.querySelector(".box-desc").textContent =
    `${formatDuration(box.seconds)} · ${formatBoxGrant(box)}`;

  const btn = row.querySelector(".box-buy");
  setDisabled(btn, !canBuy);
  setUpgradeBuyBtn(
    btn,
    "Open",
    `${formatCount(box.shardCost)} ◆`,
  );
}

function updateBoxUI() {
  setText(shardCountEl, formatCount(state.shards));
  updateDailyClaimUI();
  for (const row of boxRows) updateBoxRow(row);
}

function buildAchievementUI() {
  if (!achievementListEl) return;
  achievementListEl.innerHTML = ACHIEVEMENTS.map((achievement) => `
    <div class="achievement-row" data-achievement-id="${achievement.id}">
      <div class="achievement-info">
        <h3>${achievement.name}</h3>
        <p class="achievement-desc">${achievement.desc}</p>
        <p class="achievement-progress-detail"></p>
      </div>
      <div class="achievement-actions">
        <span class="achievement-reward"></span>
        <button
          type="button"
          class="box-buy achievement-claim-btn"
          data-action="claim-achievement"
          data-achievement-id="${achievement.id}"
          hidden
        >Claim</button>
      </div>
    </div>
  `).join("");
}

function updateAchievementUI() {
  const mult = achievementMultiplier();
  if (headerAchievementMultEl) {
    setText(headerAchievementMultEl, `×${formatNum(mult)}`);
  }

  updateAchievementProgress();

  if (!achievementListEl) return;

  achievementListEl.querySelectorAll(".achievement-row").forEach((row) => {
    const achievement = ACHIEVEMENTS.find((entry) => entry.id === row.dataset.achievementId);
    if (!achievement) return;
    const claimed = isAchievementClaimed(achievement.id);
    const ready = isAchievementReady(achievement.id);
    row.classList.toggle("complete", claimed);
    row.classList.toggle("ready", ready);
    const bonus = achievement.bonusPoints * ACHIEVEMENT_MULT_PER_POINT;
    const shards = formatCount(achievement.bonusPoints);
    const reward = row.querySelector(".achievement-reward");
    const claimBtn = row.querySelector(".achievement-claim-btn");
    const progressEl = row.querySelector(".achievement-progress-detail");
    if (progressEl) {
      setText(progressEl, formatAchievementProgress(achievement));
    }
    if (claimed) {
      reward.textContent = `+${bonus.toFixed(1)}× · +${shards} ◆`;
    } else if (ready) {
      reward.textContent = `Ready · +${bonus.toFixed(1)}× · +${shards} ◆`;
    } else {
      reward.textContent = `${achievement.bonusPoints} pt · +${bonus.toFixed(1)}× · +${shards} ◆`;
    }
    if (claimBtn) claimBtn.hidden = !ready;
  });
}

function updateAchievementProgress() {
  const claimed = achievementBonusPoints();
  const ready = achievementReadyPoints();
  const total = totalAchievementPoints();
  const remaining = Math.max(total - claimed - ready, 0);

  if (achievementProgressTextEl) {
    setText(
      achievementProgressTextEl,
      `${formatCount(claimed)} collected · ${formatCount(ready)} to claim · ${formatCount(remaining)} remaining`,
    );
  }

  const claimedPct = total > 0 ? (claimed / total) * 100 : 0;
  const readyPct = total > 0 ? (ready / total) * 100 : 0;
  if (achievementProgressClaimedEl) {
    setWidth(achievementProgressClaimedEl, `${claimedPct}%`);
  }
  if (achievementProgressReadyEl) {
    setWidth(achievementProgressReadyEl, `${readyPct}%`);
  }
}

function setUpgradeBuyBtn(btn, label, detail) {
  let labelEl = btn.querySelector(".upgrade-btn-label");
  let detailEl = btn.querySelector(".upgrade-btn-detail");
  if (!labelEl) {
    btn.replaceChildren();
    labelEl = document.createElement("span");
    labelEl.className = "upgrade-btn-label";
    detailEl = document.createElement("span");
    detailEl.className = "upgrade-btn-detail";
    btn.append(labelEl, detailEl);
  }
  setText(labelEl, label);
  setText(detailEl, detail);
}

function buildUpgradeUI() {
  upgradeListEl.innerHTML = "";
  upgradeRows = [];

  const tokenRow = document.createElement("div");
  tokenRow.className = "upgrade-row";
  tokenRow.style.setProperty("--accent", "#f0b429");
  tokenRow.dataset.kind = "token-star";
  tokenRow.innerHTML = `
    <div class="upgrade-info">
      <h3>Token Production</h3>
      <p class="upgrade-desc"></p>
    </div>
    <button type="button" class="upgrade-buy" data-action="token-star-upgrade"></button>
  `;
  upgradeListEl.append(tokenRow);
  upgradeRows.push(tokenRow);

  CURRENCIES.forEach((cur, tier) => {
    if (tier === CURRENCIES.length - 1) return;
    if (!isTierUnlocked(tier)) return;

    const row = document.createElement("div");
    row.className = "upgrade-row";
    row.style.setProperty("--accent", cur.color);
    row.dataset.target = String(tier);

    const info = document.createElement("div");
    info.className = "upgrade-info";

    const title = document.createElement("h3");
    title.textContent = `${cur.name} Production`;

    const desc = document.createElement("p");
    desc.className = "upgrade-desc";

    const bar = document.createElement("div");
    bar.className = "milestone-bar";
    const fill = document.createElement("div");
    fill.className = "milestone-fill";
    bar.append(fill);

    info.append(title, desc, bar);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "upgrade-buy";
    btn.dataset.action = "production-upgrade";
    btn.dataset.target = String(tier);

    row.append(info, btn);
    upgradeListEl.append(row);
    upgradeRows.push(row);
  });
}

function updateUpgradeRow(row) {
  if (row.dataset.kind === "token-star") {
    const level = state.tokenStarUpgrades;
    const mult = tokenProductionMultiplier();
    const cost = tokenStarUpgradeCost();
    const canBuy = canAfford(state.upgradePoints, cost);

    row.querySelector(".upgrade-desc").textContent =
      `×${formatNum(mult)} token generation · level ${level}`;

    const btn = row.querySelector(".upgrade-buy");
    setDisabled(btn, !canBuy);
    setUpgradeBuyBtn(
      btn,
      "Upgrade",
      `${formatNum(cost)} ✦ → ×${formatNum(mult * PRODUCTION_UPGRADE_MULT)}`,
    );
    return;
  }

  const tier = Number(row.dataset.target);
  const level = state.productionUpgrades[tier];
  const mult = totalProductionMultiplier(tier);
  const upgradeMult = productionMultiplier(tier);
  const cost = productionUpgradeCost(tier, level + 1);
  const milestone = productionMilestoneThreshold(tier, level);
  const rate = productionRate(tier);
  const milestoneOk = milestoneMetForNextUpgrade(tier);
  const canBuy = milestoneOk && canAfford(state.upgradePoints, cost);

  const desc = row.querySelector(".upgrade-desc");
  setText(desc, `×${formatNum(mult)} production · level ${level} · +${formatNum(rate)}/${formatNum(milestone)}/s`);

  const fill = row.querySelector(".milestone-fill");
  setWidth(fill, `${Math.min(rate / milestone, 1) * 100}%`);

  const btn = row.querySelector(".upgrade-buy");
  setDisabled(btn, !canBuy);
  const nextMult = upgradeMult * PRODUCTION_UPGRADE_MULT * achievementMultiplier();
  setUpgradeBuyBtn(
    btn,
    milestoneOk ? "Upgrade" : "Locked",
    milestoneOk
      ? `${formatNum(cost)} ✦ → ×${formatNum(nextMult)}`
      : `Need +${formatNum(milestone)}/s`,
  );
}

function updatePrestigeUI() {
  if (!prestigeRowEl) return;

  const desc = prestigeRowEl.querySelector(".box-desc");
  const prestigeBtn = prestigeRowEl.querySelector(".prestige-btn");
  const claimBtn = prestigeRowEl.querySelector(".claim-stars-btn");
  const canClaim = (state.inactiveStars > 0 || state.upgradePoints > 0)
    && canAfford(state.shards, CLAIM_STARS_SHARD_COST);
  const cooldownMs = prestigeCooldownRemaining();
  const onCooldown = cooldownMs > 0;

  let descText = state.prestigeCount > 0
    ? `Prestiges: ${formatCount(state.prestigeCount)} · ${formatCount(state.inactiveStars)} ✦ locked · spendable stars return to locked when used`
    : `${formatCount(state.inactiveStars)} ✦ locked · earn stars from token upgrades, then prestige or claim them`;
  if (onCooldown) {
    descText += ` · Prestige available in ${formatDuration(Math.ceil(cooldownMs / 1000))}`;
  }

  setText(desc, descText);

  setDisabled(prestigeBtn, onCooldown);
  const nextCooldownSec = Math.ceil(prestigeCooldownMs(state.prestigeCount + 1) / 1000);
  setUpgradeBuyBtn(
    prestigeBtn,
    onCooldown ? "On Cooldown" : "Prestige",
    onCooldown
      ? `Available in ${formatDuration(Math.ceil(cooldownMs / 1000))}`
      : `Reset run · unlock ✦`,
  );

  setDisabled(claimBtn, !canClaim);
  setUpgradeBuyBtn(
    claimBtn,
    "Claim Stars",
    state.inactiveStars > 0 || state.upgradePoints > 0
      ? `${formatCount(CLAIM_STARS_SHARD_COST)} ◆ · unlock ${formatCount(state.inactiveStars)} ✦`
      : `${formatCount(CLAIM_STARS_SHARD_COST)} ◆ · no stars`,
  );
}

function updateUpgradeUI() {
  setText(upgradeCountEl, formatCount(state.upgradePoints));
  setText(inactiveStarCountEl, `+${formatCount(state.inactiveStars)} locked`);
  for (const row of upgradeRows) updateUpgradeRow(row);
  updatePrestigeUI();
  updateBoxUI();
  updateAchievementUI();
}

function updateUI(force = false) {
  if (!force && !uiDirty) return;

  const tokenRate = tokenProductionRate();
  const tokenMult = tokenProductionMultiplier();
  setText(tokenCountEl, formatNum(state.tokens));
  setText(tokenRateEl, `+${formatNum(tokenRate)}/s (×${formatNum(tokenMult)})`);

  for (let i = 0; i < CURRENCIES.length; i++) {
    const card = cards[i];
    if (!card) continue;
    const rate = productionRate(i);
    const mult = totalProductionMultiplier(i);
    setText(card.amountEl, formatNum(state.amounts[i]));
    setText(card.productionEl, `+${formatNum(rate)}/s (×${formatNum(mult)})`);

    if (card.tokenUpgradeBtn && card.tokenUpgradeDetail) {
      const cost = tokenUpgradeCost();
      const canBuy = canAfford(state.amounts[0], cost);
      const nextUpgrade = state.tokenUpgrades + 1;
      const { min, max } = tokenUpgradeStarRange(nextUpgrade);
      setDisabled(card.tokenUpgradeBtn, !canBuy);
      setText(
        card.tokenUpgradeDetail,
        `${formatNum(cost)} Dust · earn ${formatCount(min)}–${formatCount(max)} locked ✦ · owned ${formatCount(state.tokenUpgrades)}`,
      );
    }

    if (card.boostBtn && card.boostDetail) {
      const max = maxAffordableBoosters(i);
      const batch = batchSize(max);
      setDisabled(card.boostBtn, batch === 0);
      setText(card.boostDetail, `Buy ${formatCount(batch)} (${formatCount(max)} max)`);
    }

    if (card.exchangeBtn && card.exchangeDetail) {
      const ratio = exchangeRatio(i);
      const tokenCost = exchangeTokenCost(i);
      const max = maxAffordableExchanges(i);
      const batch = batchSize(max);
      setDisabled(card.exchangeBtn, batch === 0);
      setText(
        card.exchangeDetail,
        batch === 0
          ? `Max ${formatCount(max)} · ${formatNum(ratio)} + ${formatCount(tokenCost)} token each`
          : `Buy ${formatCount(batch)} (${formatCount(max)} max) · ${formatNum(ratio * batch)} + ${formatCount(tokenCost * batch)} tokens`,
      );
    }

  }

  updateUpgradeUI();
  uiDirty = false;
  lastUIAt = Date.now();
}

function render() {
  buildUI();
  buildUpgradeUI();
  buildBoxUI();
  buildAchievementUI();
  updateUI(true);
}

function save() {
  flushProduction();
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    amounts: state.amounts,
    boosters: state.boosters,
    tokenUpgrades: state.tokenUpgrades,
    tokens: state.tokens,
    upgradePoints: state.upgradePoints,
    inactiveStars: state.inactiveStars,
    prestigeCount: state.prestigeCount,
    lastPrestigeAt: state.lastPrestigeAt,
    completedAchievements: state.completedAchievements,
    claimedAchievements: state.claimedAchievements,
    totalStarsEarned: state.totalStarsEarned,
    boxesOpened: state.boxesOpened,
    lifetimeDustCollected: state.lifetimeDustCollected,
    totalTokensSpent: state.totalTokensSpent,
    lifetimeTokenUpgrades: state.lifetimeTokenUpgrades,
    firstMineralBought: state.firstMineralBought,
    productionUpgrades: state.productionUpgrades,
    tokenStarUpgrades: state.tokenStarUpgrades,
    shards: state.shards,
    dailyStreak: state.dailyStreak,
    lastDailyClaimDay: state.lastDailyClaimDay,
    unlocked: state.unlocked,
    lastTick: state.lastTick,
  }));
}

function loadArray(saved, length) {
  return Array.from({ length }, (_, i) => (typeof saved?.[i] === "number" ? saved[i] : 0));
}

function loadBoolArray(saved, length, fallback) {
  return Array.from({ length }, (_, i) => {
    if (typeof saved?.[i] === "boolean") return saved[i];
    return fallback(i);
  });
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.amounts?.length) state.amounts = loadArray(data.amounts, CURRENCIES.length);
    if (data.boosters?.length) state.boosters = loadArray(data.boosters, CURRENCIES.length);
    if (typeof data.tokenUpgrades === "number") state.tokenUpgrades = data.tokenUpgrades;
    if (typeof data.lifetimeTokenUpgrades === "number") {
      state.lifetimeTokenUpgrades = data.lifetimeTokenUpgrades;
    } else {
      state.lifetimeTokenUpgrades = state.tokenUpgrades;
    }
    if (typeof data.tokens === "number") state.tokens = data.tokens;
    if (typeof data.inactiveStars === "number") {
      state.inactiveStars = data.inactiveStars;
      if (typeof data.upgradePoints === "number") state.upgradePoints = data.upgradePoints;
    } else if (typeof data.upgradePoints === "number") {
      state.inactiveStars = data.upgradePoints;
      state.upgradePoints = 0;
    }
    if (typeof data.prestigeCount === "number") state.prestigeCount = data.prestigeCount;
    if (typeof data.lastPrestigeAt === "number") state.lastPrestigeAt = data.lastPrestigeAt;
    if (Array.isArray(data.claimedAchievements)) {
      state.claimedAchievements = data.claimedAchievements.filter((id) =>
        ACHIEVEMENTS.some((achievement) => achievement.id === id),
      );
    } else if (Array.isArray(data.completedAchievements)) {
      state.claimedAchievements = data.completedAchievements.filter((id) =>
        ACHIEVEMENTS.some((achievement) => achievement.id === id),
      );
    }
    if (Array.isArray(data.completedAchievements)) {
      state.completedAchievements = data.completedAchievements.filter((id) =>
        ACHIEVEMENTS.some((achievement) => achievement.id === id)
        && !state.claimedAchievements.includes(id),
      );
    }
    if (typeof data.totalStarsEarned === "number") state.totalStarsEarned = data.totalStarsEarned;
    if (typeof data.boxesOpened === "number") state.boxesOpened = data.boxesOpened;
    if (typeof data.lifetimeDustCollected === "number") {
      state.lifetimeDustCollected = data.lifetimeDustCollected;
    }
    if (typeof data.totalTokensSpent === "number") state.totalTokensSpent = data.totalTokensSpent;
    if (Array.isArray(data.firstMineralBought)) {
      state.firstMineralBought = loadBoolArray(data.firstMineralBought, CURRENCIES.length, () => false);
    }
    for (let tier = 1; tier < CURRENCIES.length; tier++) {
      if (state.amounts[tier] > 0) state.firstMineralBought[tier] = true;
    }
    if (data.unlocked?.length) {
      state.unlocked = loadBoolArray(data.unlocked, CURRENCIES.length, (i) => i === 0);
    }
    for (let i = 1; i < CURRENCIES.length; i++) {
      if (state.firstMineralBought[i] && (i === 1 || state.amounts[i] > 0)) {
        state.unlocked[i] = true;
      }
    }
    if (data.productionUpgrades?.length) {
      state.productionUpgrades = loadArray(data.productionUpgrades, CURRENCIES.length);
    }
    if (typeof data.tokenStarUpgrades === "number") {
      state.tokenStarUpgrades = data.tokenStarUpgrades;
    } else if (typeof data.tokenProductionUpgrades === "number") {
      state.tokenStarUpgrades = data.tokenProductionUpgrades;
    }
    if (typeof data.shards === "number") state.shards = data.shards;
    if (typeof data.dailyStreak === "number") state.dailyStreak = data.dailyStreak;
    if (typeof data.lastDailyClaimDay === "string") state.lastDailyClaimDay = data.lastDailyClaimDay;
    if (typeof data.lastTick === "number") state.lastTick = data.lastTick;
  } catch {
    /* ignore corrupt save */
  }
}

function reset() {
  if (!confirm("Reset all progress? This cannot be undone.")) return;
  localStorage.removeItem(SAVE_KEY);
  state.amounts = CURRENCIES.map(() => 0);
  state.boosters = CURRENCIES.map(() => 0);
  state.tokenUpgrades = 0;
  state.tokens = 0;
  state.upgradePoints = 0;
  state.inactiveStars = 0;
  state.prestigeCount = 0;
  state.lastPrestigeAt = 0;
  state.completedAchievements = [];
  state.claimedAchievements = [];
  state.totalStarsEarned = 0;
  state.boxesOpened = 0;
  state.lifetimeDustCollected = 0;
  state.totalTokensSpent = 0;
  state.lifetimeTokenUpgrades = 0;
  state.firstMineralBought = CURRENCIES.map(() => false);
  state.productionUpgrades = CURRENCIES.map(() => 0);
  state.tokenStarUpgrades = 0;
  state.shards = STARTING_SHARDS;
  state.dailyStreak = 0;
  state.lastDailyClaimDay = null;
  state.unlocked = CURRENCIES.map((_, i) => i === 0);
  state.lastTick = Date.now();
  render();
}

gameEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  const tier = Number(btn.dataset.tier);
  if (btn.dataset.action === "boost") buyBooster(tier);
  if (btn.dataset.action === "exchange") exchange(tier);
  if (btn.dataset.action === "token-upgrade") buyTokenUpgrade();
});

document.getElementById("daily-claim-btn")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  claimDailyShards();
});

prestigeRowEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  if (btn.dataset.action === "prestige") prestige();
  if (btn.dataset.action === "claim-stars") claimStarsWithShards();
});

boxListEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  if (btn.dataset.action === "buy-box") buyResourceBox(btn.dataset.boxId);
});

upgradeListEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  if (btn.dataset.action === "token-star-upgrade") buyTokenStarUpgrade();
  if (btn.dataset.action === "production-upgrade") {
    buyProductionUpgrade(Number(btn.dataset.target));
  }
});

achievementListEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;
  if (btn.dataset.action === "claim-achievement") claimAchievement(btn.dataset.achievementId);
});

document.getElementById("save-btn").addEventListener("click", save);
document.getElementById("reset-btn").addEventListener("click", reset);

load();
const offlineReport = applyOfflineProgress();
checkAchievements();
render();
showOfflineBanner(offlineReport);
setInterval(tick, TICK_MS);
setInterval(save, 30000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    save();
  } else {
    flushProduction(OFFLINE_MAX_SECONDS);
    checkUnlocks();
    checkAchievements();
    markDirty();
    updateUI(true);
  }
});

window.addEventListener("beforeunload", save);
