package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

// During a game, someone new comes in by the room's link (its key after #), not by the code alone, which counts as a
// miss; a player back comes in by the code as ever (review 2026-11-18, S3).
func TestComingIntoAGameUnderWay(t *testing.T) {
	g := start(t)
	ana, eve := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	eve.call("POST", "/api/guest", map[string]any{})
	_, out := ana.call("POST", "/api/rooms", map[string]any{"length": 5})
	code := out["code"].(string)
	url, key, _ := strings.Cut(out["url"].(string), "#")
	if !strings.HasSuffix(url, "/r/"+code) || len(key) < 16 {
		t.Fatalf("the room's link: %v", out["url"])
	}
	as := ana.follow(code)
	if v := as.until(func(map[string]any) bool { return true }); v["key"] != key {
		t.Fatalf("the key in the host's view: %v", v["key"])
	}
	if status, _ := ana.call("POST", "/api/rooms/"+code+"/start", nil); status != 200 {
		t.Fatal(status)
	}
	if status, out := eve.call("GET", "/api/rooms/"+code, nil); status != 403 || out["error"] != "started" {
		t.Fatalf("by the code alone, mid-game: %d %v", status, out)
	}
	if status, out := eve.call("POST", "/api/rooms/"+code+"/join", map[string]any{}); status != 403 || out["error"] != "started" {
		t.Fatalf("joining by the code alone, mid-game: %d %v", status, out)
	}
	if status, _ := eve.call("GET", "/api/rooms/"+code+"?key="+key, nil); status != 200 {
		t.Fatalf("by the link, mid-game: %d", status)
	}
	if status, _ := eve.call("POST", "/api/rooms/"+code+"/join", map[string]any{"key": key}); status != 200 {
		t.Fatalf("joining by the link, mid-game: %d", status)
	}
	if status, _ := eve.call("GET", "/api/rooms/"+code, nil); status != 200 {
		t.Fatalf("a player back, by the code: %d", status)
	}
}

// One screen more than a player's cap closes their oldest, which is told it moved (S6); and starting games is limited,
// so that starting and ending them over and over earns nothing (S19).
func TestRoomScreensAndStarts(t *testing.T) {
	g := start(t)
	ana := g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	_, out := ana.call("POST", "/api/rooms", map[string]any{"length": 5})
	code := out["code"].(string)
	first := ana.follow(code)
	first.until(func(map[string]any) bool { return true })
	for range 5 { // maxScreensEach in all
		ana.stream("/api/rooms/" + code + "/events")
	}
	for {
		line, err := first.r.ReadString('\n')
		if err != nil {
			t.Fatalf("the oldest screen wasn't told it moved: %v", err)
		}
		if strings.HasPrefix(line, "event: moved") {
			break
		}
	}

	for i := range roomStartsPlayer {
		if status, _ := ana.call("POST", "/api/rooms/"+code+"/start", nil); status == 429 {
			t.Fatalf("start %d refused", i+1)
		}
	}
	if status, out := ana.call("POST", "/api/rooms/"+code+"/start", nil); status != 429 {
		t.Fatalf("past the starts an hour: %d %v", status, out)
	}
}

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

// A name asked as a player comes into a room is the room's alone: the others see it there, and nowhere else does the
// player go by it (their own name stays as it was); coming back without one keeps it.
func TestRoomName(t *testing.T) {
	g := start(t)
	ana, bo := g.player(), g.player()
	ana.call("POST", "/api/guest", map[string]any{})
	_, b := bo.call("POST", "/api/guest", map[string]any{})
	own := b["user"].(map[string]any)["name"].(string)
	_, out := ana.call("POST", "/api/rooms", map[string]string{"category": ""})
	code := out["code"].(string)
	ana.follow(code)
	names := func() []string {
		t.Helper()
		v := ana.stream("/api/rooms/" + code + "/events").until(func(map[string]any) bool { return true })
		var out []string
		for _, p := range v["players"].([]any) {
			out = append(out, p.(map[string]any)["name"].(string))
		}
		return out
	}
	for _, bad := range []string{"АЛМАНАХ", "Ивaн", "x"} {
		if status, _ := bo.call("POST", "/api/rooms/"+code+"/join", map[string]string{"name": bad}); status != 400 {
			t.Errorf("a room name %q: %d", bad, status)
		}
	}
	if status, out := bo.call("POST", "/api/rooms/"+code+"/join", map[string]string{"name": "  Бояна   П. "}); status != 200 {
		t.Fatalf("join with a name: %d %v", status, out)
	}
	if got := names(); len(got) != 2 || got[1] != "Бояна П." {
		t.Fatalf("the room's names: %v", got)
	}
	if _, me := bo.call("GET", "/api/me", nil); me["user"].(map[string]any)["name"] != own {
		t.Fatalf("Bo's own name changed: %v", me["user"])
	}
	// Back without a name (a reload): still Бояна П. in the room.
	if status, _ := bo.call("POST", "/api/rooms/"+code+"/join", nil); status != 200 {
		t.Fatal(status)
	}
	if got := names(); got[1] != "Бояна П." {
		t.Fatalf("the room's names after a return: %v", got)
	}
}
