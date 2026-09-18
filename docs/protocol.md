# WebSocket protocol v2

Connect to `/ws` on the game server. When hosted under a path-stripping proxy,
the browser resolves `ws` relative to the page directory. Messages are JSON
objects with a `t` discriminator. [net.go](../net.go) defines the wire structs;
[game.go](../game.go) implements commands and effect payloads.

## Coordinates and units

Positions use game `(x,y,z)`, with Z as altitude. X/Y are in `[0,100000]`, and Z
is in `[-50000,50000]`. Directions use yaw `d` and `pitch` in radians; positive
pitch initially points upward. Full pitch loops are supported, with angles
wrapped at ±π. Direction components are
`(cos(d) cos(pitch), sin(d) cos(pitch), sin(pitch))`.

Only `steer` overloads `d` and `pitch` as normalized control axes rather than
angles. Ship speed is integer warp. Snapshot `tmode.left` and `you.sd` are seconds.
Use the bundled v2 client with this server; the original flat client is unsupported.

## Connection and server messages

The server immediately sends `welcome` with `protocol: 2`, `dimensions: 3`, team
`counts`, and full `planets`. It does not contain a player ID or ship statistics.
A successful join returns `{"t":"joined","id":0}` (ID varies); rejection
returns `{"t":"deny","reason":"..."}`.

| Message | Payload and delivery |
|---|---|
| `welcome` | Version, dimensions, counts, full planet metadata; reliable queue |
| `joined` / `deny` | Join result; reliable queue |
| `lobby` | `counts` for connections that have not joined; latest state |
| `snap` | `you`, `players`, `torps`, `planets`, `tmode`, `counts`; latest state at 10 Hz |
| `events` | Optional `phasers`, `booms`, `msgs`, `chats`; reliable queue for joined clients |

Slow readers receive the latest snapshot instead of a backlog. One-shot events
are queued separately; clients that exhaust that queue are disconnected rather
than silently losing events. Legacy effect keys also exist on the snapshot
struct and can be null; current clients consume effects from `events`.

Full planet metadata is `{n,name,x,y,z,o,a,f}`: index, name, position, owner team,
armies, and bit flags. Subsequent planet entries contain only `{n,o,a,f}`; keep
the welcome metadata and merge updates by `n`. Flag bits are repair=1, fuel=2,
agricultural=4, home=8, core=16. Teams are `F`, `R`, `K`, `O`; `I` means independent.

Player entries are `{i,nm,tm,s,x,y,z,d,pitch,ki,st,cl}`: ID, name, team, ship type,
position, angles, kills, status, cloak. Enemy cloaked ships are omitted; allied
cloaked ships remain listed. Dead players can remain in the roster; quit players
are excluded. Remote player and torpedo coordinates are serialized as integers;
`you` keeps floating-point coordinates.

`you` includes position/angles plus the following fields:

| Fields | Meaning |
|---|---|
| `i`, `tm`, `st` | Player ID, team, and status (`alive`, `explode`, or `dead` during play) |
| `sp`, `maxsp` | Warp speed and class maximum |
| `sh`, `maxsh`, `dm`, `maxdm` | Shield and hull damage values/limits |
| `fu`, `maxfu`, `wt`, `maxwt`, `et`, `maxet` | Fuel, weapon temperature, engine temperature, and limits |
| `tp`, `ar`, `ki` | Active torpedoes, carried armies, kills |
| `orb`, `lk` | Orbiting/locked planet index; -1 when absent |
| `shup`, `cl`, `rep`, `bmb` | Shields up, cloak, repair, bombing |
| `sd` | Armed self-destruct countdown; 0 when disarmed |

Torpedoes are `{i,x,y,z,tm}`. Phaser effects are `{fx,fy,fz,tx,ty,tz,tm}` with
spatial start/end points. Explosions are `{x,y,z,s,tm?}`, where `s` is visual scale.
Ship explosions include `tm`, the ship's team at death, for galactic map colors;
torpedo explosions omit it.
Chat events are `{fm,tm,to,tx}`: sender name/team, channel, text. `msgs` contains
server message strings. Team chat is filtered server-side. Arrays may be null
when empty, so clients should treat null as no entries.

## Client commands

Examples below are complete messages; IDs and angles are illustrative.

| Command | Example / behavior |
|---|---|
| Join | `{"t":"join","name":"pilot","team":"F","ship":"CA"}`; also used to rejoin after death |
| Absolute course | `{"t":"course","d":0.5,"pitch":0.2}` |
| Held steering | `{"t":"steer","v":1,"d":0.6,"pitch":0.8}` |
| Release steering | `{"t":"steer","v":0}` |
| Throttle | `{"t":"speed","v":5}`; class maximum clamps high values |
| Torpedo | `{"t":"torp","d":0.5,"pitch":0.2}` |
| Phaser | `{"t":"phaser","d":0.5,"pitch":0.2}` |
| Planet lock | `{"t":"lock","v":3}`; planet index, with automatic course/speed/orbit |
| Chat | `{"t":"chat","to":"team","text":"Defend Earth"}`; `to:"all"` for all players |
| Bot add/remove | `{"t":"addbot","team":"F"}` / `{"t":"removebot","team":"F"}` |
| Bot population | `{"t":"balancebots"}`, `{"t":"fillbots"}`, `{"t":"clearbots"}` |

Other commands need only `t`: `shields`, `orbit`, `bomb`, `beamup`, `beamdown`,
`repair`, `cloak`, `det`, `selfdestruct`, `quit`. Gameplay commands require a joined
player and, except quitting, a living ship. Bot controls are available before join.

Held steering uses a unit disc: positive `d` is cockpit-right and positive `pitch`
is cockpit-up. Axes are bounded and diagonal magnitude is normalized. Send updates
at 10 Hz while held; after five server ticks without an update, steering releases.
The server applies turn budgets and owns the resulting heading. Throttle and
weapons preserve held steering; course, lock, orbit, repair, self-destruct, and
quit stop it. Steering cancels orbit, repair, and autopilot.

For absolute course and weapons, include `pitch` explicitly: an omitted JSON
field decodes as zero, not the current pitch. Another gameplay command cancels
an armed self-destruct; chat does not.

## Limits and lifetime

There are at most 128 WebSocket connections, including lobby connections, and
128 player slots with at most 32 per team. Client messages are limited to 512
bytes, including after decompression. Names use at most 15 printable ASCII
characters; chat uses 120. Empty names become `guest`.

Each connection has an input budget of 100 messages per second with a burst
capacity of 200 messages. It covers all commands, including chat, lobby controls,
and invalid messages. Exceeding it closes that connection with WebSocket code
1008. The normal 10 Hz steering stream and concurrent weapon input fit this budget.

A connection must successfully join within two minutes. The server pings every
54 seconds, uses a 60-second pong deadline after joining, and a 10-second write
deadline. WebSocket compression is negotiated when offered. Browser origins are
checked against the request host by default; `NETREK3D_ORIGINS` configures explicit
allowed origins. Disconnecting releases the player's slot and owned torpedoes.
