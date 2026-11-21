package play

import (
	"context"
	"database/sql"
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
	if len(db.Yours) != 1 || db.Yours[0].Until != store.Ms(w.now.Add(DuelFor)) || db.Yours[0].Opponent.Rights != 0 ||
		db.Yours[0].First {
		t.Fatalf("Bo's duels once sent: %+v", db)
	}
	if wt, _ := w.g.DuelsWaiting(ctx, bo); wt == nil || wt.ID != id || wt.N != 1 {
		t.Fatalf("waiting for Bo: %+v", wt)
	}
	// Bo's turn: nothing of how Ana's answers went before he plays them (they come with his run, as far as he goes).
	d, err := w.g.DuelOf(ctx, bo, id)
	if err != nil || d.State != DuelYours || len(d.Opponent.Marks) != 0 || d.Opponent.Rights != 0 || len(d.You.Marks) != 0 {
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
		*d.Record != (Record{Won: 1}) || len(d.Opponent.Marks) != Length || d.You.Rights != Length {
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

// A duel against a recording: a real game's ten, its marks for the screen as it's played (their score at the end),
// shown by its player, and no record against them.
func TestRecordingDuel(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	owner, gal := w.user(), w.user()
	if ready, err := w.g.RecordingReady(ctx, gal); ready || err != nil {
		t.Fatalf("a recording offered out of nothing: %v %v", ready, err)
	}
	if _, err := w.g.DuelRecording(ctx, gal, Even); !errors.Is(err, ErrNobody) {
		t.Fatalf("a recording out of nothing: %v", err)
	}
	s, err := w.g.StartTopic(ctx, owner, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(owner, s.ID, repeat(w.right, Length)...)
	w.wait(time.Minute)
	// One to play now, to anyone but its player; a visitor too.
	for who, want := range map[int64]bool{gal: true, 0: true, owner: false} {
		if ready, err := w.g.RecordingReady(ctx, who); ready != want || err != nil {
			t.Fatalf("a recording for %d: %v %v, want %v", who, ready, err, want)
		}
	}

	id, err := w.g.DuelRecording(ctx, gal, Even)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := w.g.DuelRecording(ctx, gal, Even); again != id {
		t.Fatalf("started again: %d, want %d", again, id)
	}
	// The one left unfinished is there to go on with, its recording in a duel under way.
	if ready, err := w.g.RecordingReady(ctx, gal); !ready || err != nil {
		t.Fatalf("an unfinished duel against a recording: %v %v", ready, err)
	}
	d, err := w.g.DuelOf(ctx, gal, id)
	if err != nil || !d.Recorded || d.Topic != "history" || d.State != DuelYours || d.Opponent.ID != owner ||
		len(d.Opponent.Marks) != 0 || d.You.Started {
		t.Fatalf("against a recording: %+v %v", d, err)
	}
	run := w.playSide(gal, id, repeat(w.wrong, Length))
	if !slices.Equal(w.picks(run), w.picks(s.ID)) {
		t.Fatal("not the recording's ten")
	}
	d, _ = w.g.DuelOf(ctx, gal, id)
	if d.State != DuelLost || d.Record != nil || !d.Opponent.Marks[0].Right || d.Opponent.Rights != Length || !d.You.Started {
		t.Fatalf("its result: %+v", d)
	}
	// Nothing of it is the recorded player's to see.
	if _, err := w.g.DuelOf(ctx, owner, id); !errors.Is(err, ErrNoDuel) {
		t.Fatalf("the recorded player sees the duel: %v", err)
	}
}

// Played second, the other side's answers come with the run as far as the player has come, and no further: of the
// question shown, only when they answered it; how it went for them, once the player's own answer is in; their score,
// at the end. The one who plays first hears nothing of the other's (there's nothing yet).
func TestDuelTheOtherAsFarAsYouGo(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.befriend(ana, bo)
	id, err := w.g.DuelFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	aRun := w.playSide(ana, id, nil)
	if s := w.show(ana, aRun); s.Against != nil {
		t.Fatalf("played first, the other's: %+v", s.Against)
	}
	w.play(ana, aRun, repeat(w.right, Length)...)

	run := w.playSide(bo, id, nil)
	if s, err := w.g.State(ctx, bo, run); err != nil || len(s.Against) != 0 {
		t.Fatalf("before the first question: %+v %v", s.Against, err)
	}
	for n := range 3 {
		s := w.show(bo, run)
		if len(s.Against) != n+1 || s.Against[n] != (DuelMark{Ms: s.Against[n].Ms}) || s.Against[n].Ms == 0 {
			t.Fatalf("question %d shown, the other's: %+v", n+1, s.Against)
		}
		w.wait(3 * time.Second)
		res, err := w.answer(bo, run, n, w.wrong(run, n))
		if err != nil {
			t.Fatal(err)
		}
		if a := res.State.Against; len(a) != n+1 || !a[n].Right || a[n].Ms == 0 {
			t.Fatalf("question %d answered, the other's: %+v", n+1, a)
		}
	}
	// Nothing of it in the duel either, until its end.
	if d, err := w.g.DuelOf(ctx, bo, id); err != nil || len(d.Opponent.Marks) != 0 {
		t.Fatalf("the duel mid-run: %+v %v", d.Opponent, err)
	}
	for n := 3; n < Length; n++ {
		w.show(bo, run)
		w.wait(3 * time.Second)
		res, err := w.answer(bo, run, n, w.wrong(run, n))
		if err != nil {
			t.Fatal(err)
		}
		if a := res.State.Against; len(a) != n+1 || !a[n].Right { // the last one too, as the run ends
			t.Fatalf("question %d answered, the other's: %+v", n+1, a)
		}
	}
	if d, err := w.g.DuelOf(ctx, bo, id); err != nil || len(d.Opponent.Marks) != Length || !d.Opponent.Marks[0].Right {
		t.Fatalf("the duel's end: %+v %v", d.Opponent, err)
	}
}

// The same right answers, and nothing else to break the tie: the quicker wins only by a second or more over the game
// (TieBand); closer, it's a draw.
// A friend has a week to play a duel sent to them (DECISIONS.md, „The direction“): open for six days and a half, gone
// past seven.
func TestDuelWaitsAWeek(t *testing.T) {
	if DuelFor != 7*24*time.Hour {
		t.Fatalf("a friend has %v", DuelFor)
	}
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	w.befriend(ana, bo)
	id, err := w.g.DuelFriend(ctx, ana, bo)
	if err != nil {
		t.Fatal(err)
	}
	w.playSide(ana, id, repeat(w.right, Length))
	w.wait(6*24*time.Hour + 12*time.Hour)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if d, _ := w.g.DuelOf(ctx, bo, id); d.State != DuelYours {
		t.Fatalf("after six days and a half: %+v", d)
	}
	w.wait(13 * time.Hour)
	if err := w.g.SettleDue(ctx); err != nil {
		t.Fatal(err)
	}
	if d, _ := w.g.DuelOf(ctx, bo, id); d.State != DuelExpired || d.Lapsed != "you" {
		t.Fatalf("after a week: %+v", d)
	}
}

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
		// Both as quick, answer for answer (the same score); Ana slower overall by `slower` (her line's).
		run := w.playSide(ana, id, nil)
		if _, err := w.db.Write.Exec(`UPDATE runs SET ms = ms + ? WHERE id = ?`, slower.Milliseconds(), run); err != nil {
			t.Fatal(err)
		}
		w.play(ana, run, repeat(w.right, Length)...)
		w.playSide(bo, id, repeat(w.right, Length))
		d, err := w.g.DuelOf(ctx, bo, id)
		if err != nil || d.You.Rights != d.Opponent.Rights {
			t.Fatalf("not the same score: %+v (%v)", d, err)
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

// A recording is chosen by the player's hidden mastery: „равен“ about as many right as they'd get on its ten,
// „по-силен“ a couple more, never fewer than one more.
func TestRecordingByLevel(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	weak, strong, gal := w.user(), w.user(), w.user()
	rights := func(n int) []func(int64, int) json.RawMessage {
		return append(repeat(w.right, n), repeat(w.wrong, Length-n)...)
	}
	weakRun := w.game(weak, nil, rights(5)...)
	strongRun := w.game(strong, nil, rights(10)...)
	w.wait(time.Minute)
	fit, err := w.g.recordingFit(ctx, gal, Even)
	if err != nil {
		t.Fatal(err)
	}
	h, _ := w.g.hardness(ctx)
	for _, run := range []int64{weakRun, strongRun} {
		if e := expectedRights(w.b, h, 0, w.picks(run)); e < 5.5 || e > 8 {
			t.Fatalf("a new player's expected right answers on game %d: %.1f", run, e)
		}
	}
	weakOff, weakEven := fit(w.b, w.picks(weakRun), 5)
	strongOff, _ := fit(w.b, w.picks(strongRun), 10)
	if weakOff >= strongOff {
		t.Fatal("five right isn't nearer a new player's level than ten")
	}
	if _, even := fit(w.b, w.picks(strongRun), 10); even {
		t.Fatal("ten right is „равен“ to a new player")
	}
	got := func(level string) (int64, string) {
		t.Helper()
		id, err := w.g.DuelRecording(ctx, gal, level)
		if err != nil {
			t.Fatal(err)
		}
		var ghost int64
		var kept sql.NullString
		if err := w.db.Read.QueryRow(`SELECT ghost_run, level FROM duels WHERE id = ?`, id).Scan(&ghost,
			&kept); err != nil {
			t.Fatal(err)
		}
		if _, err := w.db.Write.Exec(`DELETE FROM duels WHERE id = ?`, id); err != nil { // chosen again, fresh
			t.Fatal(err)
		}
		return ghost, kept.String
	}
	// Each the one nearest the level chosen, called by it only if it is that level.
	if g, kept := got(Even); g != weakRun || (kept == Even) != weakEven || kept == Stronger {
		t.Fatalf("„равен“: game %d (%q), want %d", g, kept, weakRun)
	}
	if g, kept := got(Stronger); g != strongRun || kept != Stronger {
		t.Fatalf("„по-силен“: game %d (%q), want %d", g, kept, strongRun)
	}
	// With none stronger, the nearest there is, called only „Запис“: never „по-силен“ for one that isn't.
	if _, err := w.db.Write.Exec(`UPDATE runs SET shadow = ? WHERE id = ?`, ShadowScript, strongRun); err != nil {
		t.Fatal(err)
	}
	if g, kept := got(Stronger); g != weakRun || kept != "" {
		t.Fatalf("„по-силен“ with none stronger: game %d (%q), want %d and no level", g, kept, weakRun)
	}
}
