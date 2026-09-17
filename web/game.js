// game.js — net, input, HUD, galactic map. Rendering primitives live in gl.js.
"use strict";

const TEAM_NAMES = { F: "Federation", R: "Romulan", K: "Klingon", O: "Orion" };
const TEAM_CSS = { F: "#ffd54f", R: "#ef5350", K: "#66bb6a", O: "#64b5f6", I: "#9e9e9e" };
const SHIP_TYPES = ["SC", "DD", "CA", "BB", "AS", "SB", "GA"];
const GWIDTH = 100000;

const glCanvas = document.getElementById("gl");
const overlay = document.getElementById("overlay");
const mapCanvas = document.getElementById("map");
const R = new Renderer(glCanvas);

let ws = null, myId = -1;
let planets = [];              // static part from welcome; o/a updated by snaps
let prevSnap = null, curSnap = null, snapAt = 0;
let joined = false, mapOn = false;
let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
let phaserFx = [];             // {fx,fy,tx,ty,t,until}
let booms = [];                // {x,y,big,at}
let selTeam = null, selShip = "CA";

// ---------- join UI ----------
const joinDiv = document.getElementById("join");
const teamsP = document.getElementById("teams");
const shipsP = document.getElementById("ships");
const joinMsg = document.getElementById("joinMsg");
const nameInput = document.getElementById("name");
nameInput.value = localStorage.nfpName || "";

function buildJoinUI(counts) {
  if (!teamsP.childElementCount) {
    for (const tm of ["F", "R", "K", "O"]) {
      const b = document.createElement("button");
      b.className = `l7-btn l7-btn--outline btn-sm sel-${tm}`; // sel-* gated by .sel
      b.style.color = TEAM_CSS[tm]; // team colors are the game's, not the system's
      b.onclick = () => { selTeam = tm; refreshSel(); };
      b.dataset.team = tm;
      teamsP.appendChild(b);
    }
  }
  // Update in place so live counts preserve selection and keyboard focus.
  for (const b of teamsP.children) {
    const tm = b.dataset.team, n = counts ? (counts[tm] || 0) : 0;
    const label = `${TEAM_NAMES[tm]} (${n})`;
    if (b.textContent !== label) b.textContent = label;
    const ownSlot = curSnap && curSnap.you.i === myId && curSnap.you.tm === tm;
    b.disabled = n >= 32 && !ownSlot;
  }
  if (!shipsP.childElementCount) {
    for (const st of SHIP_TYPES) {
      const b = document.createElement("button");
      b.className = "l7-btn l7-btn--outline btn-sm sel-A"; // amber selection tint
      b.textContent = st;
      b.onclick = () => { selShip = st; refreshSel(); };
      b.dataset.ship = st;
      shipsP.appendChild(b);
    }
  }
  refreshSel();
}
function refreshSel() {
  for (const b of teamsP.children) b.classList.toggle("sel", b.dataset.team === selTeam);
  for (const b of shipsP.children) b.classList.toggle("sel", b.dataset.ship === selShip);
}
const botPanel = document.getElementById("botPanel");
function buildBotControls(target, inline) {
  if (target.childElementCount) return;
  const add = (label, msg, color) => {
    const b = document.createElement("button");
    b.className = "l7-btn l7-btn--outline btn-sm";
    b.textContent = label;
    if (color) b.style.color = color;
    b.onclick = () => send(msg);
    target.appendChild(b);
  };
  if (inline) {
    const lbl = document.createElement("span");
    lbl.textContent = "bots: ";
    target.appendChild(lbl);
  }
  for (const tm of ["F", "R", "K", "O"])
    add("+" + tm, { t: "addbot", team: tm }, TEAM_CSS[tm]);
  if (!inline) target.appendChild(document.createElement("br"));
  for (const tm of ["F", "R", "K", "O"])
    add("−" + tm, { t: "removebot", team: tm }, TEAM_CSS[tm]);
  if (!inline) target.appendChild(document.createElement("br"));
  add("BALANCE", { t: "balancebots" });
  add("FILL", { t: "fillbots" });
  add("CLEAR", { t: "clearbots" });
}
function buildBotUI() {
  buildBotControls(document.getElementById("bots"), true);
  buildBotControls(document.getElementById("botPanelButtons"), false);
}
// ---------- player list: 4 team columns, kills descending ----------
const playerListDiv = document.getElementById("playerList");
function togglePlayerList(show) {
  const on = show !== undefined ? show : playerListDiv.style.display !== "block";
  playerListDiv.style.display = on ? "block" : "none";
  if (on) renderPlayerList();
}
function renderPlayerList() {
  if (!curSnap) return;
  const byTeam = { F: [], R: [], K: [], O: [] };
  for (const p of curSnap.players) byTeam[p.tm]?.push(p);
  playerListDiv.textContent = "";
  const cols = document.createElement("div");
  cols.className = "cols";
  for (const [tm, label] of [["F", "Federation"], ["R", "Romulan"],
                             ["K", "Klingon"], ["O", "Orion"]]) {
    const col = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = label;
    h.style.color = TEAM_CSS[tm];
    col.appendChild(h);
    for (const p of byTeam[tm].sort((a, b) => (b.ki || 0) - (a.ki || 0) || a.i - b.i)) {
      const row = document.createElement("div");
      row.className = "row" + (p.st === "dead" ? " dead" : "");
      row.style.color = TEAM_CSS[tm];
      row.textContent = `${String(p.i).padStart(3)}  ${p.nm.padEnd(16).slice(0, 16)} ` +
                        `${(p.ki || 0).toFixed(2).padStart(6)}`;
      col.appendChild(row);
    }
    cols.appendChild(col);
  }
  playerListDiv.appendChild(cols);
}

function toggleBotPanel(show) {
  const on = show !== undefined ? show : botPanel.style.display !== "block";
  botPanel.style.display = on ? "block" : "none";
}

document.getElementById("go").onclick = tryJoin;
nameInput.onkeydown = e => { if (e.key === "Enter") tryJoin(); e.stopPropagation(); };
function tryJoin() {
  const name = nameInput.value.trim() || "guest";
  if (!selTeam) { joinMsg.textContent = "pick a team"; return; }
  localStorage.nfpName = name;
  send({ t: "join", name, team: selTeam, ship: selShip });
}

// ---------- net ----------
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

function connect() {
  // resolve relative to the page so a reverse proxy can mount us under a
  // subpath (e.g. caddy handle_path /netrek3d/*)
  const base = location.pathname.endsWith("/")
    ? location.pathname : location.pathname.replace(/[^/]*$/, "");
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") +
    location.host + base + "ws");
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => {
    myId = -1; // the disconnected socket no longer reserves a team slot
    joined = false; setMapOpen(false); joinDiv.style.display = "flex";
    joinMsg.textContent = "disconnected — retrying...";
    setTimeout(connect, 2000);
  };
}

function handle(m) {
  switch (m.t) {
    case "welcome":
      planets = m.planets;
      buildJoinUI(m.counts);
      break;
    case "lobby":
      if (!joined) buildJoinUI(m.counts);
      break;
    case "joined":
      myId = m.id;
      joined = true;
      joinDiv.style.display = "none";
      joinMsg.textContent = "";
      break;
    case "deny":
      joinMsg.textContent = m.reason;
      break;
    case "events":
      handleEvents(m, performance.now());
      break;
    case "snap": {
      prevSnap = curSnap; curSnap = m; snapAt = performance.now();
      for (const p of m.planets) {
        const pl = planets[p.n]; pl.o = p.o; pl.a = p.a; pl.f = p.f;
      }
      // Accept legacy snapshots that still carry transient effects.
      handleEvents(m, snapAt);
      if (playerListDiv.style.display === "block") renderPlayerList();
      if (m.you.st === "dead" && joined) {
        joined = false;
        setMapOpen(false);
        joinDiv.style.display = "flex";
        joinMsg.textContent = "ship destroyed";
      } else if (m.you.st === "alive" && !joined) {
        // self-heal if the joined reply was lost: the server thinks we fly
        myId = m.you.i;
        joined = true;
        joinDiv.style.display = "none";
      }
      if (!joined) buildJoinUI(m.counts);
      break;
    }
  }
}

function handleEvents(m, at) {
  for (const ph of m.phasers || [])
    phaserFx.push({ ...ph, until: at + 300 });
  for (const b of m.booms || [])
    booms.push({ ...b, at });
  for (const txt of m.msgs || []) logMsg(txt);
  for (const c of m.chats || []) logChat(c);
}

// ---------- chat: ALL and TEAM logs on the right, one input box ----------
const chatBox = document.getElementById("chatBox");
const chatBoxLabel = document.getElementById("chatBoxLabel");
const chatInput = document.getElementById("chatInput");
let chatTo = "team";

function openChat(to) {
  chatTo = to;
  chatBoxLabel.textContent = to.toUpperCase();
  chatBox.style.display = "flex";
  chatInput.value = "";
  chatInput.focus();
}
function closeChat() {
  chatBox.style.display = "none";
  chatInput.blur();
}
chatInput.addEventListener("keydown", e => {
  e.stopPropagation();
  if (e.key === "Enter") {
    const text = chatInput.value.trim();
    if (text) send({ t: "chat", to: chatTo, text });
    closeChat();
  } else if (e.key === "Escape") {
    closeChat();
  }
});

function logChat(c) {
  const log = document.getElementById(c.to === "team" ? "chatTeamLog" : "chatAllLog");
  const d = document.createElement("div");
  const who = document.createElement("span");
  who.textContent = c.fm + ": ";
  who.style.color = TEAM_CSS[c.tm] || TEAM_CSS.I;
  d.appendChild(who);
  d.appendChild(document.createTextNode(c.tx));
  log.appendChild(d);
  while (log.childElementCount > 7) log.firstChild.remove();
  setTimeout(() => { d.style.transition = "opacity 1s"; d.style.opacity = 0; }, 14000);
}

// ---------- messages ----------
const msgsDiv = document.getElementById("msgs");
function logMsg(text) {
  const d = document.createElement("div");
  d.textContent = text;
  msgsDiv.appendChild(d);
  while (msgsDiv.childElementCount > 7) msgsDiv.firstChild.remove();
  setTimeout(() => { d.style.transition = "opacity 1s"; d.style.opacity = 0; }, 9000);
}

// ---------- input ----------
function bearingFromScreen(mx, my, you) {
  const tanF = Math.tan(65 * Math.PI / 360);
  const rx = ((mx / innerWidth) * 2 - 1) * tanF * innerWidth / innerHeight;
  const up = (1 - (my / innerHeight) * 2) * tanF;
  const c = Math.cos(you.d), n = Math.sin(you.d);
  const cp = Math.cos(you.pitch), sp = Math.sin(you.pitch);
  const x = c*cp - rx*n - up*c*sp;
  const y = n*cp + rx*c - up*n*sp;
  const z = sp + up*cp;
  return { d: Math.atan2(y, x), pitch: Math.atan2(z, Math.hypot(x, y)) };
}

addEventListener("mousemove", e => { mouse.x = e.clientX; mouse.y = e.clientY; });
addEventListener("contextmenu", e => e.preventDefault());
glCanvas.addEventListener("mousedown", e => {
  if (!joined || !curSnap) return;
  const you = interpYou();
  const d = bearingFromScreen(e.clientX, e.clientY, you);
  if (mapOn) return;
  if (e.button === 0) send({ t: "torp", ...d });
  else if (e.button === 1) { send({ t: "phaser", ...d }); e.preventDefault(); }
  else if (e.button === 2) send({ t: "course", ...d });
});

addEventListener("keydown", e => {
  if (!joined) return;
  if (mapOn) { galaxyMap.key(e); return; }
  if (document.activeElement === chatInput) return; // typing a message
  if (e.key === "Enter") { openChat(e.shiftKey ? "all" : "team"); e.preventDefault(); return; }
  if (e.key >= "0" && e.key <= "9") { send({ t: "speed", v: +e.key }); return; }
  const you = curSnap ? interpYou() : null;
  // some input paths deliver shift+letter as the lowercase key with the
  // shift modifier set; derive the logical key instead of trusting e.key
  const key = e.shiftKey && e.key.length === 1 ? e.key.toUpperCase() : e.key;
  switch (key) {
    case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight":
      if (you) send({ t: "course", d: you.d + (key === "ArrowRight" ? 0.2 : key === "ArrowLeft" ? -0.2 : 0),
        pitch: Math.max(-Math.PI/2, Math.min(Math.PI/2, you.pitch + (key === "ArrowUp" ? 0.2 : key === "ArrowDown" ? -0.2 : 0))) });
      e.preventDefault(); break;
    case "h": if (you) send({ t: "course", d: you.d, pitch: 0 }); break;
    case "=": send({ t: "speed", v: 99 }); break; // server clamps to maxspeed
    case "s": send({ t: "shields" }); break;
    case "t": if (you) send({ t: "torp", ...bearingFromScreen(mouse.x, mouse.y, you) }); break;
    case "f": if (you) send({ t: "phaser", ...bearingFromScreen(mouse.x, mouse.y, you) }); break;
    case "p": togglePlayerList(); break;
    case "o": send({ t: "orbit" }); break;
    case "b": send({ t: "bomb" }); break;
    case "z": send({ t: "beamup" }); break;
    case "x": send({ t: "beamdown" }); break;
    case "R": send({ t: "repair" }); break;
    case "c": send({ t: "cloak" }); break;
    case "d": send({ t: "det" }); break;
    case "l": { // cockpit lock: planet under the reticle
      if (!curSnap) break;
      const y2 = interpYou();
      let best = -1, bd = 80; // screen px
      for (const pl of planets) {
        if (Math.hypot(pl.x - y2.x, pl.y - y2.y, pl.z - y2.z) > 30000) continue;
        const s = R.project(pl.x, pl.z, pl.y);
        if (!s) continue;
        const d = Math.hypot(s[0] - mouse.x, s[1] - mouse.y);
        if (d < bd) { bd = d; best = pl.n; }
      }
      if (best >= 0) send({ t: "lock", v: best });
      break;
    }
    case "m": setMapOpen(!mapOn); break;
    case "\\": toggleBotPanel(); break;
    case "Q": send({ t: "selfdestruct" }); break;
    case "Escape":
      if (botPanel.style.display === "block") { toggleBotPanel(false); break; }
      send({ t: "quit" });
      break;
  }
});

// ---------- interpolation ----------
function lerp(a, b, f) { return a + (b - a) * f; }
function lerpAngle(a, b, f) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * f;
}
function interpFrac() {
  return Math.min(1, (performance.now() - snapAt) / 100);
}
function interpYou() {
  const y = curSnap.you;
  if (!prevSnap || prevSnap.you.st !== "alive") return y;
  const f = interpFrac(), p = prevSnap.you;
  return { ...y, x: lerp(p.x, y.x, f), y: lerp(p.y, y.y, f), z: lerp(p.z, y.z, f), pitch: lerp(p.pitch, y.pitch, f), d: lerpAngle(p.d, y.d, f) };
}
function interpList(cur, prev, f) {
  const prevById = {};
  if (prev) for (const p of prev) prevById[p.i] = p;
  return cur.map(c => {
    const p = prevById[c.i];
    if (!p) return c;
    // never interpolate across a respawn or teleport: a dead ship parked at
    // its death site would streak ~35k units to the homeworld in one snap
    if (p.st !== c.st || Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) > 2000) return c;
    return { ...c, x: lerp(p.x, c.x, f), y: lerp(p.y, c.y, f), z: lerp(p.z, c.z, f),
             pitch: c.pitch !== undefined ? lerp(p.pitch, c.pitch, f) : undefined,
             d: c.d !== undefined ? lerpAngle(p.d, c.d, f) : undefined };
  });
}

// ---------- HUD ----------
const hudLeft = document.getElementById("hudLeft");
const hudTop = document.getElementById("hudTop");
const alertDiv = document.getElementById("alert");

function bar(label, val, max, warnHigh, color, text) {
  const pct = Math.max(0, Math.min(100, val / max * 100));
  const bad = warnHigh ? pct > 70 : pct < 30;
  const col = color || (bad ? "var(--danger)" : "var(--green)");
  return `${label} <span class="bar"><i style="width:${pct}%;background:${col}"></i></span>` +
         ` ${text !== undefined ? text : Math.round(val)}<br>`;
}

function updateHUD(you, players) {
  const compass = ((you.d * 180 / Math.PI + 90) % 360 + 360) % 360;
  hudLeft.innerHTML =
    `Z ${Math.round(you.z)} &nbsp; PITCH ${Math.round(you.pitch * 180 / Math.PI)}&deg;<br>` +
    bar("WARP", you.sp, you.maxsp, false, "var(--amber)", `${you.sp}/${you.maxsp}`) +
    bar("SHLD", you.sh, you.maxsh) +
    bar("HULL", you.maxdm - you.dm, you.maxdm) +
    bar("FUEL", you.fu, you.maxfu) +
    bar("WTMP", you.wt, you.maxwt, true) +
    bar("ETMP", you.et, you.maxet, true) +
    `HDG ${compass.toFixed(0)}&deg; &nbsp; TORPS ${you.tp} &nbsp; ARMIES ${you.ar} &nbsp; KILLS ${you.ki.toFixed(2)}` +
    (you.shup ? " &nbsp; [SHIELDS]" : "") + (you.cl ? " [CLOAK]" : "") +
    (you.rep ? " [REPAIR]" : "") + (you.bmb ? " [BOMBING]" : "");

  let top = curSnap.tmode.on
    ? `T-MODE &nbsp; ${fmtTime(curSnap.tmode.left)}` : "pickup (need 4v4 for T-mode)";
  if (curSnap.tmode.on) {
    const counts = {};
    for (const pl of planets) counts[pl.o] = (counts[pl.o] || 0) + 1;
    top += "<br>" + [["FED", "F"], ["ROM", "R"], ["KLI", "K"], ["ORI", "O"], ["IND", "I"]]
      .map(([nm, l]) =>
        `<span style="color:${TEAM_CSS[l]}">${nm}: ${counts[l] || 0}</span>`)
      .join(", ");
  }
  if (you.lk >= 0)
    top += `<br><span style="color:var(--amber)">LOCKED &rarr; ${planets[you.lk].name}</span>`;
  if (you.sd > 0)
    top = `<span style="color:var(--danger);font-weight:bold">SELF DESTRUCT IN ${you.sd}</span><br>` + top;
  if (you.orb >= 0) {
    const pl = planets[you.orb];
    const fl = (pl.f & 8 ? "HOME " : "") + (pl.f & 1 ? "REPAIR " : "") +
               (pl.f & 2 ? "FUEL " : "") + (pl.f & 4 ? "AGRI" : "");
    top += `<br>orbiting <span class="${pl.o}">${pl.name}</span> — ` +
           `${pl.a} armies ${fl ? "(" + fl.trim() + ")" : ""}`;
  }
  hudTop.innerHTML = top;
  // keep the combat log below however many status rows are showing
  msgsDiv.style.top = hudTop.offsetTop + hudTop.offsetHeight + 8 + "px";

  let nearest = 1e9;
  for (const p of players) {
    if (p.i === myId || p.tm === you.tm || p.st !== "alive") continue;
    nearest = Math.min(nearest, Math.hypot(p.x - you.x, p.y - you.y, p.z - you.z));
  }
  const [txt, col] = nearest < 7000 ? ["RED ALERT", "var(--danger)"] :
    nearest < 15000 ? ["YELLOW ALERT", "var(--amber)"] : ["CONDITION GREEN", "var(--green)"];
  alertDiv.textContent = txt;
  alertDiv.style.color = col;
}
function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// ---------- galactic map ----------
const galaxyMap = new GalaxyMap(mapCanvas, document.getElementById("galaxyUI"),
  id => send({ t: "lock", v: id }), () => setMapOpen(false));
function setMapOpen(open) {
  mapOn = open;
  galaxyMap.setOpen(open, planets);
  if (!open) document.activeElement?.blur();
}
function fit2d(c) {
  const dpr = devicePixelRatio || 1;
  const w = innerWidth * dpr, h = innerHeight * dpr;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  return ctx;
}

// ---------- overlay (labels + reticle) ----------
function drawOverlay(labels, you, players) {
  const ctx = fit2d(overlay);
  ctx.font = "12px Consolas, monospace";
  ctx.textAlign = "center";
  for (const l of labels) {
    ctx.globalAlpha = l.alpha;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, l.y);
  }
  ctx.globalAlpha = 1;
  // reticle
  ctx.strokeStyle = "#b0bec5";
  ctx.beginPath();
  ctx.moveTo(mouse.x - 10, mouse.y); ctx.lineTo(mouse.x - 3, mouse.y);
  ctx.moveTo(mouse.x + 3, mouse.y); ctx.lineTo(mouse.x + 10, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 10); ctx.lineTo(mouse.x, mouse.y - 3);
  ctx.moveTo(mouse.x, mouse.y + 3); ctx.lineTo(mouse.x, mouse.y + 10);
  ctx.stroke();
  // course marker: where the ship is heading
  const ahead = R.project(you.x + Math.cos(you.d)*Math.cos(you.pitch)*8000, you.z + Math.sin(you.pitch)*8000, you.y + Math.sin(you.d)*Math.cos(you.pitch)*8000);
  if (ahead) {
    ctx.strokeStyle = "#546e7a";
    ctx.strokeRect(ahead[0] - 4, ahead[1] - 4, 8, 8);
  }
  drawSpatialRadar(ctx, you, players, planets, TEAM_CSS, innerWidth);
}

// ---------- main loop ----------
function frame() {
  requestAnimationFrame(frame);
  if (!curSnap) return;
  const you = interpYou();
  const f = interpFrac();
  const players = interpList(curSnap.players, prevSnap && prevSnap.players, f);
  const torps = interpList(curSnap.torps, prevSnap && prevSnap.torps, f);
  const now = performance.now();

  // explosions emit light: nearest four active booms become point lights,
  // radius and intensity scaled by blast class (torp 0.35 ... starbase 2.0)
  booms = booms.filter(b => now - b.at < 700);
  const lights = booms.map(b => {
    const age = (now - b.at) / 700;
    return { x: b.x, y: b.y, z: b.z, r: Math.max(2500, 6000 * b.s),
             i: (1 - age) * (0.9 + 0.9 * b.s),
             d2: (b.x - you.x) ** 2 + (b.y - you.y) ** 2 + (b.z - you.z) ** 2 };
  }).sort((a, b) => a.d2 - b.d2);

  R.begin(you.x, you.y, you.d, lights, you.z, you.pitch);
  const labels = [];

  for (const pl of planets) {
    const dist = Math.hypot(pl.x - you.x, pl.y - you.y, pl.z - you.z);
    const alpha = R.drawPlanet(pl.x, pl.y, pl.o, dist, pl.z);
    if (alpha > 0.05 && dist < 20000) {
      const s = R.project(pl.x, pl.z + 700, pl.y);
      if (s) labels.push({ x: s[0], y: s[1] - 8, text: `${pl.name} ${pl.a}`,
                           color: TEAM_CSS[pl.o] || TEAM_CSS.I, alpha });
      const sb = R.project(pl.x, pl.z - 700, pl.y); // range below, same rules as the name
      if (sb) labels.push({ x: sb[0], y: sb[1] + 14, text: `${Math.round(dist)}`,
                            color: TEAM_CSS[pl.o] || TEAM_CSS.I, alpha });
    }
  }
  for (const p of players) {
    if (p.i === myId || p.st !== "alive") continue;
    const dist = Math.hypot(p.x - you.x, p.y - you.y, p.z - you.z);
    const alpha = R.drawShip(p.x, p.y, p.d, p.tm, dist, !!p.cl, p.z, p.pitch);
    if (alpha > 0.05 && dist < 9000) {
      const s = R.project(p.x, p.z + 260, p.y);
      if (s) labels.push({ x: s[0], y: s[1] - 6, text: `${p.nm} (${p.s})`,
                           color: TEAM_CSS[p.tm], alpha });
      const sb = R.project(p.x, p.z - 260, p.y); // range below, same rules as the name
      if (sb) labels.push({ x: sb[0], y: sb[1] + 12, text: `${Math.round(dist)}`,
                            color: TEAM_CSS[p.tm], alpha });
    }
  }
  for (const tp of torps) {
    const dist = Math.hypot(tp.x - you.x, tp.y - you.y, tp.z - you.z);
    R.drawTorp(tp.x, tp.y, tp.tm, dist, tp.z);
  }
  phaserFx = phaserFx.filter(ph => ph.until > now);
  for (const ph of phaserFx)
    R.drawPhaser(ph.fx, ph.fy, ph.tx, ph.ty, ph.tm, (ph.until - now) / 300, ph.fz, ph.tz);
  for (const b of booms)
    R.drawExplosion(b.x, b.y, (now - b.at) / 700, b.s, b.z);
  R.finish();

  if (mapOn) {
    fit2d(overlay); // hide 3D labels/reticle under the map
    galaxyMap.draw(fit2d(mapCanvas), you, players, planets, TEAM_CSS, innerWidth, innerHeight);
  } else {
    drawOverlay(labels, you, players);
  }
  updateHUD(curSnap.you, curSnap.players);
}

buildJoinUI(null);
buildBotUI();
connect();
requestAnimationFrame(frame);
