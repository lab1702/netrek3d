# netrek3d

A standalone, fully spatial evolution of [netrekfp](https://github.com/lab1702/netrekfp).
The authoritative Go server simulates a 100000 × 100000 × 100000 galaxy:
X/Y run from 0 to 100000; Z (altitude) runs from -50000 to +50000.
The WebGL cockpit follows your ship's yaw and pitch.

Ships, planets, torpedoes, phasers, explosions, detection ranges, planet defenses,
and autopilot all use three-dimensional coordinates. Speed is constant regardless
of pitch. Ship turning follows a great-circle arc with the existing class turn rates.
Ships bounce off all six galaxy walls. Orbit entry captures a plane from the approach
position and heading, so orbits can be inclined or vertical.

The forty classic planets retain their X/Y positions and use the same ten altitude
layers per empire, with homeworlds at Z=0. Bots navigate between these layers and
lead moving targets with a three-dimensional projectile intercept calculation.
Classic ship classes, resources, army play, T-mode, and combat balance constants
are inherited from the original project.

The galactic map is a rotatable perspective view of the actual XYZ galaxy. The
local radar is a tilted, heading-up 3D view with a 20k spherical range. Contacts
above/below your altitude plane have vertical stems (dashed below); diamonds
are ships and circles are planets. It stays vertically stable while pitching,
and labels your planet lock and nearby threats with relative altitude. Flight uses yaw and
pitch with continuous full loops; independent roll and strafing are not implemented.

This project is developed separately in `lab1702/netrek3d`. The original repository
is not configured as a push remote. Its MIT license and history are retained.

## Run

```
go run .
```

or with Docker:

```
docker compose up -d
```

then open http://localhost:9701 (WebGL required). Up to 128 players, 32 per team.

Runs standalone or behind a path-stripping reverse proxy — the client resolves its
WebSocket relative to the page URL. Caddy example:

```
example.com {
    redir /netrek3d /netrek3d/ 301
    handle_path /netrek3d/* {
        reverse_proxy localhost:9701
    }
}
```

WebSocket connections are same-origin only (Caddy preserves the Host header, so the above
just works). If your proxy rewrites Host, set `NETREK3D_ORIGINS` to a comma-separated list
of allowed origins (e.g. `https://example.com`), or `*` to disable the check.

**Bots:** the join screen has bot controls — `+F/+R/+K/+O` add a bot to a team, `−` removes one,
`BALANCE` tops up the two most-populated teams to 4v4 (T-mode-ready in one click), `CLEAR` removes
all bots. Bot AI is modeled on [lab1702/netrek-web](https://github.com/lab1702/netrek-web): threat
assessment, torpedo dodging, lead-aimed torps and spreads, target scoring, planet defense, and a
full T-mode planet game (bomb, pick up, take). Bots count toward T-mode player counts.

## Rules

Standard Bronco netrek at 10 Hz: SC/DD/CA/BB/AS/SB/GA ship classes, phasers with range falloff,
max 8 torps with proximity fuses, shields, weapon/engine overheat, repair mode, fuel/repair/agri
planets, orbit-bomb-beam army play, planet capture (enemy → independent → yours), cloak, det.

**T-mode** starts when ≥2 teams each have ≥4 players and runs 30 minutes, or until fewer than
2 teams have 4+. **Genocide** ends the round early: take a populated team's last planet and its
remaining ships are destroyed, the win is announced, and the galaxy resets (T-mode restarts if
enough players remain). Either way, stats are discarded when a round ends. No database, nothing
persists.

UI chrome (join screen, HUD, panels) follows the lab1702 design system
([web/lab1702.css](web/lab1702.css) — terminal-phosphor tokens, `l7-*` components); the netrek
team colors and all in-game rendering are historical and deliberately outside the system.

## Controls

| Input | Action |
|---|---|
| hold right mouse | continuously steer yaw/pitch; farther from center turns faster within ship turn limits |
| arrow keys | steer pitch up/down and yaw left/right |
| `h` | level pitch at current altitude |
| left-click / `t` | fire torpedo toward pointer |
| middle-click / `f` | fire phaser toward pointer |
| `p` | player list: 4 team columns, sorted by kills |
| Enter / shift+Enter | team chat / all chat (Esc cancels) |
| `0`–`9`, `=` | warp speed (= is max) |
| `s` | shields |
| `o` | orbit (warp ≤ 2, near planet) |
| `l` | cockpit: lock planet under pointer; map: lock selected planet; autopilot handles course, speed, and orbit |
| `b` | bomb (orbiting enemy planet) |
| `z` / `x` | beam armies up / down |
| `c` | cloak |
| `d` | det enemy torps |
| `R` | repair mode |
| `m` | open/close interactive 3D galactic map |
| `\` | bot management panel |
| `Q` | self destruct (10 s fuse; any other action cancels) |
| Esc | quit ship (or close bot panel) |

You need kills to carry armies (2 per kill, 3 per kill in an Assault ship).

## Continuous flight steering

Hold the right mouse button and move the pointer away from the center to steer.
The small center ring is a neutral zone; outside it, response increases smoothly
with distance. Near-center input uses only part of the available turn rate; edge
input uses the maximum allowed by your ship and warp speed, capped at 90°/second.
Pitch continues through straight up/down into full loops. Equivalent heading angles
are kept continuous at the poles, and both angles interpolate across their wrap.

Release the button to hold the current heading. Steering also stops when opening
the map or chat, switching to another navigation mode, or losing window focus.
Throttle changes and weapon fire work while steering. The client sends input at
10 Hz; the server integrates it at its own tick rate and stops if updates are
missing for 500 ms. Steering never moves the ship directly on the client.

## Galactic map

Press `m` to open the live 3D galaxy. Drag to orbit the camera and scroll (or use
`+`/`−`) to zoom. Click a planet or visible ship to inspect its coordinates,
true spatial distance, and relative altitude. Planet details include armies and
facilities. A dashed line connects your ship to the selected object.

Selection alone does not change your course. Use **Lock planet** (or `l`) to
start autopilot to the selected planet. The planet selector also supports keyboard
navigation and finding planets hidden behind other contacts. Ships can be inspected
but cannot be locked; the server currently supports planet autopilot only.

**3D / Top / Side** change the viewing angle. **Center on ship** follows your ship;
**Reset galaxy** returns to the default galaxy view and zoom. Grid and altitude stems
can be toggled independently. Arrow keys rotate the map when not editing a control.
`m` or Escape closes the map without quitting your ship. The game continues running
while the map is open; flight and weapon shortcuts are suppressed until it closes.

## Development and verification

Requires Go 1.26.5 or newer. No JavaScript build or external browser libraries.

```sh
go test -race ./...
node --test tests/client.test.cjs
go run . -addr :9701
```

The spatial regression tests cover pitch-independent speed, Z wall reflections,
vertical weapon hits, altitude isolation of area effects, inclined orbit stability,
autopilot convergence, 3D bot intercepts, and wire serialization. Existing Netrek
rule and WebSocket regression tests remain in place.

Protocol version 2 adds `z` to positions and `pitch` (radians, wrapped to -π through +π)
to ship state and course/weapon commands. Phaser effects carry `fz` and `tz`;
explosions carry `z`. The welcome message advertises `protocol: 2, dimensions: 3`.
The `steer` command uses `v: 1` for held input, `d`/`pitch` for normalized
horizontal/vertical axes, and `v: 0` to release at the server's current heading.
Use this repository's client with its server; the old flat client is not supported.

Design notes under `docs/superpowers/` describe the original flat-world project
and are retained as historical reference.
