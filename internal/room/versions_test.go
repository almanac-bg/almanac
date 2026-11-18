package room

import (
	"bytes"
	"encoding/json"
	"testing"
	"testing/synctest"
	"time"
)

// A game just over comes back after a restart only as it was dealt: one of its questions changed since (another
// version), its room comes back to its lobby.
func TestRestoredAsDealt(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		bank := sample(t)
		hub := NewHub(bank)
		ana, bo := Player{ID: 1, Name: "Ана"}, Player{ID: 2, Name: "Бо"}
		over, _ := hub.Open(ana, "", Settings{})
		_ = over.Join(bo, "")
		_ = over.Start(ana.ID)
		for over.View(ana.ID).Phase != End {
			if v := over.View(ana.ID); v.Phase == Question && !v.Players[0].Answered {
				_ = over.Answer(ana.ID, v.N, answer(over, true))
			}
			time.Sleep(time.Second)
			synctest.Wait()
		}
		var saved bytes.Buffer
		if err := hub.Save(&saved); err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(saved.Bytes(), []byte(`"v":"`)) {
			t.Fatal("the picks are saved without their versions")
		}
		for _, changed := range []bool{false, true} {
			data := saved.Bytes()
			if changed {
				var rooms []map[string]any
				_ = json.Unmarshal(data, &rooms)
				rooms[0]["picks"].([]any)[0].(map[string]any)["v"] = "0000000000000000"
				data, _ = json.Marshal(rooms)
			}
			next := NewHub(bank)
			if _, err := next.Restore(bytes.NewReader(data)); err != nil {
				t.Fatal(err)
			}
			r, _ := next.Get(over.Code())
			if want := map[bool]Phase{false: End, true: Lobby}[changed]; r.View(ana.ID).Phase != want {
				t.Fatalf("changed %v: restored as %v", changed, r.View(ana.ID).Phase)
			}
		}
	})
}
