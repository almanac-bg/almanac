package room

import (
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// Of as many points, the quicker stands first, whoever joined first; level on both, they share a place.
func TestTiesByTime(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo, cy := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}, Player{ID: 3, Name: "Цвети"}
		r, _ := hub.Open(ana, Settings{Length: 5})
		_ = r.Join(bo)
		_ = r.Join(cy)
		for _, p := range []Player{ana, bo, cy} {
			s, _ := r.Follow(p.ID)
			defer r.Unfollow(s)
		}
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		// Each misses the first question: Bo and Cy at once, Ana a second later. Nought points each.
		_ = r.Answer(bo.ID, 0, answer(r, false))
		_ = r.Answer(cy.ID, 0, answer(r, false))
		time.Sleep(time.Second)
		_ = r.Answer(ana.ID, 0, answer(r, false))
		v := r.View(ana.ID)
		if v.Phase != Reveal {
			t.Fatalf("not shown: %+v", v)
		}
		names, places := []string{}, []int{}
		for _, p := range v.Players {
			if p.Points != 0 {
				t.Fatalf("points for a wrong answer: %+v", p)
			}
			names, places = append(names, p.Name), append(places, p.Place)
		}
		if names[2] != "Ана" || places[0] != 1 || places[1] != 1 || places[2] != 3 {
			t.Fatalf("the order: %v %v", names, places)
		}
	})
}

// Between games the host chooses again what the room plays; the code and the players stay.
func TestChangeBetweenGames(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		hub := NewHub(sample(t))
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		r, _ := hub.Open(ana, Settings{Length: 5, Mix: play.MixEasy})
		_ = r.Join(bo)
		topic := hub.bank().Categories[0].ID
		if err := r.Change(bo.ID, Settings{Category: topic, Length: 10}); !errors.Is(err, ErrNotYours) {
			t.Fatalf("a guest changed it: %v", err)
		}
		if err := r.Change(ana.ID, Settings{Category: "nothing"}); !errors.Is(err, play.ErrNoTopic) {
			t.Fatalf("no such topic: %v", err)
		}
		if err := r.Change(ana.ID, Settings{Length: 7}); !errors.Is(err, play.ErrRoomGame) {
			t.Fatalf("seven questions: %v", err)
		}
		if err := r.Change(ana.ID, Settings{Category: topic, Length: 10, Lead: true}); err != nil {
			t.Fatal(err)
		}
		v := r.View(bo.ID)
		if v.Category != topic || v.Length != 10 || v.Mix != play.MixMixed || v.Lead || len(v.Players) != 2 {
			t.Fatalf("after the change: %+v", v)
		}
		sa, _ := r.Follow(ana.ID)
		sb, _ := r.Follow(bo.ID)
		defer r.Unfollow(sa)
		defer r.Unfollow(sb)
		if err := r.Start(ana.ID); err != nil {
			t.Fatal(err)
		}
		if err := r.Change(ana.ID, Settings{}); !errors.Is(err, ErrNotNow) {
			t.Fatalf("changed under way: %v", err)
		}
		if v := r.View(ana.ID); v.Total != 10 || v.Question.Category != topic {
			t.Fatalf("the game: %d questions, of %q", v.Total, v.Question.Category)
		}
	})
}
