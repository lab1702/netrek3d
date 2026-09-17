package main

import (
	"math"
	"testing"
)

func TestHeldSteeringStrengthAndSpeedLimit(t *testing.T) {
	turn := func(input float64, speed int) float64 {
		g := NewGame()
		p := addPlayer(t, g, "pilot", "F", "CA").player
		p.X, p.Y, p.Z = 50000, 50000, 0
		p.Dir, p.DesDir, p.Pitch, p.DesPitch = 0, 0, 0, 0
		p.Speed, p.DesSpeed = speed, speed
		for i := 0; i < 10; i++ {
			g.Command(p, "steer", input, 1, 0)
			g.tick++
			g.movePlayer(p)
			g.housekeepPlayer(p)
		}
		return p.Dir
	}
	slow, fast := turn(0.1, 0), turn(1, 0)
	if math.Abs(slow-math.Pi/20) > 1e-8 || math.Abs(fast-math.Pi/2) > 1e-8 {
		t.Fatalf("non-proportional turn rates: %v %v", slow, fast)
	}
	highWarp := turn(1, 9)
	if gentle := turn(0.1, 9); math.Abs(gentle-highWarp*0.1) > 1e-8 {
		t.Fatalf("high-warp fine steering saturated: %v versus %v", gentle, highWarp)
	}
	budget := float64((10*(shipTypes["CA"].Turns>>9))/1000) * ByteRad
	if highWarp > budget+1e-8 || highWarp <= 0 || highWarp >= turn(1, 3) {
		t.Fatalf("high warp bypassed turn physics: %v budget %v", highWarp, budget)
	}
}
func TestSteeringReleaseAndTimeoutHoldHeading(t *testing.T) {
	for _, release := range []bool{false, true} {
		g := NewGame()
		p := addPlayer(t, g, "pilot", "F", "CA").player
		p.Dir, p.DesDir, p.Pitch, p.DesPitch = 0, 0, 0, 0
		g.Command(p, "steer", 1, 1, 0.5)
		g.tick++
		g.movePlayer(p)
		if release {
			g.Command(p, "steer", 0, 0)
		} else {
			g.tick = p.SteerUntil
		}
		dir, pitch := p.Dir, p.Pitch
		g.movePlayer(p)
		if p.Steering || p.Dir != dir || p.Pitch != pitch || p.DesDir != dir || p.DesPitch != pitch {
			t.Fatalf("release=%v did not hold authoritative heading", release)
		}
	}
}
func TestSteeringCancelsAutopilotAndYieldsToManualModes(t *testing.T) {
	for _, cmd := range []string{"course", "lock", "orbit", "repair", "selfdestruct"} {
		g := NewGame()
		p := addPlayer(t, g, "pilot", "F", "CA").player
		p.LockPlanet = 1
		p.RepairMode = true
		g.Command(p, "steer", 0.5, 1, 0.5)
		if p.LockPlanet != -1 || p.RepairMode || !p.Steering {
			t.Fatal("steering did not take manual control")
		}
		g.Command(p, cmd, 0, 0, 0)
		if p.Steering {
			t.Fatalf("%s did not cancel steering", cmd)
		}
	}
}
func TestSteeringInputValidationAndVerticalLimits(t *testing.T) {
	for _, v := range [][2]float64{{100, -100}, {math.NaN(), 1}, {1, math.Inf(1)}, {1, 1}} {
		x, y := steeringAxes(v[0], v[1])
		if math.IsNaN(x) || math.IsNaN(y) || math.Hypot(x, y) > 1+1e-9 {
			t.Fatal("unbounded steering")
		}
	}
	g := NewGame()
	p := addPlayer(t, g, "pilot", "F", "CA").player
	p.Pitch, p.DesPitch = math.Pi/2, math.Pi/2
	for i := 0; i < 20; i++ {
		g.Command(p, "steer", 0, 1, 1)
		g.tick++
		g.movePlayer(p)
	}
	if p.Pitch != math.Pi/2 || math.IsNaN(p.Dir) {
		t.Fatal("pitch pole became unstable")
	}
	// Throttle changes must retain an active held steering input.
	g.Command(p, "speed", 0, 5)
	if !p.Steering {
		t.Fatal("throttle canceled steering")
	}
}
