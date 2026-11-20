package play

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// heard keeps the duels' news the game hands its teller (Game.DuelNews).
type heard struct {
	mu   sync.Mutex
	news []DuelNews
}

func (h *heard) listen(g *Game) {
	g.DuelNews = func(_ context.Context, n DuelNews) {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.news = append(h.news, n)
	}
}

func (h *heard) take() []DuelNews {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := h.news
	h.news = nil
	return out
}

// playSide plays a player's side of a duel (PlayDuel), with these answers; it says their run.
func (w *world) playSide(user, duelID int64, answers []func(int64, int) json.RawMessage) int64 {
	w.t.Helper()
	run, err := w.g.PlayDuel(w.t.Context(), user, duelID)
	if err != nil {
		w.t.Fatalf("playing duel %d: %v", duelID, err)
	}
	if len(answers) > 0 {
		w.play(user, run, answers...)
	}
	return run
}

// recordingOf is the recorded game a duel is played against.
func (w *world) recordingOf(duel int64) int64 {
	w.t.Helper()
	var run int64
	if err := w.db.Read.QueryRow(`SELECT ghost_run FROM duels WHERE id = ?`, duel).Scan(&run); err != nil {
		w.t.Fatal(err)
	}
	return run
}

// duel is a duel a sends their friend b (made friends first, if they aren't), both sides played: a's answers, then
// b's. It says the duel.
func (w *world) duel(a, b int64, as, bs []func(int64, int) json.RawMessage) int64 {
	w.t.Helper()
	ctx := w.t.Context()
	if _, err := w.g.Friend(ctx, a, b); errors.Is(err, ErrNotFriends) {
		w.befriend(a, b)
	}
	id, err := w.g.DuelFriend(ctx, a, b)
	if err != nil {
		w.t.Fatalf("a duel: %v", err)
	}
	w.playSide(a, id, as)
	w.playSide(b, id, bs)
	return id
}

// A duel with a friend: the player plays first, and only then is it sent, the friend told; the friend plays the same
// ten, as the first was shown them, and the one who plays second sees both; the first is told the result. Each sees
// it from their side, with their record; a rematch is a new duel the other way round.
func TestFriendDuel(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	var h heard
	h.listen(w.g)
	ana, bo, cy := w.user(), w.user(), w.user()
	if _, err := w.g.DuelFriend(ctx, ana, bo); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("a duel with someone not a friend: %v", err)
	}
	w.befriend(ana, bo)
	id, err := w.g.DuelFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}

	// Not played by Ana yet: hers to play, nothing of it Bo's.
	if d, _ := w.g.DuelsOf(ctx, ana); len(d.Yours) != 1 || d.Yours[0].ID != id || !d.Yours[0].First {
		t.Fatalf("Ana's duels before she played: %+v", d)
	}
	if d, _ := w.g.DuelsOf(ctx, bo); len(d.Yours)+len(d.Theirs)+len(d.Played) != 0 {
		t.Fatalf("Bo sees a duel not sent yet: %+v", d)
	}
	if _, err := w.g.PlayDuel(ctx, bo, id); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("Bo plays a duel not sent yet: %v", err)
	}
	// Started again before she played it: the same duel, gone on with.
	if again, err := w.g.DuelFriend(ctx, ana, bo); err != nil || again != id {
		t.Fatalf("started again: %d %v, want %d", again, err, id)
	}

	aRun := w.playSide(ana, id, repeat(w.right, Length))
	if n := h.take(); len(n) != 1 || n[0] != (DuelNews{DuelID: id, From: ana, To: bo}) {
		t.Fatalf("Bo isn't told: %+v", n)
	}
	if d, _ := w.g.DuelsOf(ctx, ana); len(d.Theirs) != 1 || d.Theirs[0].State != DuelTheirs || len(d.Yours) != 0 {
		t.Fatalf("Ana's duels once sent: %+v", d)
	}
	db, _ := w.g.DuelsOf(ctx, bo)
	if len(db.Yours) != 1 || db.Yours[0].Until != store.Ms(w.now.Add(DuelFor)) || db.Yours[0].Opponent.Points != 0 ||
		db.Yours[0].First {
		t.Fatalf("Bo's duels once sent: %+v", db)
	}
	if wt, _ := w.g.DuelsWaiting(ctx, bo); wt == nil || wt.ID != id || wt.N != 1 {
		t.Fatalf("waiting for Bo: %+v", wt)
	}
	// Bo's turn: Ana's marks come for his screen, their points left for the end.
	d, err := w.g.DuelOf(ctx, bo, id)
	if err != nil || d.State != DuelYours || len(d.Opponent.Marks) != Length || d.Opponent.Marks[0].Points != 0 ||
		!d.Opponent.Marks[0].Right || d.Opponent.Points != 0 || len(d.You.Marks) != 0 {
		t.Fatalf("Bo's turn: %+v %v", d, err)
	}

	// Bo plays the same ten, as Ana was shown them.
	bRun := w.playSide(bo, id, repeat(w.wrong, Length))
	if !slices.Equal(w.picks(aRun), w.picks(bRun)) {
		t.Fatalf("not the same ten: %+v / %+v", w.picks(aRun), w.picks(bRun))
	}
	if n := h.take(); len(n) != 1 || n[0] != (DuelNews{DuelID: id, From: bo, To: ana, Played: true}) {
		t.Fatalf("Ana isn't told the result: %+v", n)
	}
	if wt, _ := w.g.DuelsWaiting(ctx, bo); wt != nil {
		t.Fatalf("still waiting: %+v", wt)
	}
	d, err = w.g.DuelOf(ctx, ana, id)
	if err != nil || d.State != DuelWon || d.Decided != 1 || !d.Friend || d.Record == nil ||
		*d.Record != (Record{Won: 1}) || len(d.Opponent.Marks) != Length || d.You.Points == 0 {
		t.Fatalf("Ana's result: %+v %v", d, err)
	}
	if db, _ = w.g.DuelsOf(ctx, bo); len(db.Played) != 1 || db.Played[0].State != DuelLost ||
		db.Played[0].Record == nil || *db.Played[0].Record != (Record{Lost: 1}) {
		t.Fatalf("Bo's played: %+v", db)
	}
	if _, err := w.g.PlayDuel(ctx, bo, id); !errors.Is(err, ErrDuelOver) {
		t.Fatalf("played again: %v", err)
	}
	if _, err := w.g.DuelOf(ctx, cy, id); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("Cy saw their duel: %v", err)
	}
	// The games know whom they were against.
	var opponent string
	var against int64
	_ = w.db.Read.QueryRow(`SELECT opponent, opponent_id FROM runs WHERE id = ?`, bRun).Scan(&opponent, &against)
	if against != ana {
		t.Fatalf("Bo's game against %q (%d)", opponent, against)
	}

	// A rematch: Bo sends one back, and wins it; the record has both.
	w.wait(time.Minute)
	re, err := w.g.DuelFriend(ctx, bo, ana)
	if err != nil || re == id {
		t.Fatalf("a rematch: %d %v", re, err)
	}
	w.playSide(bo, re, repeat(w.right, Length))
	w.playSide(ana, re, repeat(w.wrong, Length))
	if d, _ := w.g.DuelOf(ctx, ana, re); d.State != DuelLost || *d.Record != (Record{Won: 1, Lost: 1}) {
		t.Fatalf("the rematch: %+v", d)
	}
	if list, _ := w.g.FriendsOf(ctx, ana); len(list) != 1 || list[0].Won != 1 || list[0].Lost != 1 {
		t.Fatalf("Ana's friends: %+v", list)
	}
}

// A player has DuelsToOne duels open with one friend at most, and starts DuelsADay a day.
func TestDuelLimits(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, cy := w.user(), w.user(), w.user()
	w.befriend(ana, bo)
	w.befriend(ana, cy)
	var ids []int64
	for range DuelsToOne {
		id, err := w.g.DuelFriend(ctx, ana, bo)
		if err != nil {
			t.Fatal(err)
		}
		w.playSide(ana, id, repeat(w.right, Length))
		ids = append(ids, id)
	}
	if _, err := w.g.DuelFriend(ctx, ana, bo); !errors.Is(err, ErrDuelsToOne) {
		t.Fatalf("one more with Bo: %v", err)
	}
	// Bo sending Ana one is his: the other way round has its own.
	if _, err := w.g.DuelFriend(ctx, bo, ana); err != nil {
		t.Fatalf("Bo to Ana: %v", err)
	}
	// One played back, there's room for another.
	w.playSide(bo, ids[0], repeat(w.wrong, Length))
	if _, err := w.g.DuelFriend(ctx, ana, bo); err != nil {
		t.Fatalf("after Bo played one: %v", err)
	}

	// The day's: counted by the duels started today, whatever came of them.
	now := store.Ms(w.now)
	for range DuelsADay {
		if _, err := w.db.Write.Exec(`INSERT INTO duels (kind, questions, a_id, b_id, created_at, expires_at, ended_at,
			outcome) VALUES ('person', '[]', ?, ?, ?, ?, ?, 'expired')`, ana, cy, now, now, now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := w.g.DuelFriend(ctx, ana, cy); !errors.Is(err, ErrDuelsADay) {
		t.Fatalf("past the day's: %v", err)
	}
	w.wait(24 * time.Hour)
	if _, err := w.g.DuelFriend(ctx, ana, cy); err != nil {
		t.Fatalf("the next day: %v", err)
	}
}

// A friend has DuelFor from when a duel is sent: past it, one they never started lapses (and says who didn't play);
// one they left half-way counts as it stood. One whose first side was never finished goes, as if never started.
func TestDuelLapses(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.befriend(ana, bo)
	settle := func() {
		t.Helper()
		if err := w.g.SettleDue(ctx); err != nil {
			t.Fatal(err)
		}
		w.g.AftersDone(ctx)
	}

	// Sent two days after it was started: the friend's time runs from then.
	lapses, _ := w.g.DuelFriend(ctx, ana, bo)
	w.wait(2 * 24 * time.Hour)
	w.playSide(ana, lapses, repeat(w.right, Length))
	if d, _ := w.g.DuelOf(ctx, bo, lapses); d.Until != store.Ms(w.now.Add(DuelFor)) {
		t.Fatalf("its time: %d, want %d", d.Until, store.Ms(w.now.Add(DuelFor)))
	}
	// Bo starts another, answers three, and leaves it.
	halfway, _ := w.g.DuelFriend(ctx, ana, bo)
	w.playSide(ana, halfway, repeat(w.wrong, Length))
	w.playSide(bo, halfway, repeat(w.right, 3))
	// One Ana never finishes.
	left, _ := w.g.DuelFriend(ctx, bo, ana)
	w.playSide(bo, left, repeat(w.right, 2))

	w.wait(DuelFor - time.Minute)
	settle()
	if d, _ := w.g.DuelOf(ctx, bo, lapses); d.State != DuelYours {
		t.Fatalf("lapsed early: %+v", d)
	}
	w.wait(2 * time.Minute)
	settle()
	if d, _ := w.g.DuelOf(ctx, ana, lapses); d.State != DuelExpired || d.Lapsed != "they" {
		t.Fatalf("Ana's lapsed duel: %+v", d)
	}
	if d, _ := w.g.DuelOf(ctx, bo, lapses); d.State != DuelExpired || d.Lapsed != "you" {
		t.Fatalf("Bo's lapsed duel: %+v", d)
	}
	if _, err := w.g.PlayDuel(ctx, bo, lapses); !errors.Is(err, ErrDuelOver) {
		t.Fatalf("a lapsed duel played: %v", err)
	}
	// Three right and the rest not played beat ten wrong.
	if d, _ := w.g.DuelOf(ctx, bo, halfway); d.State != DuelWon || d.You.Rights != 3 {
		t.Fatalf("Bo's half-played duel: %+v", d)
	}
	if there, _ := w.g.DuelExists(ctx, left); there {
		t.Fatal("a duel never sent is still there")
	}
	if d, _ := w.g.DuelsOf(ctx, bo); len(d.Yours)+len(d.Theirs) != 0 {
		t.Fatalf("open duels left: %+v", d)
	}
}

// A duel against a recording: a real game's ten, its marks for the screen as it's played (their points at the end),
// shown by its player, and no record against them.
func TestRecordingDuel(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	owner, gal := w.user(), w.user()
	if _, err := w.g.DuelRecording(ctx, gal); !errors.Is(err, ErrNobody) {
		t.Fatalf("a recording out of nothing: %v", err)
	}
	s, err := w.g.StartTopic(ctx, owner, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(owner, s.ID, repeat(w.right, Length)...)
	w.wait(time.Minute)

	id, err := w.g.DuelRecording(ctx, gal)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := w.g.DuelRecording(ctx, gal); again != id {
		t.Fatalf("started again: %d, want %d", again, id)
	}
	d, err := w.g.DuelOf(ctx, gal, id)
	if err != nil || !d.Recorded || d.Topic != "history" || d.State != DuelYours || d.Opponent.ID != owner ||
		len(d.Opponent.Marks) != Length || d.Opponent.Marks[0].Ms == 0 || d.Opponent.Marks[0].Points != 0 {
		t.Fatalf("against a recording: %+v %v", d, err)
	}
	run := w.playSide(gal, id, repeat(w.wrong, Length))
	if !slices.Equal(w.picks(run), w.picks(s.ID)) {
		t.Fatal("not the recording's ten")
	}
	d, _ = w.g.DuelOf(ctx, gal, id)
	if d.State != DuelLost || d.Record != nil || d.Opponent.Marks[0].Points == 0 || d.Opponent.Points == 0 {
		t.Fatalf("its result: %+v", d)
	}
	// Nothing of it is the recorded player's to see.
	if _, err := w.g.DuelOf(ctx, owner, id); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("the recorded player sees the duel: %v", err)
	}
}

// The same points: the quicker wins only by a second or more over the game (TieBand); closer, it's a draw.
func TestTieBand(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	duel := func(slower time.Duration) DuelView {
		t.Helper()
		if _, err := w.g.Friend(ctx, ana, bo); err != nil {
			w.befriend(ana, bo)
		}
		id, _ := w.g.DuelFriend(ctx, ana, bo)
		// Both as quick, answer for answer (the same points); Ana slower overall by `slower` (her line's).
		run := w.playSide(ana, id, nil)
		if _, err := w.db.Write.Exec(`UPDATE runs SET ms = ms + ? WHERE id = ?`, slower.Milliseconds(), run); err != nil {
			t.Fatal(err)
		}
		w.play(ana, run, repeat(w.right, Length)...)
		w.playSide(bo, id, repeat(w.right, Length))
		d, err := w.g.DuelOf(ctx, bo, id)
		if err != nil || d.You.Points != d.Opponent.Points {
			t.Fatalf("not the same points: %+v (%v)", d, err)
		}
		return d
	}
	if d := duel(900 * time.Millisecond); d.State != DuelDraw {
		t.Fatalf("0,9 s apart: %+v", d)
	}
	if d := duel(1500 * time.Millisecond); d.State != DuelWon {
		t.Fatalf("1,5 s apart: %+v", d)
	}
}
