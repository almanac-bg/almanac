package live

import (
	"testing"
	"testing/synctest"
)

// Two who ask from one network are paired as anyone, and play a friendly: each one's game keeps the network it was
// asked from (Player.Net), and the duel moves no rating, saying why (play/fair.go; review 2026-11-18, S20). From two
// networks, it's rated.
func TestOneNetworkPlaysAFriendly(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := setup(t)
		duel := func(netA, netB string) (int64, [2]int64) {
			ana, bo := w.user(), w.user()
			ana.Net, bo.Net = []byte(netA), []byte(netB)
			sa, sb := w.hub.Seek(ana), w.hub.Seek(bo)
			<-sb.Done()
			m := sa.Match
			if m == nil || sb.Match != m {
				t.Fatalf("not paired: %v %v", sa.Err, sb.Err)
			}
			fa, _ := m.Follow(ana.ID)
			defer m.Unfollow(fa)
			fb, _ := m.Follow(bo.ID)
			defer m.Unfollow(fb)
			if v := toEnd(m, ana.ID, ana.ID, bo.ID); v.Phase != PhaseEnd {
				t.Fatalf("the end: %+v", v)
			}
			return m.ID(), [2]int64{m.sides[0].run, m.sides[1].run}
		}
		id, runs := duel("home", "home")
		for _, run := range runs {
			var net []byte
			if err := w.db.Read.QueryRow(`SELECT net FROM run_nets WHERE run_id = ?`, run).Scan(&net); err != nil || string(net) != "home" {
				t.Fatalf("run %d's network: %q %v", run, net, err)
			}
		}
		var rated bool
		var why string
		_ = w.db.Read.QueryRow(`SELECT rated, coalesce(unrated, '') FROM duels WHERE id = ?`, id).Scan(&rated, &why)
		if rated || why != "network" {
			t.Fatalf("from one network: rated %v, %q", rated, why)
		}
		id, _ = duel("home", "phone")
		_ = w.db.Read.QueryRow(`SELECT rated, coalesce(unrated, '') FROM duels WHERE id = ?`, id).Scan(&rated, &why)
		if !rated || why != "" {
			t.Fatalf("from two networks: rated %v, %q", rated, why)
		}
	})
}
