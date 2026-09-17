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
func clampPitch(p float64) float64 {
	if math.IsNaN(p) || math.IsInf(p, 0) {
		return 0
	}
	return math.Max(-math.Pi/2, math.Min(math.Pi/2, p))
}
func heading(yaw, pitch float64) vec3 {
	return vec3{math.Cos(yaw) * math.Cos(pitch), math.Sin(yaw) * math.Cos(pitch), math.Sin(pitch)}
}
func elevation(x, y, z, tx, ty, tz float64) float64 { return math.Atan2(tz-z, math.Hypot(tx-x, ty-y)) }
func (g *Game) placeOrbit(p *Player, pl *Planet, r vec3) {
	r = r.unit()
	p.X, p.Y, p.Z = pl.X+OrbDist*r.X, pl.Y+OrbDist*r.Y, pl.Z+OrbDist*r.Z
	v := p.OrbitNormal.cross(r).unit()
	p.Dir = math.Atan2(v.Y, v.X)
	p.Pitch = math.Atan2(v.Z, math.Hypot(v.X, v.Y))
	p.DesDir, p.DesPitch = p.Dir, p.Pitch
}
func turnToward(p *Player, step float64) {
	a, b := heading(p.Dir, p.Pitch), heading(p.DesDir, p.DesPitch)
	angle := math.Acos(math.Max(-1, math.Min(1, a.dot(b))))
	if angle <= step {
		p.Dir, p.Pitch = p.DesDir, p.DesPitch
		return
	}
	tangent := b.add(a.scale(-a.dot(b))).unit()
	if tangent.norm() < 0.5 {
		tangent = vec3{-math.Sin(p.Dir), math.Cos(p.Dir), 0}
	}
	v := a.scale(math.Cos(step)).add(tangent.scale(math.Sin(step)))
	p.Dir, p.Pitch = math.Atan2(v.Y, v.X), math.Atan2(v.Z, math.Hypot(v.X, v.Y))
}
