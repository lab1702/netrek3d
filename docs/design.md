# netrek3d design

This document describes the implemented spatial game. See the [README](../README.md)
for setup and controls and [protocol v2](protocol.md) for wire formats. The
[original netrekfp design](superpowers/specs/2026-07-10-netrekfp-design.md) is archived
history: its flat simulation and draft protocol are superseded.

## World and movement

The authoritative simulation runs at 10 Hz in a 100000-unit cube. X and Y range
from 0 to 100000; altitude Z ranges from -50000 to +50000. Distances for combat,
planet defenses, orbit entry, detection, autopilot, and bot navigation include Z.
One warp is 20 units per tick (200 units per second), regardless of pitch.

Yaw `d` and `pitch` are radians. The forward vector is
`(cos(d) cos(pitch), sin(d) cos(pitch), sin(pitch))`. Positive pitch initially
points upward; pitch can continue through either pole for complete loops. Angles
wrap at ±π. Equivalent yaw/pitch representations are chosen to preserve continuity
through pitch loops. There is no independent roll or strafe control.

Held mouse steering requests a turn in the current cockpit right/up frame, so
its direction stays correct when vertical or inverted. Its magnitude controls
turn strength, capped at 90 degrees per second and further limited by ship class
and warp speed. Direction changes follow great-circle arcs. Arrow keys instead
send discrete absolute yaw/pitch targets. Release holds the server's current
heading; missing held-input updates stop steering after five ticks.

Ships reflect off all six walls. Planet lock controls course, pitch, speed, and
orbit entry in 3D; manual course, steering, or throttle cancels the lock. Orbit
entry requires warp 2 or less and a center-to-center distance below 900. The
server captures an orbit plane from position and heading, with fallbacks for
radial approaches. Orbital radius is 800; inclined and vertical orbits persist.

## Planets and game rules

The forty classic planet names and X/Y coordinates remain. Each empire uses the
same ordered altitude sequence: `0, -24000, 18000, -12000, 6000, 30000, -30000,
12000, -6000, 24000`; all four homeworlds are at Z=0.

Warmup resets give each planet 30 armies; entering T-mode resets them to 12.
Resources are randomized on reset using the INL distribution: per empire,
2 agricultural, 3 repair, and 6 fuel planets, with overlapping facilities allowed.
Planet flags are defined in [planets.go](../planets.go).

Ship classes SC, DD, CA, BB, AS, SB, and GA retain their class statistics from the
predecessor. Limits are 128 players, 32 per team, and one active starbase per team.
Torpedoes (up to eight per ship), phasers, explosions, and planet defenses all use
spatial positions and ranges. Fuel starvation respects requested stops and
engine/damage speed limits. Army capacity depends on kills and ship class.

T-mode requires at least two teams with four players each, including bots. It
ends after 30 minutes or when fewer than two teams qualify. Capturing a populated
team's last planet ends the round early. Round endings discard statistics and
reset the galaxy; T-mode can begin again if player counts qualify. During T-mode,
planets of teams with no players cannot be bombed. State is in memory only.

Bots use 3D navigation, interception, dodging, planet defense, and army objectives.
Defenders leave repair and cloak to fight. Bots respawn after about three seconds;
when no joined human connection remains, they self-destruct and free their slots.
The README describes the shared bot controls.

Plasma torpedoes, tractors/pressors, docking/refit/transwarp, observer mode,
quadrant-conquer endings, surrender/coup timers, UDP, and persistent accounts or
statistics are not implemented.

## Server and networking

A Go binary embeds `web/`, serves HTTP, and exposes `/ws` and `/health`. The main
loop calls `Tick` and broadcasts every 100 ms. WebSocket reader goroutines call
game methods protected by the game mutex; inputs are not routed through a central
command channel. A writer goroutine per connection handles outgoing messages and
pings. See [net.go](../net.go) for connection limits and delivery details.

The server sends replaceable full state snapshots and separately queued one-shot
events. Enemy cloaked players are filtered per recipient, and team chat is sent
only to teammates. There is no distance-based server interest filtering. All
clients share one game; bot management is available from the lobby and cockpit.

`-addr` defaults to `:9702`. `NETREK3D_ORIGINS` overrides the browser origin allowlist;
without it, the Origin host must match the request Host. Requests without Origin
are accepted. `NETREK3D_SHOTDIR` optionally enables the development-only
`/debug/shot` endpoint, which writes up to 8 MiB of submitted bytes to `shot.png`
in an existing writable directory. The normal client does not automatically
submit screenshots. No database or external service is needed.

## Client and views

The client is plain JavaScript with raw WebGL1 and Canvas 2D, without a build step.
The cockpit maps game `(X,Y,Z)` to WebGL `(X,Z,Y)`. Its forward/right/up basis
supports full pitch loops; pointer weapon aiming casts a 3D ray through that
basis. Position and wrapped angles interpolate between snapshots, with jumps
across respawns excluded.

Planets are spheres of radius 600, fading from 18000 to 25000 units. Ship hulls
follow yaw and pitch. The orbit camera follows the orbital plane and frames the
planet limb near 95% of viewport height. Phaser lines, torpedoes, explosions,
and labels use spatial coordinates.

The local radar projects a heading-up, tilted 3D view with a 20000-unit spherical
range. Vertical stems show altitude relative to the ship; negative altitude uses
dashed stems. It stays upright while the cockpit pitches. The galactic map is a
rotatable perspective projection drawn on Canvas 2D, with top/side presets,
zoom, ship following, selection, and explicit planet locking. Opening it does
not pause the simulation.

| Files | Responsibility |
|---|---|
| `main.go`, `net.go` | Embedded HTTP client, game loop, WebSocket protocol and fanout |
| `game.go`, `spatial.go` | Rules, movement, weapons, orbit, and 3D math |
| `planets.go`, `ships.go` | Planet layout/resources and ship statistics |
| `bots.go`, `bots_ai.go` | Bot lifecycle, navigation, combat, and objectives |
| `web/game.js` | Connection, input, HUD, interpolation, and frame orchestration |
| `web/gl.js` | Cockpit WebGL renderer and camera basis |
| `web/radar.js`, `web/galaxy.js` | Local spatial radar and interactive galaxy map |
| `web/steering.js` | Held-input state and proportional steering requests |
| `web/index.html`, `web/lab1702.css` | UI structure and shared visual styles |
| `*_test.go`, `tests/client.test.cjs` | Simulation/network and client regression tests |

The [CI workflow](../.github/workflows/test.yml) and the README list the required
checks. Automated client tests use mocked browser APIs; visual browser/WebGL
checks and container smoke tests remain separate manual verification.
