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
func TestSteeringInputValidationAndVerticalCrossing(t *testing.T) {
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
	if math.Abs(p.Pitch+math.Pi/2) > 1e-8 || math.IsNaN(p.Dir) {
		t.Fatal("pitch did not continue through the pole")
	}
	// Throttle changes must retain an active held steering input.
	g.Command(p, "speed", 0, 5)
	if !p.Steering {
		t.Fatal("throttle canceled steering")
	}
}

func TestHeldSteeringCompletesRepeatedLoops(t *testing.T) {
	for _, speed := range []int{0, 4, 9} {
		for _, axis := range []int{0, 1} {
			for _, sign := range []float64{-1, 1} {
				g := NewGame()
				p := addPlayer(t, g, "pilot", "F", "CA").player
				p.Dir, p.Pitch, p.DesDir, p.DesPitch = 0, 0, 0, 0
				p.Speed, p.DesSpeed = speed, speed
				total := 0.0
				for i := 0; i < 3000 && math.Abs(total) < 4*math.Pi; i++ {
					p.X, p.Y, p.Z = 50000, 50000, 0 // isolate rotation from galaxy edge reflections
					oldYaw, oldPitch := p.Dir, p.Pitch
					x, y := sign, 0.0
					if axis == 1 {
						x, y = 0, sign
					}
					g.Command(p, "steer", x, 1, y)
					g.tick++
					g.movePlayer(p)
					delta := math.Remainder(p.Dir-oldYaw, 2*math.Pi)
					if axis == 1 {
						delta = math.Remainder(p.Pitch-oldPitch, 2*math.Pi)
						if math.Abs(math.Remainder(p.Dir-oldYaw, 2*math.Pi)) > 1e-6 {
							t.Fatal("pitch loop flipped yaw")
						}
					}
					if sign*delta < -1e-8 || math.Abs(delta) > math.Pi/20+1e-8 {
						t.Fatalf("discontinuous turn: %v", delta)
					}
					total += delta
				}
				if math.Abs(total) < 4*math.Pi {
					t.Fatalf("loop stalled: speed=%d axis=%d sign=%v total=%v", speed, axis, sign, total)
				}
			}
		}
	}
}

func TestVerticalOrbitAttitudeDoesNotFlip(t *testing.T) {
	g := NewGame()
	p := addPlayer(t, g, "pilot", "F", "CA").player
	pl := g.planets[0]
	p.OrbitNormal = vec3{Y: -1}
	p.Dir, p.Pitch = 0, 0
	// Start at the bottom, heading horizontally; follow three full orbits.
	for i := 0; i <= 384; i++ {
		a := float64(i) * 2 * ByteRad
		oldYaw, oldPitch := p.Dir, p.Pitch
		g.placeOrbit(p, pl, vec3{X: math.Sin(a), Z: -math.Cos(a)})
		if math.Abs(math.Remainder(p.Dir-oldYaw, 2*math.Pi)) > 1e-6 || math.Abs(math.Remainder(p.Pitch-oldPitch, 2*math.Pi)) > 2*ByteRad+1e-8 {
			t.Fatalf("orbit flipped at step %d: (%v,%v) -> (%v,%v)", i, oldYaw, oldPitch, p.Dir, p.Pitch)
		}
	}
}
