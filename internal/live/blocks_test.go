package live

import (
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/almanac-bg/almanac/internal/play"
)

// Two one of whom has blocked the other are never met live, whoever blocked and whoever asked first: they wait on,
// and the first meets the next one to come; the other's wait runs out (nobody recorded here).
func TestBlockedNeverMeet(t *testing.T) {
	for _, blockerFirst := range []bool{true, false} {
		synctest.Test(t, func(t *testing.T) {
			w := setup(t)
			blocker, blocked, cy := w.user(), w.user(), w.user()
			var tag string
			if err := w.db.Read.QueryRow(`SELECT tag FROM users WHERE id = ?`, blocked.ID).Scan(&tag); err != nil {
				t.Fatal(err)
			}
			if _, err := w.g.Block(t.Context(), blocker.ID, tag); err != nil {
				t.Fatal(err)
			}
			first, second := blocker, blocked
			if !blockerFirst {
				first, second = blocked, blocker
			}
			s1 := w.hub.Seek(first)
			defer s1.Leave()
			time.Sleep(time.Second)
			s2 := w.hub.Seek(second)
			defer s2.Leave()
			time.Sleep(Wait / 2) // past the widest band: any other two would have met by now
			if settled(s1) || settled(s2) {
				t.Fatalf("blocker first %v: a blocked pair met", blockerFirst)
			}
			sc := w.hub.Seek(cy)
			defer sc.Leave()
			if !settled(sc) || sc.Match == nil || sc.Match != s1.Match {
				t.Fatalf("blocker first %v: the next to come didn't meet the first waiting: %v", blockerFirst, sc.Err)
			}
			<-s2.Done()
			if !errors.Is(s2.Err, play.ErrNobody) {
				t.Fatalf("blocker first %v: the other, after the wait: %v %v", blockerFirst, s2.Match, s2.Err)
			}
			_ = sc.Match.Leave(cy.ID)
			_ = sc.Match.Leave(first.ID)
		})
	}
}
