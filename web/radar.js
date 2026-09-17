// Heading-up local radar. Galactic Z stays vertical regardless of ship pitch.
// Orthographic projection preserves scale; contacts use a spherical range limit.
"use strict";

const RADAR_RANGE = 20000;
const RADAR_TILT = 32 * Math.PI / 180;

function radarProject(dx, dy, dz, yaw) {
  const right = -Math.sin(yaw) * dx + Math.cos(yaw) * dy;
  const forward = Math.cos(yaw) * dx + Math.sin(yaw) * dy;
  return {
    x: right,
    y: -forward * Math.sin(RADAR_TILT) - dz * Math.cos(RADAR_TILT),
    depth: -forward * Math.cos(RADAR_TILT) + dz * Math.sin(RADAR_TILT),
  };
}

function radarContacts(you, players, planets) {
  const contacts = [];
  const append = (object, kind, team, locked = false) => {
    const dx = object.x - you.x, dy = object.y - you.y, dz = object.z - you.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance > RADAR_RANGE) return;
    contacts.push({ object, kind, team, locked, distance, dz,
      point: radarProject(dx, dy, dz, you.d),
      base: radarProject(dx, dy, 0, you.d),
      threat: kind === "ship" && team !== you.tm && distance <= 8000,
    });
  };
  for (const planet of planets) append(planet, "planet", planet.o, planet.n === you.lk);
  for (const ship of players) {
    if (ship.i === you.i || ship.st !== "alive" || (ship.cl && ship.tm !== you.tm)) continue;
    append(ship, "ship", ship.tm);
  }
  return contacts.sort((a, b) => a.point.depth - b.point.depth);
}

function radarAltitude(z) {
  // Avoid misleading "+0.0k" for small negative differences.
  const rounded = Math.round(z / 100) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}k`;
}

function radarLayout(width) {
  // Keep in sync with --radar-size in index.html.
  const size = Math.min(240, Math.max(180, width * 0.28));
  return { size, x: width - size - 12, y: 10, radius: size / 2 - 24 };
}

// Try both sides and vertical offsets; omit optional text rather than cover a blip.
function radarLabelBox(x, y, width, size, occupied) {
  const height = 14, pad = 3;
  for (const dy of [-18, 5, -34, 21]) {
    for (const left of [x + 10, x - width - 10]) {
      const box = { x: left, y: y + dy, w: width, h: height };
      if (box.x < 6 || box.x + box.w > size - 6 || box.y < 32 || box.y + height > size - 28) continue;
      if (occupied.some(b => box.x < b.x + b.w + pad && box.x + box.w + pad > b.x &&
        box.y < b.y + b.h + pad && box.y + box.h + pad > b.y)) continue;
      return box;
    }
  }
  return null;
}

function drawSpatialRadar(ctx, you, players, planets, colors, width) {
  const layout = radarLayout(width), S = layout.size;
  const center = S / 2, scale = layout.radius / RADAR_RANGE;
  const contacts = radarContacts(you, players, planets);
  const screen = p => ({ x: center + p.x * scale, y: center + p.y * scale });
  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  ctx.save();
  ctx.translate(layout.x, layout.y);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(8,9,7,0.82)";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "#3f4038";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, S, S);
  ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
  ctx.font = "11px Consolas, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = "#b0bec5";
  ctx.fillText("3D RADAR", 9, 14);
  ctx.textAlign = "right"; ctx.fillText("20k", S - 9, 14);
  ctx.textAlign = "center"; ctx.fillStyle = "#90a4ae";
  ctx.fillText("FWD", center, 29);

  // Camera-aligned reference disc and a vertical meridian outline the sphere.
  const ring = (r, vertical) => {
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = i * Math.PI / 32;
      const right = Math.cos(a) * r;
      const forward = vertical ? 0 : Math.sin(a) * r;
      const z = vertical ? Math.sin(a) * r : 0;
      const x = center + right * scale;
      const y = center - (forward * Math.sin(RADAR_TILT) + z * Math.cos(RADAR_TILT)) * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.strokeStyle = "#29312e"; ring(RADAR_RANGE, true); ctx.stroke();
  ring(RADAR_RANGE, false);
  ctx.fillStyle = "rgba(144,164,174,0.055)"; ctx.fill();
  ctx.strokeStyle = "#45534c"; ctx.stroke();
  ctx.strokeStyle = "#29312e"; ring(RADAR_RANGE / 2, false); ctx.stroke();
  line({x: center - layout.radius, y: center}, {x: center + layout.radius, y: center});
  const halfY = layout.radius * Math.sin(RADAR_TILT);
  line({x: center, y: center - halfY}, {x: center, y: center + halfY});

  // Stems first, then depth-sorted glyphs, so stems never obscure contact symbols.
  for (const c of contacts) {
    const p = screen(c.point), base = screen(c.base);
    ctx.globalAlpha = c.object.cl ? 0.25 : 0.65;
    ctx.strokeStyle = colors[c.team] || colors.I;
    ctx.setLineDash(c.dz < 0 ? [3, 3] : []);
    line(base, p);
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(base.x, base.y, 2, 0, 2 * Math.PI); ctx.stroke();
  }
  const occupied = [
    { x: center - 12, y: center - 18, w: 24, h: 35 },
    { x: center - 15, y: 23, w: 30, h: 13 }, // FWD label
  ];
  for (const c of contacts) {
    const p = screen(c.point);
    occupied.push({x: p.x - 7, y: p.y - 7, w: 14, h: 14});
    ctx.globalAlpha = c.object.cl ? 0.4 : 1;
    ctx.fillStyle = ctx.strokeStyle = colors[c.team] || colors.I;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (c.kind === "planet") {
      ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI); ctx.stroke();
    } else {
      ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 4, p.y);
      ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 4, p.y); ctx.closePath(); ctx.fill();
    }
    if (c.locked) {
      ctx.strokeStyle = "#ffb74d";
      ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI); ctx.stroke();
    }
  }

  // Fixed heading marker plus a nose vector: pitching never tumbles the radar.
  ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
  ctx.fillStyle = ctx.strokeStyle = "#eceff1";
  ctx.beginPath(); ctx.moveTo(center, center - 6);
  ctx.lineTo(center + 4, center + 4); ctx.lineTo(center - 4, center + 4); ctx.closePath(); ctx.fill();
  const nose = screen(radarProject(Math.cos(you.d) * Math.cos(you.pitch) * 4500,
    Math.sin(you.d) * Math.cos(you.pitch) * 4500, Math.sin(you.pitch) * 4500, you.d));
  line({x: center, y: center}, nose);
  ctx.beginPath(); ctx.arc(nose.x, nose.y, 2, 0, 2 * Math.PI); ctx.stroke();

  // Label up to three priority contacts, lock first; preserve team color
  // on glyphs while using neutral text for legibility against the reference disc.
  const labeled = contacts.filter(c => c.locked || c.threat)
    .sort((a, b) => Number(b.locked) - Number(a.locked) || a.distance - b.distance).slice(0, 3);
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillStyle = "#eceff1";
  for (const c of labeled) {
    const p = screen(c.point), text = radarAltitude(c.dz);
    const box = radarLabelBox(p.x, p.y, ctx.measureText(text).width, S, occupied);
    if (!box) continue;
    occupied.push(box); ctx.fillText(text, box.x, box.y);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#b0bec5";
  const locked = planets.find(p => p.n === you.lk);
  let footer = "STEMS: ΔZ · DASHED: BELOW";
  if (locked) {
    const altitude = `  ΔZ ${radarAltitude(locked.z - you.z)}`;
    let name = locked.name;
    // Shorten the name first so altitude remains readable on narrow displays.
    while (name.length > 1 && ctx.measureText(`LOCK ${name}${altitude}`).width > S - 14) {
      name = name.slice(0, -2) + "…";
    }
    footer = `LOCK ${name}${altitude}`;
  }
  ctx.fillText(footer, center, S - 13);
  ctx.restore();
}
