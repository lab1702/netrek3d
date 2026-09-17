package main

import (
	"encoding/json"
	"math"
	"testing"
)

func TestVerticalMovementAndSpeed(t *testing.T) {
	for _, pitch := range []float64{-math.Pi / 2, -0.4, 0, 0.8, math.Pi / 2} {
		g := NewGame()
		p := addPlayer(t, g, "pilot", "F", "CA").player
		p.X, p.Y, p.Z = 50000, 50000, 0
		p.Dir, p.DesDir, p.Pitch, p.DesPitch = 0.7, 0.7, pitch, pitch
		p.Speed, p.DesSpeed = 5, 5
		g.movePlayer(p)
		if d := length3(p.X-50000, p.Y-50000, p.Z); math.Abs(d-5*Warp1) > 1e-8 {
			t.Fatalf("pitch %v changed speed: %v", pitch, d)
		}
		if math.Abs(p.Z-5*Warp1*math.Sin(pitch)) > 1e-8 {
			t.Fatal("wrong vertical displacement")
		}
	}
}
func TestAltitudeWalls(t *testing.T) {
	for _, sign := range []float64{-1, 1} {
		g := NewGame()
		p := addPlayer(t, g, "pilot", "F", "CA").player
		p.X, p.Y, p.Z = 50000, 50000, sign*(GWidth/2-10)
		p.Pitch, p.DesPitch = sign*math.Pi/2, sign*math.Pi/2
		p.Speed, p.DesSpeed = 5, 5
		g.movePlayer(p)
		if math.Abs(p.Z) > GWidth/2 || p.Pitch*sign >= 0 || p.DesPitch*sign >= 0 {
			t.Fatalf("bad reflection: %+v", p)
		}
	}
}
func TestPhaserAltitudeAndVerticalAim(t *testing.T) {
	g := NewGame()
	p := addPlayer(t, g, "shooter", "F", "CA").player
	q := addPlayer(t, g, "target", "R", "CA").player
	p.X, p.Y, p.Z = 50000, 50000, 0
	q.X, q.Y, q.Z = 50000, 50000, 3000
	g.firePhaser(p, 0, 0)
	if q.Shield != q.Ship.MaxShield {
		t.Fatal("horizontal beam hit vertically separated ship")
	}
	p.PhaserBusy = 0
	g.firePhaser(p, 0, math.Pi/2)
	if q.Shield != q.Ship.MaxShield-50 {
		t.Fatalf("vertical phaser damage = %d", q.Ship.MaxShield-q.Shield)
	}
	fx := g.phasers[len(g.phasers)-1]
	if fx.FZ != 0 || fx.TZ != 3000 {
		t.Fatal("beam endpoints lost altitude")
	}
}
func TestTorpVerticalFlightAndSeparation(t *testing.T) {
	g := NewGame()
	p := addPlayer(t, g, "shooter", "F", "CA").player
	q := addPlayer(t, g, "target", "R", "CA").player
	p.X, p.Y, p.Z = 50000, 50000, 0
	q.X, q.Y, q.Z = 50000, 50000, 4000
	g.fireTorp(p, 0, math.Pi/2)
	torp := g.torps[g.torpSeq]
	g.moveTorps()
	if torp.Z <= 0 || len(g.torps) != 1 || q.Shield != q.Ship.MaxShield {
		t.Fatal("vertical torpedo flight/proximity wrong")
	}
	for i := 0; i < 30 && len(g.torps) > 0; i++ {
		g.moveTorps()
	}
	if q.Shield == q.Ship.MaxShield {
		t.Fatal("vertical torpedo never hit")
	}
}
func TestAltitudeSeparatesAreaEffects(t *testing.T) {
	g := NewGame()
	p := addPlayer(t, g, "one", "F", "CA").player
	q := addPlayer(t, g, "two", "R", "CA").player
	pl := g.planets[10]
	p.X, p.Y, p.Z = pl.X, pl.Y, pl.Z+5000
	q.X, q.Y, q.Z = pl.X, pl.Y, pl.Z
	g.planetFight()
	if p.Shield != p.Ship.MaxShield {
		t.Fatal("planet fire ignored altitude")
	}
	g.enterOrbit(p)
	if p.Orbiting >= 0 {
		t.Fatal("orbit ignored altitude")
	}
	q.ExplodeTeam = q.Team
	g.blowup(q)
	if p.Shield != p.Ship.MaxShield {
		t.Fatal("ship splash ignored altitude")
	}
	torp := &Torp{ID: 1, Team: q.Team, X: q.X, Y: q.Y, Z: q.Z, Damage: 100, owner: q}
	g.torps[1] = torp
	g.detEnemyTorps(p)
	if len(g.torps) != 1 {
		t.Fatal("det ignored altitude")
	}
	g.explodeTorp(torp)
	if p.Shield != p.Ship.MaxShield {
		t.Fatal("torpedo splash ignored altitude")
	}
}
func TestInclinedOrbitConservesRadius(t *testing.T) {
	g := NewGame()
	p := addPlayer(t, g, "pilot", "F", "CA").player
	pl := g.planets[1]
	p.X, p.Y, p.Z = pl.X, pl.Y, pl.Z+OrbDist
	p.Dir, p.Pitch = 0, 0
	g.enterOrbit(p)
	if p.Orbiting != pl.N {
		t.Fatal("vertical orbit entry failed")
	}
	startZ := p.Z
	for i := 0; i < 40; i++ {
		g.movePlayer(p)
		if d := length3(p.X-pl.X, p.Y-pl.Y, p.Z-pl.Z); math.Abs(d-OrbDist) > 1e-7 {
			t.Fatalf("orbit radius drift: %v", d)
		}
	}
	if math.Abs(startZ-p.Z) < 100 {
		t.Fatal("inclined orbit flattened")
	}
}
func TestAutopilotReachesElevatedPlanet(t *testing.T) {
	for _, delta := range []vec3{{0, 0, 12000}, {12000, -5000, -14000}} {
		g := NewGame()
		p := addPlayer(t, g, "pilot", "F", "CA").player
		pl := g.planets[1]
		p.X, p.Y, p.Z = pl.X+delta.X, pl.Y+delta.Y, pl.Z+delta.Z
		g.Command(p, "lock", 0, pl.N)
		for i := 0; i < 2500 && p.Orbiting < 0; i++ {
			g.movePlayer(p)
			g.housekeepPlayer(p)
		}
		if p.Orbiting != pl.N {
			t.Fatalf("autopilot failed from %+v at (%v,%v,%v)", delta, p.X, p.Y, p.Z)
		}
	}
}
func TestBotThreeDimensionalIntercept(t *testing.T) {
	p := &Player{X: 50000, Y: 50000, Z: -2000, Orbiting: -1}
	q := &Player{X: 52000, Y: 51000, Z: 2000, Dir: 0.5, Pitch: 0.7, Speed: 5, Orbiting: -1}
	yaw, pitch, ticks, ok := botAim3D(p, q, 240)
	if !ok || pitch <= 0 {
		t.Fatal("bot failed to aim upward")
	}
	a := vec3{p.X, p.Y, p.Z}.add(heading(yaw, pitch).scale(ticks * 240))
	b := vec3{q.X, q.Y, q.Z}.add(targetVelocity3D(q).scale(ticks))
	if a.add(b.scale(-1)).norm() > 1e-6 {
		t.Fatal("3D intercept missed")
	}
}
func TestWireIncludesAltitudeAndPitch(t *testing.T) {
	g := NewGame()
	c := addPlayer(t, g, "pilot", "F", "CA")
	c.snap = make(chan []byte, 1)
	p := c.player
	p.Z = 1234
	p.Pitch = 0.5
	g.fireTorp(p, 0, 0.5)
	s := &Server{game: g, clients: map[*Client]bool{c: true}}
	s.broadcast()
	var snap wireSnap
	if err := json.Unmarshal(<-c.snap, &snap); err != nil {
		t.Fatal(err)
	}
	if snap.You.Z != 1234 || snap.You.Pitch != 0.5 || snap.Players[0].Z != 1234 || snap.Torps[0].Z != 1234 {
		t.Fatal("wire lost Z/pitch")
	}
	if g.wirePlanetsFull()[1].Z != g.planets[1].Z {
		t.Fatal("wire lost planet Z")
	}
}

func TestBotOrbitsElevatedPlanet(t *testing.T) {
	g := NewGame()
	g.AddBotCmd("F")
	p := g.players[0]
	pl := g.planets[1]
	p.X, p.Y, p.Z = pl.X+6000, pl.Y, pl.Z-9000
	for i := 0; i < 2500 && p.Orbiting < 0; i++ {
		g.botGoOrbit(p, pl, combatThreat{closestTorp: maxSearch, closestEnemy: maxSearch})
		g.movePlayer(p)
		g.housekeepPlayer(p)
	}
	if p.Orbiting != pl.N {
		t.Fatalf("bot failed to reach elevated planet: (%v,%v,%v)", p.X, p.Y, p.Z)
	}
}
func TestPitchCommandClampAndTurnRate(t *testing.T) {
	g := NewGame()
	p := addPlayer(t, g, "pilot", "F", "CA").player
	g.Command(p, "course", 0, 0, 100)
	if p.DesPitch != math.Pi/2 {
		t.Fatal("pitch not clamped")
	}
	p.Dir, p.Pitch = 0, 0
	p.DesDir, p.DesPitch = 1, 0.9
	before := heading(p.Dir, p.Pitch)
	turnToward(p, 0.1)
	if angle := math.Acos(before.dot(heading(p.Dir, p.Pitch))); math.Abs(angle-0.1) > 1e-8 {
		t.Fatalf("combined turn exceeded budget: %v", angle)
	}
}
