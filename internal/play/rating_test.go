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
