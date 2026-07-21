(() => {
  const COLS = 12;
  const ROWS = 12;
  const MOVE_MS = 400;
  const ATTACK_MS = 1800;
  /** How many cells of the enemy back row you need to own to win */
  const BACK_ROW_TO_WIN = 1;
  /** For this much match play time (excluding pauses), cursors cannot overwrite occupied tiles */
  const NO_OVERWRITE_MS = 120_000;
  /** Match length; most units on the board wins when time runs out */
  const MATCH_DURATION_MS = 20 * 60 * 1000;
  /** Extra time when regulation ends without a 5-unit lead */
  const OVERTIME_DURATION_MS = 5 * 60 * 1000;
  /** Unit lead needed to win at the end of regulation (any lead wins after OT) */
  const REGULATION_CLEARANCE = 5;
  /** Saboteur cannot spawn until this much match time has elapsed */
  const SABOTEUR_UNLOCK_MS = 10 * 60 * 1000;

  const TEAMS = {
    ember: {
      id: "ember",
      name: "Ember",
      /** Tide's home edge — Ember wins by capturing this column */
      targetBackC: COLS - 1,
      startC: 0,
      startDc: 1,
    },
    tide: {
      id: "tide",
      name: "Tide",
      /** Ember's home edge — Tide wins by capturing this column */
      targetBackC: 0,
      startC: COLS - 1,
      startDc: -1,
    },
  };

  const WEAPONS = {
    // method: area (Strike) | diagonal (Breach) | forward (Artillery) | disrupt (Saboteur)
    // cost = points per spawn boost (stronger units cost more)
    offensive: [
      { id: "strike", label: "Strike", symbol: "🗡️", power: 4, multiplier: 1, method: "area", range: 2, cost: 2 },
      { id: "breach", label: "Breach", symbol: "💥", power: 6, multiplier: 0.45, method: "diagonal", cost: 6 },
      { id: "artillery", label: "Artillery", symbol: "🚀", power: 1, multiplier: 0.8, method: "forward", cost: 3 },
      { id: "saboteur", label: "Saboteur", symbol: "🎯", power: 5, multiplier: 0.9, method: "disrupt", cost: 4 },
    ],
    defensive: [
      { id: "barricade", label: "Barricade", symbol: "🧱", armor: 10, cost: 1 },
      { id: "bunker", label: "Bunker", symbol: "🛡️", armor: 32, cost: 2 },
      { id: "fortify", label: "Fortify", symbol: "🏰", armor: 64, cost: 5 },
    ],
  };

  const UNIT_CATALOG = [
    ...WEAPONS.offensive.map((w) => ({ ...w, kind: "offensive" })),
    ...WEAPONS.defensive.map((w) => ({ ...w, kind: "defensive" })),
  ];

  const DEFAULT_BUDGET = 50;
  const MAX_BUDGET = 100;
  /** Shared preset applied by Quick start (exactly 50 points). */
  const QUICK_START_LOADOUT = {
    strike: 3,
    breach: 2,
    artillery: 3,
    saboteur: 1,
    barricade: 8,
    bunker: 3,
    fortify: 1,
  };

  const DIAGONAL_DIRS = [
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  const battlefield = document.getElementById("battlefield");
  const statusText = document.getElementById("status-text");
  const matchTimerEl = document.getElementById("match-timer");
  const placementCountEl = document.getElementById("placement-count");
  const btnPause = document.getElementById("btn-pause");
  const btnReset = document.getElementById("btn-reset");
  const btnStart = document.getElementById("btn-start");
  const btnQuickStart = document.getElementById("btn-quick-start");
  const btnDismiss = document.getElementById("btn-dismiss");
  const startScreen = document.getElementById("start-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const gameoverMessage = document.getElementById("gameover-message");
  const gameoverDuration = document.getElementById("gameover-duration");
  const inputEmberName = document.getElementById("input-ember-name");
  const inputTideName = document.getElementById("input-tide-name");
  const inputBudget = document.getElementById("input-budget");
  const emberLoadoutEl = document.getElementById("ember-loadout");
  const tideLoadoutEl = document.getElementById("tide-loadout");
  const emberPointsLeftEl = document.getElementById("ember-points-left");
  const tidePointsLeftEl = document.getElementById("tide-points-left");
  const loadoutEmberTitle = document.getElementById("loadout-ember-title");
  const loadoutTideTitle = document.getElementById("loadout-tide-title");

  battlefield.style.setProperty("--cols", COLS);
  battlefield.style.setProperty("--rows", ROWS);

  /** @type {{ owner: string, weapon: object|null, armor: number, el: HTMLElement }[]} */
  let cells = [];

  const cursors = {
    ember: { r: 0, c: 0, dc: 1 },
    tide: { r: 0, c: COLS - 1, dc: -1 },
  };

  let paused = false;
  let started = false;
  let winner = null;
  let placementCount = 0;
  let attackTurn = "ember";
  let matchStartedAt = 0;
  let matchEndsAt = 0;
  let timerRemainingMs = MATCH_DURATION_MS;
  let inOvertime = false;
  let moveInterval = null;
  let attackInterval = null;
  let timerInterval = null;
  let tracerLayer = null;
  let budgetPoints = DEFAULT_BUDGET;
  const loadouts = {
    ember: emptyLoadout(),
    tide: emptyLoadout(),
  };

  const attackTurnLabel = document.getElementById("attack-turn-label");

  function emptyLoadout() {
    const out = {};
    for (const unit of UNIT_CATALOG) out[unit.id] = 0;
    return out;
  }

  function unitById(id) {
    return UNIT_CATALOG.find((u) => u.id === id);
  }

  function spentPoints(teamId) {
    let spent = 0;
    for (const unit of UNIT_CATALOG) {
      spent += (loadouts[teamId][unit.id] || 0) * unit.cost;
    }
    return spent;
  }

  function pointsLeft(teamId) {
    return Math.max(0, budgetPoints - spentPoints(teamId));
  }

  function clampLoadoutsToBudget() {
    for (const teamId of ["ember", "tide"]) {
      while (spentPoints(teamId) > budgetPoints) {
        let trimmed = false;
        for (let i = UNIT_CATALOG.length - 1; i >= 0; i--) {
          const id = UNIT_CATALOG[i].id;
          if (loadouts[teamId][id] > 0) {
            loadouts[teamId][id] -= 1;
            trimmed = true;
            break;
          }
        }
        if (!trimmed) break;
      }
    }
  }

  function loadoutLevels(teamId, unitId) {
    return loadouts[teamId][unitId] || 0;
  }

  function getMatchElapsedMs() {
    // After a match ends, started is false — use the frozen remaining clock
    if (winner) {
      if (inOvertime) {
        return MATCH_DURATION_MS + (OVERTIME_DURATION_MS - timerRemainingMs);
      }
      return Math.max(0, MATCH_DURATION_MS - timerRemainingMs);
    }

    if (!started) return 0;

    if (inOvertime) {
      const otRemaining = paused
        ? timerRemainingMs
        : Math.max(0, matchEndsAt - Date.now());
      return MATCH_DURATION_MS + (OVERTIME_DURATION_MS - otRemaining);
    }
    const remaining = paused
      ? timerRemainingMs
      : Math.max(0, matchEndsAt - Date.now());
    return MATCH_DURATION_MS - remaining;
  }

  function isSaboteurUnlocked() {
    return getMatchElapsedMs() >= SABOTEUR_UNLOCK_MS;
  }

  /** Each purchase adds 1% spawn chance; locked Saboteur stays in the empty pool. */
  function activeSpawnChance(teamId, unitId) {
    if (unitId === "saboteur" && !isSaboteurUnlocked()) return 0;
    return loadoutLevels(teamId, unitId);
  }

  function nothingChancePct(teamId) {
    const active = UNIT_CATALOG.reduce(
      (sum, unit) => sum + activeSpawnChance(teamId, unit.id),
      0,
    );
    return Math.max(0, 100 - active);
  }

  function spawnChancePct(teamId, unitId) {
    return loadoutLevels(teamId, unitId);
  }

  /** Roll a unit from the loadout, or null when the "nothing" weight wins. */
  function pickWeightedUnit(teamId) {
    let roll = Math.random() * 100;
    const empty = nothingChancePct(teamId);
    if (roll < empty) return null;
    roll -= empty;

    for (const unit of UNIT_CATALOG) {
      const chance = activeSpawnChance(teamId, unit.id);
      if (chance <= 0) continue;
      roll -= chance;
      if (roll < 0) return unit;
    }

    return null;
  }

  function applyLoadoutPreset(preset) {
    for (const teamId of ["ember", "tide"]) {
      loadouts[teamId] = emptyLoadout();
      for (const unit of UNIT_CATALOG) {
        loadouts[teamId][unit.id] = Math.max(0, Math.round(Number(preset[unit.id]) || 0));
      }
    }
    clampLoadoutsToBudget();
    updateLoadoutUI();
  }

  function quickStartMatch() {
    setBudget(DEFAULT_BUDGET);
    applyLoadoutPreset(QUICK_START_LOADOUT);
    beginMatch();
  }

  function setBudget(next) {
    const value = Math.max(0, Math.min(MAX_BUDGET, Math.round(Number(next) || 0)));
    budgetPoints = value;
    if (inputBudget) inputBudget.value = String(value);
    clampLoadoutsToBudget();
    updateLoadoutUI();
  }

  function adjustLoadout(teamId, unitId, delta) {
    const unit = unitById(unitId);
    if (!unit) return;

    const current = loadouts[teamId][unitId] || 0;
    if (delta > 0) {
      if (pointsLeft(teamId) < unit.cost) return;
      loadouts[teamId][unitId] = current + 1;
    } else if (delta < 0 && current > 0) {
      loadouts[teamId][unitId] = current - 1;
    }
    updateLoadoutUI();
  }

  function buildLoadoutUI() {
    for (const teamId of ["ember", "tide"]) {
      const root = teamId === "ember" ? emberLoadoutEl : tideLoadoutEl;
      if (!root) continue;
      root.innerHTML = "";

      for (const unit of UNIT_CATALOG) {
        const row = document.createElement("div");
        row.className = "loadout-row";
        row.dataset.unit = unit.id;

        const kindLabel = unit.id === "saboteur"
          ? `Offensive · ${unit.cost} pts/+1% · after 10m`
          : unit.kind === "offensive"
            ? `Offensive · ${unit.cost} pts/+1%`
            : `Defensive · ${unit.cost} pts/+1%`;

        row.innerHTML = `
          <div class="loadout-unit">
            <span class="loadout-unit-symbol" aria-hidden="true">${unit.symbol}</span>
            <div class="loadout-unit-meta">
              <strong>${unit.label}</strong>
              <span>${kindLabel}</span>
            </div>
          </div>
          <div class="loadout-controls">
            <button type="button" data-action="dec" aria-label="Decrease ${unit.label}">−</button>
            <span class="loadout-level">0</span>
            <button type="button" data-action="inc" aria-label="Increase ${unit.label}">+</button>
          </div>
          <div class="loadout-chance" title="Spawn chance"><i></i></div>
        `;

        row.querySelector('[data-action="dec"]').addEventListener("click", () => {
          adjustLoadout(teamId, unit.id, -1);
        });
        row.querySelector('[data-action="inc"]').addEventListener("click", () => {
          adjustLoadout(teamId, unit.id, 1);
        });

        root.appendChild(row);
      }
    }

    updateLoadoutUI();
  }

  function updateHudLoadouts() {
    for (const teamId of ["ember", "tide"]) {
      const list = document.getElementById(`${teamId}-hud-loadout`);
      if (!list) continue;
      list.innerHTML = "";

      let hasBoosts = false;
      for (const unit of UNIT_CATALOG) {
        const chance = spawnChancePct(teamId, unit.id);
        if (chance <= 0) continue;
        hasBoosts = true;

        const li = document.createElement("li");
        const locked = unit.id === "saboteur" && !isSaboteurUnlocked()
          ? " · after 10m"
          : "";
        li.innerHTML = `
          <span class="hud-loadout-symbol" aria-hidden="true">${unit.symbol}</span>
          <span>${unit.label}</span>
          <span class="hud-loadout-chance">${chance}%${locked}</span>
        `;
        list.appendChild(li);
      }

      const emptyLi = document.createElement("li");
      emptyLi.className = "hud-loadout-empty";
      const empty = nothingChancePct(teamId);
      emptyLi.innerHTML = hasBoosts
        ? `<span>Empty</span><span class="hud-loadout-chance">${empty}%</span>`
        : `<span>No boosts · ${empty}% empty</span>`;
      list.appendChild(emptyLi);
    }
  }

  function updateLoadoutUI() {
    if (emberPointsLeftEl) {
      emberPointsLeftEl.textContent = `${pointsLeft("ember")} pts · ${nothingChancePct("ember").toFixed(0)}% empty`;
    }
    if (tidePointsLeftEl) {
      tidePointsLeftEl.textContent = `${pointsLeft("tide")} pts · ${nothingChancePct("tide").toFixed(0)}% empty`;
    }
    if (loadoutEmberTitle) loadoutEmberTitle.textContent = TEAMS.ember.name;
    if (loadoutTideTitle) loadoutTideTitle.textContent = TEAMS.tide.name;

    for (const teamId of ["ember", "tide"]) {
      const root = teamId === "ember" ? emberLoadoutEl : tideLoadoutEl;
      if (!root) continue;
      const left = pointsLeft(teamId);

      for (const unit of UNIT_CATALOG) {
        const row = root.querySelector(`[data-unit="${unit.id}"]`);
        if (!row) continue;
        const level = loadouts[teamId][unit.id] || 0;
        const chance = spawnChancePct(teamId, unit.id);
        row.querySelector(".loadout-level").textContent = String(level);
        row.querySelector(".loadout-chance > i").style.width = `${chance}%`;
        row.querySelector(".loadout-chance").title = `${chance}% spawn chance`;
        row.querySelector('[data-action="dec"]').disabled = level <= 0;
        row.querySelector('[data-action="inc"]').disabled = left < unit.cost;
      }
    }

    updateHudLoadouts();
  }

  function sanitizeName(value, fallback) {
    const cleaned = String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
    return cleaned || fallback;
  }

  function applyTeamNamesFromInputs() {
    TEAMS.ember.name = sanitizeName(inputEmberName.value, "Ember");
    TEAMS.tide.name = sanitizeName(inputTideName.value, "Tide");
    inputEmberName.value = TEAMS.ember.name;
    inputTideName.value = TEAMS.tide.name;
    updateTeamLabels();
  }

  function updateTeamLabels() {
    document.getElementById("ember-name-label").textContent = TEAMS.ember.name;
    document.getElementById("tide-name-label").textContent = TEAMS.tide.name;
    updateAttackTurnLabel();
    updateLoadoutUI();
  }

  function updateAttackTurnLabel() {
    if (!attackTurnLabel) return;
    attackTurnLabel.textContent = `Attack turn: ${TEAMS[attackTurn].name}`;
  }

  function showStartScreen() {
    startScreen.classList.remove("hidden");
    startScreen.setAttribute("aria-hidden", "false");
    gameoverScreen.classList.add("hidden");
    gameoverScreen.setAttribute("aria-hidden", "true");
    btnPause.disabled = true;
    statusText.textContent = "Name teams, set loadouts, then start the war";
  }

  function hideStartScreen() {
    startScreen.classList.add("hidden");
    startScreen.setAttribute("aria-hidden", "true");
  }

  function showGameOverScreen(message, durationLabel = null) {
    gameoverMessage.textContent = message;
    if (gameoverDuration) {
      if (durationLabel) {
        gameoverDuration.textContent = durationLabel;
        gameoverDuration.classList.remove("hidden");
      } else {
        gameoverDuration.textContent = "";
        gameoverDuration.classList.add("hidden");
      }
    }
    hideStartScreen();
    gameoverScreen.classList.remove("hidden");
    gameoverScreen.setAttribute("aria-hidden", "false");
  }

  function formatMatchDurationLabel() {
    return `Match length: ${formatMatchTime(getMatchElapsedMs())}`;
  }

  function idx(r, c) {
    return r * COLS + c;
  }

  function inBounds(r, c) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function isOwn(teamId, r, c) {
    return inBounds(r, c) && cells[idx(r, c)].owner === teamId;
  }

  function placeBarricade(teamId, r, c) {
    const blueprint = WEAPONS.defensive.find((w) => w.id === "barricade");
    const cell = cells[idx(r, c)];
    cell.owner = teamId;
    cell.weapon = { ...blueprint, kind: "defensive", team: teamId };
    cell.armor = blueprint.armor;
    paintCell(cell);
  }

  /** Line each team's home edge and front line with barricades. */
  function seedStartingWalls() {
    const emberFront = Math.floor(COLS / 2) - 1;
    const tideFront = Math.floor(COLS / 2);

    for (let r = 0; r < ROWS; r++) {
      placeBarricade("ember", r, emberFront);
      placeBarricade("tide", r, tideFront);
    }
  }

  function createGrid() {
    battlefield.innerHTML = "";
    cells = [];
    tracerLayer = document.createElement("div");
    tracerLayer.className = "attack-tracers";
    battlefield.appendChild(tracerLayer);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const el = document.createElement("div");
        el.className = "cell";
        if (c === 0) el.classList.add("back-row-ember");
        if (c === COLS - 1) el.classList.add("back-row-tide");
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        battlefield.appendChild(el);

        const owner = c < COLS / 2 ? "ember" : "tide";
        cells.push({ owner, weapon: null, armor: 0, el });
        paintCell(cells[cells.length - 1]);
      }
    }

    seedStartingWalls();

    // Start each cursor on its own back row
    cursors.ember = { r: 0, c: 0, dc: 1 };
    cursors.tide = { r: 0, c: COLS - 1, dc: -1 };
    settleOnOwn("ember");
    settleOnOwn("tide");

    updateCursorClass();
    updateScores();
  }

  function cellCenter(r, c) {
    const cellRect = cells[idx(r, c)].el.getBoundingClientRect();
    const fieldRect = battlefield.getBoundingClientRect();
    return {
      x: cellRect.left - fieldRect.left + cellRect.width / 2,
      y: cellRect.top - fieldRect.top + cellRect.height / 2,
    };
  }

  function showAttackTracer(teamId, fromR, fromC, toR, toC) {
    if (!tracerLayer) return;

    const start = cellCenter(fromR, fromC);
    const end = cellCenter(toR, toC);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;

    const tracer = document.createElement("div");
    tracer.className = `attack-tracer ${teamId}`;
    tracer.style.left = `${start.x}px`;
    tracer.style.top = `${start.y}px`;
    tracer.style.width = `${length}px`;
    tracer.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    tracerLayer.appendChild(tracer);

    setTimeout(() => tracer.remove(), 320);
  }

  function paintCell(cell) {
    cell.el.classList.remove("ember", "tide");
    cell.el.classList.add(cell.owner);

    cell.el.querySelector(".armor-bar")?.remove();
    const existing = cell.el.querySelector(".weapon");
    if (existing) existing.remove();

    if (cell.weapon) {
      const w = document.createElement("span");
      w.className = `weapon ${cell.weapon.kind}`;
      w.textContent = cell.weapon.symbol;
      if (cell.weapon.kind === "defensive") {
        const maxArmor = cell.weapon.armor;
        w.title = `${cell.weapon.label} · armor ${Math.ceil(cell.armor)} / ${maxArmor}`;
      } else {
        w.title = `${cell.weapon.label} · power ${cell.weapon.power} · mult ${cell.weapon.multiplier}`;
      }
      cell.el.appendChild(w);
    }

    updateArmorBar(cell);
  }

  function updateArmorBar(cell) {
    const existing = cell.el.querySelector(".armor-bar");
    if (!cell.weapon || cell.weapon.kind !== "defensive" || cell.armor <= 0) {
      existing?.remove();
      return;
    }

    const maxArmor = cell.weapon.armor;
    const pct = Math.max(0, Math.min(100, (cell.armor / maxArmor) * 100));

    let bar = existing;
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "armor-bar";
      bar.innerHTML = '<div class="armor-bar-fill"></div>';
      cell.el.appendChild(bar);
    }

    bar.querySelector(".armor-bar-fill").style.width = `${pct}%`;
    bar.title = `Armor ${Math.ceil(cell.armor)} / ${maxArmor}`;

    const wEl = cell.el.querySelector(".weapon");
    if (wEl) {
      wEl.title = `${cell.weapon.label} · armor ${Math.ceil(cell.armor)} / ${maxArmor}`;
    }
  }

  function updateCursorClass() {
    cells.forEach((cell) => {
      cell.el.classList.remove("cursor-ember", "cursor-tide", "cursor-both");
    });

    const emberKey = idx(cursors.ember.r, cursors.ember.c);
    const tideKey = idx(cursors.tide.r, cursors.tide.c);

    if (emberKey === tideKey) {
      cells[emberKey].el.classList.add("cursor-both");
    } else {
      cells[emberKey].el.classList.add("cursor-ember");
      cells[tideKey].el.classList.add("cursor-tide");
    }
  }

  function backRowHeld(teamId) {
    const col = TEAMS[teamId].targetBackC;
    let held = 0;
    for (let r = 0; r < ROWS; r++) {
      if (cells[idx(r, col)].owner === teamId) held += 1;
    }
    return held;
  }

  function formatMatchTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function countUnitsOnBoard() {
    let ember = 0;
    let tide = 0;
    for (const cell of cells) {
      if (!cell.weapon) continue;
      if (cell.owner === "ember") ember += 1;
      if (cell.owner === "tide") tide += 1;
    }
    return { ember, tide };
  }

  function updateTimerDisplay() {
    if (!matchTimerEl) return;

    // Lobby / fresh board only — keep the final clock after a match ends
    if (!started && !winner) {
      matchTimerEl.textContent = formatMatchTime(MATCH_DURATION_MS);
      matchTimerEl.classList.remove("low", "overtime");
      return;
    }

    if (winner) {
      matchTimerEl.textContent = inOvertime
        ? `OT ${formatMatchTime(timerRemainingMs)}`
        : formatMatchTime(timerRemainingMs);
      matchTimerEl.classList.toggle("overtime", inOvertime);
      matchTimerEl.classList.toggle("low", timerRemainingMs > 0 && timerRemainingMs <= 60_000);
      return;
    }

    const remaining = paused
      ? timerRemainingMs
      : Math.max(0, matchEndsAt - Date.now());
    matchTimerEl.textContent = inOvertime
      ? `OT ${formatMatchTime(remaining)}`
      : formatMatchTime(remaining);
    matchTimerEl.classList.toggle("overtime", inOvertime);
    matchTimerEl.classList.toggle("low", remaining > 0 && remaining <= 60_000);
  }

  function freezeMatchTimer() {
    timerRemainingMs = Math.max(0, matchEndsAt - Date.now());
  }

  /**
   * Frame split: top/bottom move across 25–75% unit share.
   * Past that, the trailing team's back wall closes in from top & bottom.
   */
  function updateScoreBorder(units) {
    let share = 0.5;
    if (winner === "ember") {
      share = 1;
    } else if (winner === "tide") {
      share = 0;
    } else if (winner !== "tie") {
      const total = units.ember + units.tide;
      if (total > 0) share = units.ember / total;
    }

    let midSplit = 0.5;
    let leftEat = 0;
    let rightEat = 0;

    if (share <= 0) {
      midSplit = 0;
      leftEat = 1;
    } else if (share >= 1) {
      midSplit = 1;
      rightEat = 1;
    } else if (share < 0.25) {
      midSplit = 0;
      leftEat = 1 - share / 0.25;
    } else if (share > 0.75) {
      midSplit = 1;
      rightEat = (share - 0.75) / 0.25;
    } else {
      midSplit = (share - 0.25) / 0.5;
    }

    battlefield.style.setProperty("--mid-split", String(midSplit));
    battlefield.style.setProperty("--left-eat", String(leftEat));
    battlefield.style.setProperty("--right-eat", String(rightEat));
  }

  function updateScores() {
    const units = countUnitsOnBoard();
    document.getElementById("ember-units").textContent = String(units.ember);
    document.getElementById("tide-units").textContent = String(units.tide);
    placementCountEl.textContent = `${placementCount} placement${placementCount === 1 ? "" : "s"}`;
    updateScoreBorder(units);
  }

  /** One step of a full-grid snake scan (covers every square in order). */
  function advanceSnake(cursor) {
    const nextC = cursor.c + cursor.dc;
    if (nextC >= 0 && nextC < COLS) {
      cursor.c = nextC;
      return;
    }
    cursor.dc *= -1;
    if (cursor.r + 1 < ROWS) {
      cursor.r += 1;
    } else {
      cursor.r = 0;
      cursor.c = cursor.dc > 0 ? 0 : COLS - 1;
    }
  }

  /** Keep advancing the snake until sitting on own colour. */
  function settleOnOwn(teamId) {
    const cursor = cursors[teamId];
    const startKey = idx(cursor.r, cursor.c);
    if (isOwn(teamId, cursor.r, cursor.c)) return;

    do {
      advanceSnake(cursor);
    } while (!isOwn(teamId, cursor.r, cursor.c) && idx(cursor.r, cursor.c) !== startKey);
  }

  /**
   * Move to the next own-coloured cell in snake order.
   * Every owned square is visited equally; enemy squares are skipped.
   */
  function stepCursor(teamId) {
    const cursor = cursors[teamId];
    const startKey = idx(cursor.r, cursor.c);

    do {
      advanceSnake(cursor);
    } while (!isOwn(teamId, cursor.r, cursor.c) && idx(cursor.r, cursor.c) !== startKey);
  }

  function endMatch(reason, teamId, message) {
    freezeMatchTimer();
    winner = teamId;
    started = false;
    stopLoops();
    paused = true;
    btnPause.textContent = "Resume";
    btnPause.disabled = true;
    statusText.textContent = message;
    battlefield.classList.add("game-over");
    if (teamId === "ember" || teamId === "tide") {
      battlefield.classList.add(`winner-${teamId}`);
    }
    updateScores();
    updateTimerDisplay();
    showGameOverScreen(message);
  }

  function declareWinner(teamId) {
    freezeMatchTimer();
    winner = teamId;
    started = false;
    stopLoops();
    paused = true;
    btnPause.textContent = "Resume";
    btnPause.disabled = true;
    const held = backRowHeld(teamId);
    const message = `${TEAMS[teamId].name} holds the enemy back row (${held}) — victory!`;
    statusText.textContent = message;
    battlefield.classList.add("game-over", `winner-${teamId}`);
    updateScores();
    updateTimerDisplay();
    showGameOverScreen(message, formatMatchDurationLabel());
  }

  function startOvertime(units) {
    inOvertime = true;
    timerRemainingMs = OVERTIME_DURATION_MS;
    matchEndsAt = Date.now() + OVERTIME_DURATION_MS;
    const lead = Math.abs(units.ember - units.tide);
    statusText.textContent = lead === 0
      ? `Overtime — tied at ${units.ember} units. Most units when OT ends wins!`
      : `Overtime — lead only ${lead} (need ${REGULATION_CLEARANCE}). Most units when OT ends wins!`;
    updateTimerDisplay();
  }

  function endMatchByTime() {
    if (winner || !started) return;

    const units = countUnitsOnBoard();
    const lead = Math.abs(units.ember - units.tide);

    // Regulation: need a clear lead, otherwise OT
    if (!inOvertime && lead < REGULATION_CLEARANCE) {
      startOvertime(units);
      return;
    }

    if (units.ember > units.tide) {
      endMatch(
        "time",
        "ember",
        `${TEAMS.ember.name} wins on time — ${units.ember} units vs ${units.tide}`,
      );
      return;
    }
    if (units.tide > units.ember) {
      endMatch(
        "time",
        "tide",
        `${TEAMS.tide.name} wins on time — ${units.tide} units vs ${units.ember}`,
      );
      return;
    }

    endMatch(
      "time",
      "tie",
      `Overtime ended — still tied on units (${units.ember} each)`,
    );
  }

  let saboteurHudUnlocked = false;

  function syncSaboteurHud() {
    const unlocked = isSaboteurUnlocked();
    if (unlocked === saboteurHudUnlocked) return;
    saboteurHudUnlocked = unlocked;
    updateHudLoadouts();
  }

  function tickMatchTimer() {
    if (!started || winner || paused) return;
    updateTimerDisplay();
    syncSaboteurHud();
    if (Date.now() >= matchEndsAt) endMatchByTime();
  }

  function checkWin() {
    const emberHeld = backRowHeld("ember");
    const tideHeld = backRowHeld("tide");
    const emberWins = emberHeld >= BACK_ROW_TO_WIN;
    const tideWins = tideHeld >= BACK_ROW_TO_WIN;

    if (emberWins && tideWins) {
      freezeMatchTimer();
      winner = "tie";
      started = false;
      stopLoops();
      paused = true;
      btnPause.disabled = true;
      const message = "Dead heat — both hold the enemy back row!";
      statusText.textContent = message;
      battlefield.classList.add("game-over");
      updateScores();
      updateTimerDisplay();
      showGameOverScreen(message, formatMatchDurationLabel());
      return true;
    }
    if (emberWins) {
      declareWinner("ember");
      return true;
    }
    if (tideWins) {
      declareWinner("tide");
      return true;
    }
    return false;
  }

  function tryPlace(teamId) {
    const cursor = cursors[teamId];
    const cell = cells[idx(cursor.r, cursor.c)];
    if (cell.owner !== teamId) return null;

    // Opening window: cannot overwrite an existing unit (paused time excluded)
    const inOpening = started && getMatchElapsedMs() < NO_OVERWRITE_MS;
    if (inOpening && cell.weapon) return null;

    const blueprint = pickWeightedUnit(teamId);
    if (!blueprint) return null;

    const kind = blueprint.kind;
    cell.weapon = { ...blueprint, kind, team: teamId };
    cell.armor = kind === "defensive" ? blueprint.armor : 0;
    paintCell(cell);
    cell.el.classList.add("flash-capture");
    setTimeout(() => cell.el.classList.remove("flash-capture"), 550);

    placementCount += 1;
    return blueprint.label;
  }

  function moveCursors() {
    if (paused || winner) return;

    settleOnOwn("ember");
    settleOnOwn("tide");

    stepCursor("ember");
    stepCursor("tide");
    updateCursorClass();

    const placed = [];
    const emberPlace = tryPlace("ember");
    const tidePlace = tryPlace("tide");
    if (emberPlace) placed.push(`Ember ${emberPlace}`);
    if (tidePlace) placed.push(`Tide ${tidePlace}`);

    updateScores();

    const emberBack = backRowHeld("ember");
    const tideBack = backRowHeld("tide");

    if (placed.length) {
      statusText.textContent = placed.join("  ·  ");
    } else {
      statusText.textContent = `Back row — Ember ${emberBack}/${ROWS}  ·  Tide ${tideBack}/${ROWS}`;
    }
  }

  /**
   * Breach — diagonal rays only
   * Artillery / Saboteur — straight horizontal toward the enemy end only
   * Strike uses a single in-range hit instead (see resolveStrikeAttack)
   */
  function dirsForWeapon(weapon, teamId) {
    if (weapon.method === "diagonal") return DIAGONAL_DIRS;

    const toward = TEAMS[teamId].targetBackC > TEAMS[teamId].startC ? 1 : -1;
    return [[0, toward]];
  }

  function chebyshev(r1, c1, r2, c2) {
    return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
  }

  function traceAttackPaths(teamId, startR, startC, weapon) {
    const hits = [];

    for (const [dr, dc] of dirsForWeapon(weapon, teamId)) {
      let r = startR;
      let c = startC;
      let distance = 0;

      while (true) {
        r += dr;
        c += dc;
        distance += 1;
        if (!inBounds(r, c)) break;

        const cell = cells[idx(r, c)];
        if (cell.owner === teamId) continue;

        hits.push({ cell, r, c, distance, dr, dc });
        break;
      }
    }

    return hits;
  }

  /** Saboteur flies over empty land and only stops on the first enemy unit. */
  function traceDisruptPaths(teamId, startR, startC, weapon) {
    const hits = [];

    for (const [dr, dc] of dirsForWeapon(weapon, teamId)) {
      let r = startR;
      let c = startC;
      let distance = 0;

      while (true) {
        r += dr;
        c += dc;
        distance += 1;
        if (!inBounds(r, c)) break;

        const cell = cells[idx(r, c)];
        if (cell.owner === teamId) continue;
        if (!cell.weapon) continue;

        hits.push({ cell, r, c, distance, dr, dc });
        break;
      }
    }

    return hits;
  }

  /** Power falls off with travel distance; kept as a float (not rounded down). */
  function attackPower(weapon, distance) {
    return weapon.power * Math.pow(weapon.multiplier, Math.max(0, distance - 1));
  }

  /** Ray attacks (Breach, Artillery, Saboteur) roll variance each volley; Strike does not. */
  function rayAttackVariance() {
    return 0.5 + Math.random() * 1.5;
  }

  /** Hit a single enemy cell once (used by Strike). */
  function hitEnemyCell(attackerTeam, weapon, cell, distance) {
    let power = attackPower(weapon, distance);
    if (power <= 0 || cell.owner === attackerTeam) return false;

    cell.el.classList.add("under-fire");
    setTimeout(() => cell.el.classList.remove("under-fire"), 450);

    if (cell.weapon?.kind === "defensive" && cell.armor > 0) {
      const blocked = Math.min(power, cell.armor);
      cell.armor -= blocked;
      power -= blocked;

      const wEl = cell.el.querySelector(".weapon");
      if (wEl) {
        wEl.classList.add("hit");
        setTimeout(() => wEl.classList.remove("hit"), 450);
      }

      if (cell.armor > 0) {
        updateArmorBar(cell);
        return false;
      }

      cell.weapon = null;
      cell.armor = 0;
      paintCell(cell);
    }

    power -= 1;
    cell.owner = attackerTeam;
    cell.weapon = null;
    cell.armor = 0;
    paintCell(cell);
    cell.el.classList.add("flash-capture");
    setTimeout(() => cell.el.classList.remove("flash-capture"), 550);
    return true;
  }

  /** Strike: pick one enemy square within range and hit it. */
  function enemiesInRange(teamId, fromR, fromC, range) {
    const out = [];
    for (let r = fromR - range; r <= fromR + range; r++) {
      for (let c = fromC - range; c <= fromC + range; c++) {
        if (!inBounds(r, c)) continue;
        if (r === fromR && c === fromC) continue;
        const distance = chebyshev(fromR, fromC, r, c);
        if (distance > range) continue;
        const cell = cells[idx(r, c)];
        if (cell.owner === teamId) continue;
        out.push({ cell, r, c, distance });
      }
    }
    return out;
  }

  function hasEnemyInRange(teamId, fromR, fromC, range) {
    return enemiesInRange(teamId, fromR, fromC, range).length > 0;
  }

  function resolveStrikeAttack(attackerTeam, weapon, fromR, fromC) {
    const range = weapon.range || 2;
    const targets = enemiesInRange(attackerTeam, fromR, fromC, range);
    if (!targets.length) return 0;

    const homeCol = TEAMS[attackerTeam].startC;

    // Prefer offensive > empty > defensive, then nearest own wall, then random
    const offensive = targets.filter((t) => t.cell.weapon?.kind === "offensive");
    const empty = targets.filter((t) => !t.cell.weapon);
    const defensive = targets.filter((t) => t.cell.weapon?.kind === "defensive");
    let pool = offensive.length ? offensive : empty.length ? empty : defensive.length ? defensive : targets;

    const minWall = Math.min(...pool.map((t) => Math.abs(t.c - homeCol)));
    pool = pool.filter((t) => Math.abs(t.c - homeCol) === minWall);

    const chosen = pick(pool);
    showAttackTracer(attackerTeam, fromR, fromC, chosen.r, chosen.c);
    return hitEnemyCell(attackerTeam, weapon, chosen.cell, chosen.distance) ? 1 : 0;
  }

  /**
   * Push along a ray through enemy land while power remains.
   * Arrival power already has distance multipliers applied.
   * Armour spends from that remaining power; each capture costs 1.
   * Moving one square deeper multiplies remaining power by the weapon multiplier again.
   */
  function resolveAttackPush(attackerTeam, weapon, hit) {
    let power = attackPower(weapon, hit.distance) * rayAttackVariance();
    let r = hit.r;
    let c = hit.c;
    let distance = hit.distance;
    let captures = 0;

    if (power <= 0) {
      return 0;
    }

    while (power > 0 && inBounds(r, c)) {
      const cell = cells[idx(r, c)];
      if (cell.owner === attackerTeam) break;

      cell.el.classList.add("under-fire");
      setTimeout(() => cell.el.classList.remove("under-fire"), 450);

      if (cell.weapon?.kind === "defensive" && cell.armor > 0) {
        const blocked = Math.min(power, cell.armor);
        cell.armor -= blocked;
        power -= blocked;

        const wEl = cell.el.querySelector(".weapon");
        if (wEl) {
          wEl.classList.add("hit");
          setTimeout(() => wEl.classList.remove("hit"), 450);
        }

        if (cell.armor > 0) {
          updateArmorBar(cell);
          break;
        }

        cell.weapon = null;
        cell.armor = 0;
        paintCell(cell);
      }

      // Breach needs at least 1 power to take a square; Artillery can capture with fractional power
      if (weapon.method === "diagonal" && power < 1) break;

      power -= 1;
      cell.owner = attackerTeam;
      cell.weapon = null;
      cell.armor = 0;
      paintCell(cell);
      cell.el.classList.add("flash-capture");
      setTimeout(() => cell.el.classList.remove("flash-capture"), 550);
      captures += 1;

      // Artillery stops after a single capture
      if (weapon.method === "forward") break;

      r += hit.dr;
      c += hit.dc;
      distance += 1;

      // Next square: apply one more multiplier step to the remaining power (no rounding down)
      if (power > 0) {
        power *= weapon.multiplier;
      }
    }

    return captures;
  }

  /**
   * Saboteur — damage units only, never capture territory.
   * Stops on the first enemy unit in the ray.
   */
  function resolveDisruptShot(attackerTeam, weapon, hit) {
    let power = attackPower(weapon, hit.distance) * rayAttackVariance();
    if (power <= 0) return 0;

    const cell = hit.cell;
    if (cell.owner === attackerTeam || !cell.weapon) return 0;

    cell.el.classList.add("under-fire");
    setTimeout(() => cell.el.classList.remove("under-fire"), 450);

    if (cell.weapon.kind === "defensive" && cell.armor > 0) {
      const blocked = Math.min(power, cell.armor);
      cell.armor -= blocked;
      power -= blocked;

      const wEl = cell.el.querySelector(".weapon");
      if (wEl) {
        wEl.classList.add("hit");
        setTimeout(() => wEl.classList.remove("hit"), 450);
      }

      if (cell.armor > 0) {
        updateArmorBar(cell);
        return 0;
      }

      cell.weapon = null;
      cell.armor = 0;
      paintCell(cell);
      return 1;
    }

    // Offensive units are destroyed outright; ownership stays with the enemy
    cell.weapon = null;
    cell.armor = 0;
    paintCell(cell);
    return 1;
  }

  function pickAttackTarget(teamId, hits, weapon) {
    if (!hits.length) return null;

    const targetCol = TEAMS[teamId].targetBackC;

    // Artillery / Saboteur: prioritise the enemy back row when any ray can reach it
    if (weapon.method === "forward" || weapon.method === "disrupt") {
      const onBack = hits.filter((h) => h.c === targetCol);
      if (onBack.length) {
        const minDist = Math.min(...onBack.map((h) => h.distance));
        return pick(onBack.filter((h) => h.distance === minDist));
      }
      // Otherwise the shot that lands closest to the back row
      const best = Math.min(...hits.map((h) => Math.abs(h.c - targetCol)));
      const closest = hits.filter((h) => Math.abs(h.c - targetCol) === best);
      const minDist = Math.min(...closest.map((h) => h.distance));
      return pick(closest.filter((h) => h.distance === minDist));
    }

    // Breach: shortest valid diagonal shot
    const minDist = Math.min(...hits.map((h) => h.distance));
    return pick(hits.filter((h) => h.distance === minDist));
  }

  function runAttacks() {
    if (paused || winner) return;

    const teamId = attackTurn;
    const attackers = [];
    // Fire column by column from each team's home edge toward the enemy, top to
    // bottom within each column (Ember L→R, Tide R→L).
    const colStart = teamId === "ember" ? 0 : COLS - 1;
    const colEnd = teamId === "ember" ? COLS : -1;
    const colStep = teamId === "ember" ? 1 : -1;
    for (let c = colStart; c !== colEnd; c += colStep) {
      for (let r = 0; r < ROWS; r++) {
        const cell = cells[idx(r, c)];
        if (
          cell.weapon?.kind === "offensive" &&
          cell.weapon.team === cell.owner &&
          cell.owner === teamId
        ) {
          attackers.push({ r, c, cell });
        }
      }
    }

    let captures = 0;
    let destroys = 0;
    let volleys = 0;

    for (const { r, c, cell } of attackers) {
      const weapon = cell.weapon;
      const wEl = cell.el.querySelector(".weapon");
      let gained = 0;
      let cleared = 0;

      if (weapon.method === "area") {
        const range = weapon.range || 2;
        if (!hasEnemyInRange(cell.owner, r, c, range)) continue;

        if (wEl) {
          wEl.classList.add("firing");
          setTimeout(() => wEl.classList.remove("firing"), 400);
        }

        gained = resolveStrikeAttack(cell.owner, weapon, r, c);
        volleys += 1;
      } else if (weapon.method === "disrupt") {
        const hits = traceDisruptPaths(cell.owner, r, c, weapon);
        const chosen = pickAttackTarget(cell.owner, hits, weapon);
        if (!chosen) continue;

        if (wEl) {
          wEl.classList.add("firing");
          setTimeout(() => wEl.classList.remove("firing"), 400);
        }

        volleys += 1;
        showAttackTracer(cell.owner, r, c, chosen.r, chosen.c);
        cleared = resolveDisruptShot(cell.owner, weapon, chosen);
      } else {
        const hits = traceAttackPaths(cell.owner, r, c, weapon);
        const chosen = pickAttackTarget(cell.owner, hits, weapon);
        if (!chosen) continue;

        if (wEl) {
          wEl.classList.add("firing");
          setTimeout(() => wEl.classList.remove("firing"), 400);
        }

        volleys += 1;
        showAttackTracer(cell.owner, r, c, chosen.r, chosen.c);
        gained = resolveAttackPush(cell.owner, weapon, chosen);
      }

      captures += gained;
      destroys += cleared;
    }

    settleOnOwn("ember");
    settleOnOwn("tide");
    updateCursorClass();
    updateScores();

    if (checkWin()) return;

    const teamName = TEAMS[teamId].name;
    if (volleys) {
      const parts = [
        `${volleys} attack${volleys === 1 ? "" : "s"}`,
        `${captures} capture${captures === 1 ? "" : "s"}`,
      ];
      if (destroys) parts.push(`${destroys} destroy${destroys === 1 ? "" : "s"}`);
      statusText.textContent = `${teamName} turn — ${parts.join(" · ")}`;
    } else {
      statusText.textContent = `${teamName} turn — no shots fired`;
    }

    attackTurn = teamId === "ember" ? "tide" : "ember";
    updateAttackTurnLabel();
  }

  function startLoops() {
    stopLoops();
    moveInterval = setInterval(moveCursors, MOVE_MS);
    attackInterval = setInterval(runAttacks, ATTACK_MS);
    timerInterval = setInterval(tickMatchTimer, 250);
    updateTimerDisplay();
  }

  function stopLoops() {
    clearInterval(moveInterval);
    clearInterval(attackInterval);
    clearInterval(timerInterval);
    moveInterval = null;
    attackInterval = null;
    timerInterval = null;
  }

  function setPaused(next) {
    if (!started || winner) return;
    if (next === paused) return;

    if (next) {
      timerRemainingMs = Math.max(0, matchEndsAt - Date.now());
      stopLoops();
      paused = true;
      updateTimerDisplay();
    } else {
      matchEndsAt = Date.now() + timerRemainingMs;
      paused = false;
      startLoops();
    }

    btnPause.textContent = paused ? "Resume" : "Pause";
    statusText.textContent = paused ? "Paused" : "Scanning own territory…";
  }

  function prepareMatch() {
    stopLoops();
    placementCount = 0;
    winner = null;
    paused = false;
    started = false;
    matchStartedAt = 0;
    matchEndsAt = 0;
    timerRemainingMs = MATCH_DURATION_MS;
    inOvertime = false;
    attackTurn = "ember";
    saboteurHudUnlocked = false;
    btnPause.textContent = "Pause";
    btnPause.disabled = true;
    battlefield.classList.remove("game-over", "winner-ember", "winner-tide");
    createGrid();
    updateScores();
    updateAttackTurnLabel();
    updateTimerDisplay();
    updateHudLoadouts();
  }

  function beginMatch() {
    applyTeamNamesFromInputs();
    prepareMatch();
    hideStartScreen();
    gameoverScreen.classList.add("hidden");
    gameoverScreen.setAttribute("aria-hidden", "true");
    started = true;
    paused = false;
    matchStartedAt = Date.now();
    matchEndsAt = matchStartedAt + MATCH_DURATION_MS;
    timerRemainingMs = MATCH_DURATION_MS;
    inOvertime = false;
    btnPause.disabled = false;
    statusText.textContent = "War started — only one will survive";
    startLoops();
  }

  function returnToStart() {
    prepareMatch();
    inputEmberName.value = TEAMS.ember.name;
    inputTideName.value = TEAMS.tide.name;
    showStartScreen();
  }

  function dismissGameOver() {
    gameoverScreen.classList.add("hidden");
    gameoverScreen.setAttribute("aria-hidden", "true");
  }

  btnPause.addEventListener("click", () => setPaused(!paused));
  btnReset.addEventListener("click", returnToStart);
  btnStart.addEventListener("click", beginMatch);
  if (btnQuickStart) btnQuickStart.addEventListener("click", quickStartMatch);
  btnDismiss.addEventListener("click", dismissGameOver);

  if (inputBudget) {
    inputBudget.addEventListener("change", () => setBudget(inputBudget.value));
    inputBudget.addEventListener("input", () => setBudget(inputBudget.value));
  }

  [inputEmberName, inputTideName].forEach((input) => {
    input.addEventListener("input", () => {
      TEAMS.ember.name = sanitizeName(inputEmberName.value, "Ember");
      TEAMS.tide.name = sanitizeName(inputTideName.value, "Tide");
      updateTeamLabels();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") beginMatch();
    });
  });

  buildLoadoutUI();
  setBudget(DEFAULT_BUDGET);
  prepareMatch();
  updateTeamLabels();
  showStartScreen();
})();
