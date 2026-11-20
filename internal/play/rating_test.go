package play

import (
	"cmp"
	"slices"
	"strings"
	"testing"
)

// The rating's board: the best in order, and a viewer further down at their place, counted as the order has it
// (rating, then more rated games, then who came first); of everyone, and of the viewer's friends.
func TestRatingBoardPlaces(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	type player struct {
		id            int64
		rating, rated int
	}
	var all []player
	for i := range BoardSize + 30 {
		p := player{id: w.user(), rating: 1000 + (i*37)%23*10, rated: MinRatedGames + i%3}
		if i%7 == 0 {
			p.rated = MinRatedGames - 1 // not on the board yet, however good
			p.rating = 2000
		}
		if _, err := w.db.Write.Exec(`UPDATE users SET rating = ?, rated = ? WHERE id = ?`, p.rating, p.rated, p.id); err != nil {
			t.Fatal(err)
		}
		all = append(all, p)
	}
	var board []player
	for _, p := range all {
		if p.rated >= MinRatedGames {
			board = append(board, p)
		}
	}
	slices.SortFunc(board, func(a, b player) int {
		return cmp.Or(cmp.Compare(b.rating, a.rating), cmp.Compare(b.rated, a.rated), cmp.Compare(a.id, b.id))
	})
	placeOf := func(list []player, id int64) int {
		return slices.IndexFunc(list, func(p player) bool { return p.id == id }) + 1
	}

	// Of everyone, for nobody, someone in the best and each of the rest; and for a player not on the board.
	for _, viewer := range append([]int64{0, board[3].id, all[0].id}, func() (ids []int64) {
		for _, p := range board[BoardSize:] {
			ids = append(ids, p.id)
		}
		return ids
	}()...) {
		b, err := w.g.RatingBoard(ctx, viewer, false)
		if err != nil {
			t.Fatal(err)
		}
		if len(b.Top) != BoardSize || b.Top[0].Value != board[0].rating || b.Top[BoardSize-1].Value != board[BoardSize-1].rating {
			t.Fatalf("viewer %d: the best %d, from %d to %d", viewer, len(b.Top), b.Top[0].Value, b.Top[len(b.Top)-1].Value)
		}
		if want := placeOf(board, viewer); b.Place != want || (want > 0) != (b.Mine != nil) {
			t.Fatalf("viewer %d: place %d, want %d (mine %+v)", viewer, b.Place, want, b.Mine)
		}
		if b.Mine != nil && (!b.Mine.Me || b.Mine.Value != board[b.Place-1].rating) {
			t.Fatalf("viewer %d: %+v", viewer, b.Mine)
		}
	}

	// Of friends: the viewer far down among everyone, and their place among their friends.
	viewer := board[len(board)-1]
	friends := []player{viewer}
	for _, p := range []player{board[0], board[BoardSize+2], board[len(board)-2], all[0]} {
		w.befriend(viewer.id, p.id)
		if p.rated >= MinRatedGames {
			friends = append(friends, p)
		}
	}
	slices.SortFunc(friends, func(a, b player) int {
		return cmp.Or(cmp.Compare(b.rating, a.rating), cmp.Compare(b.rated, a.rated), cmp.Compare(a.id, b.id))
	})
	b, err := w.g.RatingBoard(ctx, viewer.id, true)
	if err != nil || len(b.Top) != len(friends) || b.Place != placeOf(friends, viewer.id) {
		t.Fatalf("among friends: %d shown, place %d; want %d, %d (%v)", len(b.Top), b.Place, len(friends),
			placeOf(friends, viewer.id), err)
	}
}

// The board's query is read from its index (0052's users_rated), in order: the index's rows are those of
// MinRatedGames, and the query must say so in the same words.
func TestRatingBoardIndexed(t *testing.T) {
	w := setup(t)
	rows, err := w.db.Read.Query(`EXPLAIN QUERY PLAN SELECT u.id, u.rating FROM users u WHERE ` + onRatingBoard + `
		ORDER BY u.rating DESC, u.rated DESC, u.id LIMIT 50`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	if p := strings.Join(plan, "; "); !strings.Contains(p, "users_rated") || strings.Contains(p, "TEMP B-TREE") {
		t.Fatalf("the rating's board is planned as %q", p)
	}
}

// The peak counts from the game that places a rating on: what the placement games reached is no division. Placed in
// Сребро after a start in Злато's range, a player is told Сребро and unlocks only what it does, and is told Злато when
// they reach it.
func TestPeakFromPlacement(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	_, _ = w.g.NewsOf(ctx, ana, 0)
	// Two placement games to go, wins behind them: a rating and a peak in Злато's range.
	if _, err := w.db.Write.Exec(`UPDATE users SET rating = 1080, peak = 1080, rated = ? WHERE id = ?`,
		MinRatedGames-2, ana); err != nil {
		t.Fatal(err)
	}
	duel := func(won bool) {
		t.Helper()
		l, err := w.g.StartLive(ctx, ana, w.user()) // someone new each time: every duel rated
		if err != nil {
			t.Fatal(err)
		}
		mine, theirs := w.wrong, w.right
		if won {
			mine, theirs = w.right, w.wrong
		}
		w.play(ana, l.Runs[0], repeat(mine, Length)...)
		w.play(l.Users[1], l.Runs[1], repeat(theirs, Length)...)
	}
	standing := func() (rating, peak, rated int) {
		_ = w.db.Read.QueryRow(`SELECT rating, peak, rated FROM users WHERE id = ?`, ana).Scan(&rating, &peak, &rated)
		return
	}
	duel(false)
	duel(false) // the tenth: placed
	rating, peak, rated := standing()
	if rated != MinRatedGames || rating >= Divisions[2].From || peak != rating {
		t.Fatalf("placed: rating %d, peak %d, %d games", rating, peak, rated)
	}
	n, err := w.g.NewsOf(ctx, ana, 0)
	if err != nil || n.Division == nil || n.Division.ID != "silver" || !n.Placed {
		t.Fatalf("placed in Сребро: %+v %v", n.Division, err)
	}
	for _, u := range n.Unlocks {
		if u.From == "дивизия Злато" {
			t.Fatalf("Злато's unlocked, placed in Сребро: %+v", n.Unlocks)
		}
	}
	for rating < Divisions[2].From {
		duel(true)
		rating, peak, _ = standing()
	}
	if peak != rating {
		t.Fatalf("Злато reached: rating %d, peak %d", rating, peak)
	}
	if n, _ = w.g.NewsOf(ctx, ana, 0); n.Division == nil || n.Division.ID != "gold" || n.Placed {
		t.Fatalf("Злато reached, not told: %+v", n.Division)
	}
}
