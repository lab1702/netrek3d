package main

const (
	botGroupSize   = 3
	botGroupMax    = 4
	botGroupRadius = 15000.0
	botPlanetLease = 100 // ten seconds; renewed while pursuing the objective
)

func botReservePlanet(p *Player, pl *Planet, tick int64) {
	if pl == nil {
		p.Bot.PlanetTarget = -1
		p.Bot.PlanetTargetUntil = 0
		return
	}
	p.Bot.PlanetTarget = pl.N
	p.Bot.PlanetTargetUntil = tick + botPlanetLease
}

func (g *Game) botHasPlanetTarget(p *Player) bool {
	return p.Bot != nil && p.Bot.PlanetTarget >= 0 &&
		p.Bot.PlanetTarget < len(g.planets) && p.Bot.PlanetTargetUntil > g.tick
}

// Choose objectives in small groups. Count reservations, not just ships already
// at the planet, so a full server spreads out on its first decision. Nearby
// teammates fill pairs/trios before opening another destination; a fourth can
// join when nobody remains nearby to accompany a new group. If all legal
// objectives are full, balance the overflow instead of abandoning army play.
// This only selects: callers reserve the objective they actually pursue.
func (g *Game) botGroupPlanet(p *Player, score func(*Planet) (float64, bool)) *Planet {
	counts := make([]int, len(g.planets))
	nearby := make([]bool, len(g.planets))
	waiting := false
	for _, q := range g.players {
		if q == nil || q == p || q.Status != "alive" || q.Team != p.Team || q.Bot == nil {
			continue
		}
		close := length3(q.X-p.X, q.Y-p.Y, q.Z-p.Z) < botGroupRadius
		if g.botHasPlanetTarget(q) {
			n := q.Bot.PlanetTarget
			counts[n]++
			nearby[n] = nearby[n] || close
		} else if close && !q.RepairMode && q.Bot.DefenseTarget < 0 &&
			q.Damage <= q.Ship.MaxDamage/2 && q.Fuel >= q.Ship.MaxFuel/3 {
			waiting = true
		}
	}

	// Keep an established group together while its objective remains useful.
	// Re-evaluate lone ships and overcrowded targets so they can regroup.
	if g.botHasPlanetTarget(p) {
		n := p.Bot.PlanetTarget
		if counts[n] > 0 && counts[n] < botGroupMax {
			if _, ok := score(g.planets[n]); ok {
				return g.planets[n]
			}
		}
	}

	var best *Planet
	bestOverflow, bestGroup, bestScore := MaxPlayers, -1, -maxSearch
	for _, pl := range g.planets {
		s, ok := score(pl)
		if !ok {
			continue
		}
		n := counts[pl.N]
		overflow := max(0, n+1-botGroupMax)
		group := 1 // a fresh destination
		switch {
		case nearby[pl.N] && n > 0 && n < botGroupSize:
			group = 3 // join one or two nearby teammates
		case nearby[pl.N] && n == botGroupSize && !waiting:
			group = 2 // avoid sending the last ship off alone
		case n >= botGroupSize:
			group = 0 // start another small group when possible
		}
		if overflow < bestOverflow || overflow == bestOverflow &&
			(group > bestGroup || group == bestGroup && s > bestScore) {
			best, bestOverflow, bestGroup, bestScore = pl, overflow, group, s
		}
	}
	return best
}

func (g *Game) botGroupNearestPlanet(p *Player, ok func(*Planet) bool) *Planet {
	return g.botGroupPlanet(p, func(pl *Planet) (float64, bool) {
		return -length3(pl.X-p.X, pl.Y-p.Y, pl.Z-p.Z), ok(pl)
	})
}

// Match the slower nearby group members during the long cruise. Orbit approach,
// evasion, combat and ships separated from the group retain their own speeds.
func (g *Game) botGroupCruiseSpeed(p *Player, pl *Planet, speed int) int {
	if !g.botHasPlanetTarget(p) || p.Bot.PlanetTarget != pl.N ||
		length3(pl.X-p.X, pl.Y-p.Y, pl.Z-p.Z) < 10000 {
		return speed
	}
	for _, q := range g.players {
		if q == nil || q == p || q.Status != "alive" || q.Team != p.Team ||
			!g.botHasPlanetTarget(q) || q.Bot.PlanetTarget != pl.N || q.Orbiting >= 0 {
			continue
		}
		if length3(q.X-p.X, q.Y-p.Y, q.Z-p.Z) < botGroupRadius {
			speed = min(speed, q.Ship.MaxSpeed)
		}
	}
	return speed
}
