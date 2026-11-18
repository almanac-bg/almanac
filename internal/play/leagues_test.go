package play

import (
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"
)

// A league's last group, too small for a race, races with the group before it: one race, in the week and at its close;
// a league's one group, small, is no race.
func TestRaces(t *testing.T) {
	got := races([]leagueGroup{{1, 0, 20}, {2, 0, 20}, {3, 0, 4}, {4, 1, 3}, {5, 2, 20}, {6, 2, 5}})
	want := []leagueRace{{[]int64{1}, 0, 20}, {[]int64{2, 3}, 0, 24}, {[]int64{4}, 1, 3}, {[]int64{5}, 2, 20},
		{[]int64{6}, 2, 5}}
	if len(got) != len(want) {
		t.Fatalf("races: %+v", got)
	}
	for i := range want {
		if !slices.Equal(got[i].groups, want[i].groups) || got[i].tier != want[i].tier || got[i].size != want[i].size {
			t.Fatalf("race %d: %+v, want %+v", i, got[i], want[i])
		}
	}
}

// A week's standings go by right answers on the day's questions, then points, then who came first; a small last group
// is shown, ranked, moved and paid with the group before it.
func TestLeagueRacesByRightAnswers(t *testing.T) {
	w := setup(t) // Thursday, 12 November
	ctx := t.Context()
	week := "2026-11-09"
	group := func() int64 {
		res, err := w.db.Write.Exec(`INSERT INTO league_groups (week, tier) VALUES (?, 1)`, week)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := res.LastInsertId()
		return id
	}
	member := func(group int64, joined int64, rights, points int) int64 {
		p := w.user()
		_, _ = w.db.Write.Exec(`UPDATE users SET league = 1 WHERE id = ?`, p)
		if _, err := w.db.Write.Exec(`INSERT INTO league_members (week, user_id, group_id, joined_at) VALUES (?, ?, ?, ?)`,
			week, p, group, joined); err != nil {
			t.Fatal(err)
		}
		if _, err := w.db.Write.Exec(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at, points, rights)
			VALUES (?, 'day', '2026-11-10', '[]', 0, 1, ?, ?)`, p, points, rights); err != nil {
			t.Fatal(err)
		}
		return p
	}
	// A full group of Средна гора, then a second with three: a fast 8 of 10 (more points) against a careful 9.
	first := group()
	var full []int64
	for i := range GroupSize {
		full = append(full, member(first, int64(i), 5, 5000-10*i))
	}
	second := group()
	fast := member(second, 100, 8, 9660)
	careful := member(second, 101, 9, 9000)
	late := member(second, 102, 9, 9000) // as careful, but came later
	v, err := w.g.LeagueOf(ctx, fast)
	if err != nil || !v.In || v.Size != GroupSize+3 || len(v.Group) != GroupSize+3 || v.Up != 5 || v.Down != 5 {
		t.Fatalf("the small group's race: %+v %v", v, err)
	}
	if v.Group[0].Rights != 9 || v.Group[0].Points != 9000 || v.Place != 3 || !v.Group[2].Me || v.Group[2].Points != 9660 {
		t.Fatalf("by right answers first: %+v", v.Group[:4])
	}
	if mine, _ := w.g.LeagueOf(ctx, full[0]); mine.Size != GroupSize+3 || mine.Place != 4 {
		t.Fatalf("the full group sees the same race: size %d, place %d", mine.Size, mine.Place)
	}

	// The close keeps them as one race, though the batch is smaller than it: its groups go together.
	closeBatch = 5
	t.Cleanup(func() { closeBatch = 500 })
	var told []LeagueNews
	w.g.LeagueNews = func(_ context.Context, _ *sql.Tx, n []LeagueNews) error { told = append(told, n...); return nil }
	w.now = time.Date(2026, 11, 16, 0, 30, 0, 0, Bulgaria)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	place := map[int64]LeagueNews{}
	for _, n := range told {
		place[n.To] = n
	}
	if len(told) != GroupSize+3 || place[careful].Place != 1 || place[late].Place != 2 || place[fast].Place != 3 ||
		place[careful].Of != GroupSize+3 || place[careful].XP != LeaguePay[0] || place[careful].Now.Tier != 2 ||
		place[full[0]].Place != 4 || place[full[0]].Now.Tier != 2 || place[full[1]].Now.Tier != 2 ||
		place[full[GroupSize-1]].Now.Tier != 0 {
		t.Fatalf("the race's end: %+v", told)
	}
}
