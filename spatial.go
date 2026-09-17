package main

import "math"

type vec3 struct{ X, Y, Z float64 }

func (v vec3) add(w vec3) vec3      { return vec3{v.X + w.X, v.Y + w.Y, v.Z + w.Z} }
func (v vec3) scale(s float64) vec3 { return vec3{v.X * s, v.Y * s, v.Z * s} }
func (v vec3) dot(w vec3) float64   { return v.X*w.X + v.Y*w.Y + v.Z*w.Z }
func (v vec3) cross(w vec3) vec3 {
	return vec3{v.Y*w.Z - v.Z*w.Y, v.Z*w.X - v.X*w.Z, v.X*w.Y - v.Y*w.X}
}
func (v vec3) norm() float64 { return length3(v.X, v.Y, v.Z) }
func (v vec3) unit() vec3 {
	if n := v.norm(); n > 1e-12 {
		return v.scale(1 / n)
	}
	return vec3{}
}
func length3(x, y, z float64) float64 { return math.Hypot(math.Hypot(x, y), z) }

// wrapPitch permits complete loops while keeping network angles bounded.
func wrapPitch(p float64) float64 {
	if math.IsNaN(p) || math.IsInf(p, 0) {
		return 0
	}
	return math.Remainder(p, 2*math.Pi)
}

// A direction has two equivalent yaw/pitch representations. Keep the one
// closest to the previous attitude so crossing a pole does not flip the camera.
func setHeading(p *Player, v vec3) {
	yaw := p.Dir
	if math.Hypot(v.X, v.Y) > 1e-10 {
		yaw = math.Atan2(v.Y, v.X)
	}
	pitch := math.Atan2(v.Z, math.Hypot(v.X, v.Y))
	otherYaw, otherPitch := yaw+math.Pi, math.Pi-pitch
	distance := func(y, e float64) float64 {
		return math.Hypot(math.Remainder(y-p.Dir, 2*math.Pi), math.Remainder(e-p.Pitch, 2*math.Pi))
	}
	if distance(otherYaw, otherPitch) < distance(yaw, pitch) {
		yaw, pitch = otherYaw, otherPitch
	}
	p.Dir, p.Pitch = math.Remainder(yaw, 2*math.Pi), wrapPitch(pitch)
}

func heading(yaw, pitch float64) vec3 {
	return vec3{math.Cos(yaw) * math.Cos(pitch), math.Sin(yaw) * math.Cos(pitch), math.Sin(pitch)}
}
func elevation(x, y, z, tx, ty, tz float64) float64 { return math.Atan2(tz-z, math.Hypot(tx-x, ty-y)) }
func (g *Game) placeOrbit(p *Player, pl *Planet, r vec3) {
	r = r.unit()
	p.X, p.Y, p.Z = pl.X+OrbDist*r.X, pl.Y+OrbDist*r.Y, pl.Z+OrbDist*r.Z
	v := p.OrbitNormal.cross(r).unit()
	setHeading(p, v)
	p.DesDir, p.DesPitch = p.Dir, p.Pitch
}
func turnToward(p *Player, step float64) {
	a, b := heading(p.Dir, p.Pitch), heading(p.DesDir, p.DesPitch)
	angle := math.Acos(math.Max(-1, math.Min(1, a.dot(b))))
	if angle <= step {
		setHeading(p, b)
		return
	}
	tangent := b.add(a.scale(-a.dot(b))).unit()
	if tangent.norm() < 0.5 {
		tangent = vec3{-math.Sin(p.Dir), math.Cos(p.Dir), 0}
	}
	v := a.scale(math.Cos(step)).add(tangent.scale(math.Sin(step)))
	setHeading(p, v)
}

// steeringAxes accepts only a finite vector inside the unit control disc.
func steeringAxes(x, y float64) (float64, float64) {
	if math.IsNaN(x) || math.IsInf(x, 0) || math.IsNaN(y) || math.IsInf(y, 0) {
		return 0, 0
	}
	x = math.Max(-1, math.Min(1, x))
	y = math.Max(-1, math.Min(1, y))
	if n := math.Hypot(x, y); n > 1 {
		x /= n
		y /= n
	}
	return x, y
}
func stopSteering(p *Player) {
	if !p.Steering {
		return
	}
	p.Steering = false
	p.SteerX, p.SteerY, p.SteerUntil = 0, 0, 0
	// Release holds the authoritative heading; no stale client snapshot can
	// pull the nose backwards, and no pending absolute course keeps turning.
	p.DesDir, p.DesPitch = p.Dir, p.Pitch
}
