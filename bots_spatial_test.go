package main

import (
	"math"
	"testing"
)

func TestBotPlanetApproachAtHighWarp(t *testing.T) {
	for _, ship := range []string{"SC", "DD", "CA", "BB", "AS"} {
		for _, attitude := range []struct {
			name       string
			yaw, pitch float64
		}{
			{"tangent", math.Pi / 2, 0},
			{"away", 0, 0},
			{"vertical", 0, math.Pi / 2},
		} {
			t.Run(ship+"/"+attitude.name, func(t *testing.T) {
				g := NewGame()
				p := addPlayer(t, g, "bot", "F", ship).player
				p.Bot = newBotState()
				pl := g.planets[0]
				pl.X, pl.Y, pl.Z = 50000, 50000, 0
				p.X, p.Y, p.Z = pl.X+12000, pl.Y, pl.Z
				p.Dir, p.Pitch = attitude.yaw, attitude.pitch
				p.DesDir, p.DesPitch = p.Dir, p.Pitch
				p.Speed, p.DesSpeed = p.Ship.MaxSpeed, p.Ship.MaxSpeed
				for tick := 0; tick < 600 && p.Orbiting != pl.N; tick++ {
					// Isolate navigation: fuel starvation and random overheating must
					// not rescue an approach that cannot converge at its chosen speed.
					p.Fuel = p.Ship.MaxFuel
					g.botGoOrbit(p, pl, combatThreat{closestTorp: maxSearch, closestEnemy: maxSearch})
					g.movePlayer(p)
				}
				if p.Orbiting != pl.N {
					t.Fatalf("bot did not reach orbit; remaining distance %.0f", length3(p.X-pl.X, p.Y-pl.Y, p.Z-pl.Z))
				}
			})
		}
	}
}

func TestBotSpatialThreatFacing(t *testing.T) {
	for _, approach := range []struct {
		name       string
		offset     vec3
		yaw, pitch float64
	}{
		{"horizontal", vec3{X: 1}, math.Pi, 0},
		{"above", vec3{Z: 1}, math.Pi / 2, -math.Pi / 2},
		{"below", vec3{Z: -1}, -math.Pi / 2, math.Pi / 2},
		{"diagonal", vec3{X: 1, Z: 1}.unit(), math.Pi, -math.Pi / 4},
		{"inverted", vec3{X: 1, Z: 1}.unit(), 0, -3 * math.Pi / 4},
	} {
		for _, incoming := range []bool{true, false} {
			name := approach.name + "/incoming"
			if !incoming {
				name = approach.name + "/outgoing"
			}
			t.Run(name, func(t *testing.T) {
				g := NewGame()
				p := addPlayer(t, g, "defender", "F", "CA").player
				enemy := addPlayer(t, g, "attacker", "R", "CA").player
				for _, pl := range g.planets {
					pl.Owner = TeamNone
				}
				pl := g.planets[0]
				pl.Owner, pl.X, pl.Y, pl.Z = p.Team, 50000, 50000, 0
				p.X, p.Y, p.Z = pl.X, pl.Y, pl.Z
				enemy.Dir, enemy.Pitch = approach.yaw, approach.pitch
				if !incoming {
					enemy.Dir += math.Pi
					enemy.Pitch = -enemy.Pitch
				}
				enemy.Speed = 5
				at := func(distance float64) vec3 {
					return vec3{p.X, p.Y, p.Z}.add(approach.offset.scale(distance))
				}
				position := at(10000)
				enemy.X, enemy.Y, enemy.Z = position.X, position.Y, position.Z
				planet, attacker, _ := g.threatenedPlanet(p)
				if (planet == pl && attacker == enemy) != incoming {
					t.Fatalf("planet defense detected incoming=%v as %v", incoming, planet != nil)
				}
				position = at(1900)
				enemy.X, enemy.Y, enemy.Z = position.X, position.Y, position.Z
				if th := g.botThreats(p); th.evade != incoming {
					t.Fatalf("ship threat detected incoming=%v as %v", incoming, th.evade)
				}
				position = at(3500)
				torp := &Torp{X: position.X, Y: position.Y, Z: position.Z,
					Dir: enemy.Dir, Pitch: enemy.Pitch, Speed: 12, Team: enemy.Team}
				if threatening := g.botTorpThreatening(p, torp); threatening != incoming {
					t.Fatalf("torpedo threat detected incoming=%v as %v", incoming, threatening)
				}
			})
		}
	}
}

func TestBotCombatManeuversAreSpatial(t *testing.T) {
	for _, offset := range []vec3{{X: 2000}, {Z: 2000}, {Z: -2000}, {X: 1200, Z: 1600}} {
		for _, retreat := range []bool{false, true} {
			g := NewGame()
			p := addPlayer(t, g, "bot", "F", "SC").player
			p.Bot = newBotState()
			enemy := addPlayer(t, g, "enemy", "R", "CA").player
			p.X, p.Y, p.Z = 50000, 50000, 0
			enemy.X, enemy.Y, enemy.Z = p.X+offset.X, p.Y+offset.Y, p.Z+offset.Z
			p.Fuel = 0 // suppress weapon and cloak choices; inspect navigation
			p.Speed = 0
			if retreat {
				p.Speed = p.Ship.MaxSpeed // enemy turns faster; bot has the speed advantage
			}
			g.botEngage(p, enemy, offset.norm(), combatThreat{closestTorp: maxSearch, closestEnemy: maxSearch})
			toward := heading(p.DesDir, p.DesPitch).dot(offset.unit())
			want := 0.0 // circling must be tangent to the target
			if retreat {
				want = -1
			}
			if math.Abs(toward-want) > 1e-9 {
				t.Fatalf("retreat=%v offset=%v: heading toward enemy=%v, want %v", retreat, offset, toward, want)
			}
		}
	}
}
