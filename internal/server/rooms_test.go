package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// A room is its players' and its host's: to a stranger it isn't there, the same 404 as a code nobody has, until they
// join by its code; a locked room takes nobody new; and codes that miss run out, so that the codes can't be walked.
func TestRoomAccess(t *testing.T) {
	g := start(t)
	ana, bo, eve := g.player(), g.player(), g.player()
	for _, p := range []*player{ana, bo, eve} {
		p.call("POST", "/api/guest", map[string]any{})
	}
	_, out := ana.call("POST", "/api/rooms", map[string]string{"category": ""})
	code := out["code"].(string)
	bo.follow(code)

	// Eve hasn't joined: nothing of the room is hers, and nothing tells it from a room that isn't there.
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", "/people", nil}, {"POST", "/people", map[string]any{"key": 0}},
		{"POST", "/answer", map[string]any{"n": 0, "answer": map[string]any{"pick": 0}}},
		{"POST", "/start", nil}, {"POST", "/next", nil}, {"POST", "/finish", nil},
		{"POST", "/hold", map[string]any{"on": true}}, {"POST", "/lock", map[string]any{"on": true}},
		{"POST", "/settings", map[string]any{}}, {"POST", "/remove", map[string]any{"key": 1}},
	} {
		mine, _ := eve.call(c.method, "/api/rooms/"+code+c.path, c.body)
		none, _ := eve.call(c.method, "/api/rooms/999999"+c.path, c.body)
		if mine != 404 || none != 404 {
			t.Errorf("%s %s by a stranger: %d (no room: %d)", c.method, c.path, mine, none)
		}
	}
	req, _ := http.NewRequest("GET", g.url+"/api/rooms/"+code+"/events", nil)
	res, err := eve.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !strings.HasPrefix(string(body), "event: closed") {
		t.Fatalf("a stranger's stream joined the room: %q", body)
	}
	if v := ana.follow(code).until(func(map[string]any) bool { return true }); len(v["players"].([]any)) != 2 {
		t.Fatalf("a stream joined someone: %v", v["players"])
	}

	// Ana locks the room: Eve can't come in, Bo still comes back; open again, Eve comes in.
	if status, _ := bo.call("POST", "/api/rooms/"+code+"/lock", map[string]any{"on": true}); status != 403 {
		t.Fatalf("a player locked the room: %d", status)
	}
	if status, _ := ana.call("POST", "/api/rooms/"+code+"/lock", map[string]any{"on": true}); status != 200 {
		t.Fatalf("lock: %d", status)
	}
	if status, out := eve.call("POST", "/api/rooms/"+code+"/join", nil); status != 403 || out["error"] != "locked" {
		t.Fatalf("someone new in a locked room: %d %v", status, out)
	}
	if status, _ := bo.call("POST", "/api/rooms/"+code+"/join", nil); status != 200 {
		t.Fatalf("a player back in a locked room: %d", status)
	}
	ana.call("POST", "/api/rooms/"+code+"/lock", map[string]any{"on": false})
	eve.follow(code)
	if status, out := eve.call("GET", "/api/rooms/"+code+"/people", nil); status != 200 || len(out["add"].([]any)) != 2 {
		t.Fatalf("Eve's people, in the room: %d %v", status, out)
	}

	// Mallory walks the codes: a few misses, then nothing is looked up for her, an open room's code neither.
	mallory := g.player()
	mallory.call("POST", "/api/guest", map[string]any{})
	misses := 0
	for n := 100000; misses < roomMissesPlayer; n++ {
		c := fmt.Sprint(n)
		if c == code {
			continue
		}
		if status, _ := mallory.call("POST", "/api/rooms/"+c+"/join", nil); status != 404 {
			t.Fatalf("a miss: %d", status)
		}
		misses++
	}
	if status, out := mallory.call("POST", "/api/rooms/"+code+"/join", nil); status != 429 {
		t.Fatalf("a hit past the misses: %d %v", status, out)
	}
	// Someone else at the address still comes in; the address's own misses run out too, for anyone asking.
	if status, _ := g.player().call("GET", "/api/rooms/"+code, nil); status != 200 {
		t.Fatalf("an open room's code from the same address: %d", status)
	}
	for n := 200000; misses < roomMissesAddress; n++ {
		g.player().call("GET", fmt.Sprintf("/api/rooms/%d", n), nil)
		misses++
	}
	if status, _ := g.player().call("GET", "/api/rooms/"+code, nil); status != 429 {
		t.Fatalf("an open room's code past the address's misses: %d", status)
	}
}
