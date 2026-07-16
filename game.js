(() => {
  const COLS = 12;
  const ROWS = 12;
  const MOVE_MS = 400;
  const ATTACK_MS = 1800;
  const PLACE_CHANCE = 0.2;
  /** How many cells of the enemy back row you need to own to win */
  const BACK_ROW_TO_WIN = 1;
  /** For this long after kickoff, cursors cannot overwrite occupied tiles */
  const NO_OVERWRITE_MS = 60_000;

  const TEAMS = {
    ember: {
      id: "ember",
      name: "Ember",
      logId: "ember-log",
      cellsId: "ember-cells",
      /** Tide's home edge — Ember wins by capturing this column */
      targetBackC: COLS - 1,
      startC: 0,
      startDc: 1,
    },
    tide: {
      id: "tide",
      name: "Tide",
      logId: "tide-log",
      cellsId: "tide-cells",
      /** Ember's home edge — Tide wins by capturing this column */
      targetBackC: 0,
      startC: COLS - 1,
      startDc: -1,
    },
  };

  const WEAPONS = {
    // method: area (Strike) | diagonal (Breach) | forward (Artillery)
    offensive: [
      { id: "strike", label: "Strike", symbol: "🗡️", power: 4, multiplier: 1, method: "area", range: 2 },
      { id: "breach", label: "Breach", symbol: "💥", power: 8, multiplier: 0.45, method: "diagonal" },
      { id: "artillery", label: "Artillery", symbol: "🚀", power: 2, multiplier: 0.9, method: "forward" },
    ],
    defensive: [
      { id: "barricade", label: "Barricade", symbol: "🧱", armor: 18 },
      { id: "bunker", label: "Bunker", symbol: "🛡️", armor: 32 },
      { id: "fortify", label: "Fortify", symbol: "🏰", armor: 48 },
    ],
  };

  const DIAGONAL_DIRS = [
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  const battlefield = document.getElementById("battlefield");
  const statusText = document.getElementById("status-text");
  const placementCountEl = document.getElementById("placement-count");
  const btnPause = document.getElementById("btn-pause");
  const btnReset = document.getElementById("btn-reset");
  const btnStart = document.getElementById("btn-start");
  const btnDismiss = document.getElementById("btn-dismiss");
  const startScreen = document.getElementById("start-screen");
  const gameoverScreen = document.getElementById("gameover-screen");
  const gameoverMessage = document.getElementById("gameover-message");
  const inputEmberName = document.getElementById("input-ember-name");
  const inputTideName = document.getElementById("input-tide-name");

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
  let moveInterval = null;
  let attackInterval = null;

  const attackTurnLabel = document.getElementById("attack-turn-label");

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
    document.getElementById("ember-goal-label").textContent = `${TEAMS.ember.name} wants right edge`;
    document.getElementById("tide-goal-label").textContent = `${TEAMS.tide.name} wants left edge`;
    updateAttackTurnLabel();
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
    statusText.textContent = "Name your teams, then start the war";
  }

  function hideStartScreen() {
    startScreen.classList.add("hidden");
    startScreen.setAttribute("aria-hidden", "true");
  }

  function showGameOverScreen(message) {
    gameoverMessage.textContent = message;
    gameoverScreen.classList.remove("hidden");
    gameoverScreen.setAttribute("aria-hidden", "false");
    hideStartScreen();
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

  function paintCell(cell) {
    cell.el.classList.remove("ember", "tide");
    cell.el.classList.add(cell.owner);

    const existing = cell.el.querySelector(".weapon");
    if (existing) existing.remove();

    if (cell.weapon) {
      const w = document.createElement("span");
      w.className = `weapon ${cell.weapon.kind}`;
      w.textContent = cell.weapon.symbol;
      w.title = cell.weapon.kind === "defensive"
        ? `${cell.weapon.label} · armor ${cell.armor}`
        : `${cell.weapon.label} · power ${cell.weapon.power} · mult ${cell.weapon.multiplier}`;
      cell.el.appendChild(w);
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

  function updateScores() {
    let ember = 0;
    let tide = 0;
    for (const cell of cells) {
      if (cell.owner === "ember") ember++;
      if (cell.owner === "tide") tide++;
    }
    document.getElementById("ember-cells").textContent = String(ember);
    document.getElementById("tide-cells").textContent = String(tide);
    placementCountEl.textContent = `${placementCount} placement${placementCount === 1 ? "" : "s"}`;
  }

  function logEvent(teamId, message) {
    const list = document.getElementById(TEAMS[teamId].logId);
    const li = document.createElement("li");
    li.textContent = message;
    li.classList.add("fresh");
    list.prepend(li);
    while (list.children.length > 6) list.removeChild(list.lastChild);
    setTimeout(() => li.classList.remove("fresh"), 900);
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

  function declareWinner(teamId) {
    winner = teamId;
    started = false;
    stopLoops();
    paused = true;
    btnPause.textContent = "Resume";
    btnPause.disabled = true;
    const held = backRowHeld(teamId);
    const message = `${TEAMS[teamId].name} holds the enemy back row (${held}) — victory!`;
    statusText.textContent = message;
    logEvent(teamId, "Took the enemy back row!");
    battlefield.classList.add("game-over", `winner-${teamId}`);
    showGameOverScreen(message);
  }

  function checkWin() {
    const emberHeld = backRowHeld("ember");
    const tideHeld = backRowHeld("tide");
    const emberWins = emberHeld >= BACK_ROW_TO_WIN;
    const tideWins = tideHeld >= BACK_ROW_TO_WIN;

    if (emberWins && tideWins) {
      winner = "tie";
      started = false;
      stopLoops();
      paused = true;
      btnPause.disabled = true;
      const message = "Dead heat — both hold the enemy back row!";
      statusText.textContent = message;
      battlefield.classList.add("game-over");
      showGameOverScreen(message);
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
    if (Math.random() >= PLACE_CHANCE) return null;

    const cursor = cursors[teamId];
    const cell = cells[idx(cursor.r, cursor.c)];
    if (cell.owner !== teamId) return null;

    // First minute: cannot overwrite an existing unit
    const inOpening = started && Date.now() - matchStartedAt < NO_OVERWRITE_MS;
    if (inOpening && cell.weapon) return null;

    const kind = Math.random() < 0.55 ? "offensive" : "defensive";
    const blueprint = pick(WEAPONS[kind]);

    cell.weapon = { ...blueprint, kind, team: teamId };
    cell.armor = kind === "defensive" ? blueprint.armor : 0;
    paintCell(cell);
    cell.el.classList.add("flash-capture");
    setTimeout(() => cell.el.classList.remove("flash-capture"), 550);

    placementCount += 1;
    logEvent(teamId, `Placed ${blueprint.label} at ${cursor.r + 1},${cursor.c + 1}`);
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
   * Artillery — straight horizontal toward the enemy end only
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

  /** Power falls off with travel distance; higher multiplier keeps more punch at range. */
  /** Power falls off with travel distance; kept as a float (not rounded down). */
  function attackPower(weapon, distance) {
    return weapon.power * Math.pow(weapon.multiplier, Math.max(0, distance - 1));
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
        paintCell(cell);
        return false;
      }

      cell.weapon = null;
      cell.armor = 0;
      paintCell(cell);
    }

    if (power < 1) return false;

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

    const targetCol = TEAMS[attackerTeam].targetBackC;

    // Prefer closer targets, then ones nearer the enemy back row
    const minDist = Math.min(...targets.map((t) => t.distance));
    let pool = targets.filter((t) => t.distance === minDist);
    const bestBack = Math.min(...pool.map((t) => Math.abs(t.c - targetCol)));
    pool = pool.filter((t) => Math.abs(t.c - targetCol) === bestBack);

    const chosen = pick(pool);
    return hitEnemyCell(attackerTeam, weapon, chosen.cell, chosen.distance) ? 1 : 0;
  }

  /**
   * Push along a ray through enemy land while power remains.
   * Arrival power already has distance multipliers applied.
   * Armour spends from that remaining power; each capture costs 1.
   * Moving one square deeper multiplies remaining power by the weapon multiplier again.
   */
  function resolveAttackPush(attackerTeam, weapon, hit) {
    let power = attackPower(weapon, hit.distance);
    let r = hit.r;
    let c = hit.c;
    let distance = hit.distance;
    let captures = 0;

    if (power <= 0) {
      logEvent(attackerTeam, `${weapon.label} fizzled at range ${distance}`);
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
          paintCell(cell);
          logEvent(attackerTeam, `${weapon.label} −${blocked} armor (d${distance}, ${cell.armor} left)`);
          break;
        }

        cell.weapon = null;
        cell.armor = 0;
        paintCell(cell);
        logEvent(attackerTeam, `${weapon.label} breached defense (d${distance})`);
      }

      // Capture costs 1 from whatever power is left after multipliers + armour
      if (power < 1) {
        logEvent(attackerTeam, `${weapon.label} spent — couldn't take ${r + 1},${c + 1}`);
        break;
      }

      power -= 1;
      cell.owner = attackerTeam;
      cell.weapon = null;
      cell.armor = 0;
      paintCell(cell);
      cell.el.classList.add("flash-capture");
      setTimeout(() => cell.el.classList.remove("flash-capture"), 550);
      captures += 1;

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

  function pickAttackTarget(teamId, hits, weapon) {
    if (!hits.length) return null;

    const targetCol = TEAMS[teamId].targetBackC;

    // Artillery always prioritises the enemy back row when any ray can reach it
    if (weapon.method === "forward") {
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
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
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
    let volleys = 0;

    for (const { r, c, cell } of attackers) {
      const weapon = cell.weapon;
      const wEl = cell.el.querySelector(".weapon");
      let gained = 0;

      if (weapon.method === "area") {
        const range = weapon.range || 2;
        if (!hasEnemyInRange(cell.owner, r, c, range)) continue;

        if (wEl) {
          wEl.classList.add("firing");
          setTimeout(() => wEl.classList.remove("firing"), 400);
        }

        gained = resolveStrikeAttack(cell.owner, weapon, r, c);
        volleys += 1;
      } else {
        const hits = traceAttackPaths(cell.owner, r, c, weapon);
        const chosen = pickAttackTarget(cell.owner, hits, weapon);
        if (!chosen) continue;

        if (wEl) {
          wEl.classList.add("firing");
          setTimeout(() => wEl.classList.remove("firing"), 400);
        }

        volleys += 1;
        gained = resolveAttackPush(cell.owner, weapon, chosen);
      }

      captures += gained;
      if (gained > 0) {
        logEvent(cell.owner, `${weapon.label} took ${gained} cell${gained === 1 ? "" : "s"}`);
      } else if (weapon.method === "area") {
        logEvent(cell.owner, `${weapon.label} hit nearby defences`);
      }
    }

    settleOnOwn("ember");
    settleOnOwn("tide");
    updateCursorClass();
    updateScores();

    if (checkWin()) return;

    const teamName = TEAMS[teamId].name;
    if (volleys) {
      statusText.textContent = `${teamName} turn — ${volleys} attack${volleys === 1 ? "" : "s"} · ${captures} capture${captures === 1 ? "" : "s"}`;
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
  }

  function stopLoops() {
    clearInterval(moveInterval);
    clearInterval(attackInterval);
    moveInterval = null;
    attackInterval = null;
  }

  function setPaused(next) {
    if (!started || winner) return;
    paused = next;
    btnPause.textContent = paused ? "Resume" : "Pause";
    statusText.textContent = paused ? "Paused" : "Scanning own territory…";
    if (!paused) startLoops();
    else stopLoops();
  }

  function prepareMatch() {
    stopLoops();
    document.getElementById("ember-log").innerHTML = "";
    document.getElementById("tide-log").innerHTML = "";
    placementCount = 0;
    winner = null;
    paused = false;
    started = false;
    matchStartedAt = 0;
    attackTurn = "ember";
    btnPause.textContent = "Pause";
    btnPause.disabled = true;
    battlefield.classList.remove("game-over", "winner-ember", "winner-tide");
    createGrid();
    updateScores();
    updateAttackTurnLabel();
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
    btnPause.disabled = false;
    statusText.textContent = "War started — take the enemy back row";
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
  btnDismiss.addEventListener("click", dismissGameOver);

  [inputEmberName, inputTideName].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") beginMatch();
    });
  });

  prepareMatch();
  updateTeamLabels();
  showStartScreen();
})();
