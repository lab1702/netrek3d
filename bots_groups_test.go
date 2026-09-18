package main

import (
	"fmt"
	"testing"
)

func groupTestBots(t *testing.T, g *Game, n int) []*Player {
	t.Helper()
	bots := make([]*Player, n)
	for i := range bots {
		if !g.addBot(TeamFed) {
			t.Fatal("could not add bot")
		}
		p := g.players[i]
		p.X, p.Y, p.Z = 20000, 80000, 0
		bots[i] = p
	}
	return bots
}

func TestBotPlanetGroups(t *testing.T) {
	for _, n := range []int{2, 3, 4, 5, 7, 8, 10, 31, 32} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			g := NewGame()
			bots := groupTestBots(t, g, n)
			assignments := make(map[int]int)
			for _, p := range bots {
				g.botTournament(p, nil, maxSearch, combatThreat{})
				if p.Bot.PlanetTarget < 0 {
					t.Fatal("bot has no planet objective")
				}
				assignments[p.Bot.PlanetTarget]++
			}
			for target, size := range assignments {
				if size < 2 || size > 4 {
					t.Fatalf("%d bots formed groups %v: planet %d has %d ships", n, assignments, target, size)
				}
			}
			// Reversing decision order must not dissolve or merge these groups.
			for round := range 5 {
				g.tick += 10
				for i := len(bots) - 1; i >= 0; i-- {
					p := bots[i]
					before := p.Bot.PlanetTarget
					g.botTournament(p, nil, maxSearch, combatThreat{})
					if p.Bot.PlanetTarget != before {
						t.Fatalf("round %d: bot %d left its valid group", round, i)
					}
				}
			}
		})
	}
}

func TestFilledServerPlanetGroups(t *testing.T) {
	g := NewGame()
	g.clientsOnline = 1
	g.FillBots()
	g.checkTmode()
	// Exercise normal ticking, including decision cooldowns and random spawns.
	for range 20 {
		g.Tick()
	}
	for team := range 4 {
		groups := make(map[int]int)
		for _, p := range g.players {
			if p == nil || p.Team != team {
				continue
			}
			if !g.botHasPlanetTarget(p) {
				t.Fatalf("team %d bot %d has no active planet objective", team, p.ID)
			}
			groups[p.Bot.PlanetTarget]++
		}
		for target, size := range groups {
			if size < 2 || size > 4 {
				t.Fatalf("team %d groups %v: planet %d has %d ships", team, groups, target, size)
			}
		}
		t.Logf("team %d: %v", team, groups)
	}
}

func TestBotGroupsShareArmyObjectives(t *testing.T) {
	for _, carrying := range []bool{false, true} {
		t.Run(fmt.Sprintf("carrying=%v", carrying), func(t *testing.T) {
			g := NewGame()
			bots := groupTestBots(t, g, 7)
			if carrying {
				for _, pl := range g.planets {
					if pl.Owner != TeamFed {
						pl.Armies = 2
					}
				}
			}
			groups := make(map[int]int)
			for _, p := range bots {
				p.Kills = 1
				if carrying {
					p.Armies = 2
				}
				g.botTournament(p, nil, maxSearch, combatThreat{})
				if p.Bot.PlanetTarget < 0 {
					t.Fatal("bot has no army objective")
				}
				pl := g.planets[p.Bot.PlanetTarget]
				if (pl.Owner != p.Team) != carrying {
					t.Fatalf("wrong army objective: carrying=%v owner=%d", carrying, pl.Owner)
				}
				groups[pl.N]++
			}
			for _, n := range groups {
				if n < 2 || n > 4 {
					t.Fatalf("army objectives did not form small groups: %v", groups)
				}
			}
		})
	}
}

func TestBotRegroupsWhenPlanetObjectiveInvalid(t *testing.T) {
	for _, reason := range []string{"captured", "bombed out", "third space"} {
		t.Run(reason, func(t *testing.T) {
			g := NewGame()
			g.tmode = true
			bots := groupTestBots(t, g, 2)
			g.addBot(TeamRom)
			p, mate := bots[0], bots[1]
			for _, pl := range g.planets {
				pl.Armies = 4
			}
			old, next := g.planets[14], g.planets[18]
			old.Armies, next.Armies = 12, 12
			botReservePlanet(p, old, g.tick)
			botReservePlanet(mate, old, g.tick)
			switch reason {
			case "captured":
				old.Owner = TeamFed
			case "bombed out":
				old.Armies = 4
			case "third space":
				old.Owner = TeamKli
			}
			g.updateBot(p)
			if p.Bot.PlanetTarget != next.N {
				t.Fatalf("bot kept invalid objective %d instead of %d", p.Bot.PlanetTarget, next.N)
			}
		})
	}
}

func TestBotGroupsIgnoreInactiveReservations(t *testing.T) {
	for _, reason := range []string{"dead", "enemy", "expired", "released"} {
		t.Run(reason, func(t *testing.T) {
			g := NewGame()
			bots := groupTestBots(t, g, 5)
			near, far := g.planets[0], g.planets[10]
			for _, p := range bots[1:] {
				botReservePlanet(p, near, g.tick)
				switch reason {
				case "dead":
					p.Status = "dead"
				case "enemy":
					p.Team = TeamRom
				case "expired":
					p.Bot.PlanetTargetUntil = g.tick
				case "released":
					botReservePlanet(p, nil, g.tick)
				}
			}
			got := g.botGroupNearestPlanet(bots[0], func(pl *Planet) bool { return pl == near || pl == far })
			if got != near {
				t.Fatalf("%s reservations crowded out nearest planet", reason)
			}
		})
	}
}

func TestBotGroupsBalanceLimitedObjectives(t *testing.T) {
	g := NewGame()
	bots := groupTestBots(t, g, 12)
	groups := make(map[int]int)
	for _, p := range bots {
		pl := g.botGroupNearestPlanet(p, func(pl *Planet) bool { return pl.N < 2 })
		if pl == nil {
			t.Fatal("bot abandoned the only available objectives")
		}
		botReservePlanet(p, pl, g.tick)
		groups[pl.N]++
	}
	if groups[0] != 6 || groups[1] != 6 {
		t.Fatalf("limited objectives should share overflow evenly, got %v", groups)
	}
}

func TestBotPlanetGroupCruise(t *testing.T) {
	g := NewGame()
	bots := groupTestBots(t, g, 2)
	p, mate := bots[0], bots[1]
	p.Ship, mate.Ship = shipTypes["SC"], shipTypes["AS"]
	pl := g.planets[10]
	botReservePlanet(p, pl, g.tick)
	botReservePlanet(mate, pl, g.tick)
	if got := g.botGroupCruiseSpeed(p, pl, p.Ship.MaxSpeed); got != mate.Ship.MaxSpeed {
		t.Fatalf("scout should match assault ship's cruise speed, got %d", got)
	}
	if got := g.botGroupCruiseSpeed(p, pl, 2); got != 2 {
		t.Fatalf("group speed must not override approach braking, got %d", got)
	}
	mate.Z += botGroupRadius + 1
	if got := g.botGroupCruiseSpeed(p, pl, p.Ship.MaxSpeed); got != p.Ship.MaxSpeed {
		t.Fatalf("distant teammate on another altitude layer limited speed to %d", got)
	}
}

func TestBotReleasesGroupToRefuel(t *testing.T) {
	g := NewGame()
	g.tmode = true
	bots := groupTestBots(t, g, 2)
	p := bots[0]
	botReservePlanet(p, g.planets[10], g.tick)
	p.Fuel = 0
	g.updateBot(p)
	if g.botHasPlanetTarget(p) {
		t.Fatal("refueling bot kept its offensive reservation")
	}
}
