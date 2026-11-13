package play

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
	"github.com/almanac-bg/almanac/internal/store"
)

type world struct {
	t    *testing.T
	g    *Game
	db   *store.DB
	b    *bank.Bank
	now  time.Time
	next int64
}

func setup(t *testing.T) *world {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "game.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	b, problems := bank.Load("../../bank/sample")
	if b == nil {
		t.Fatal(problems)
	}
	w := &world{t: t, db: db, b: b, now: time.Date(2026, 11, 12, 10, 0, 0, 0, Bulgaria)}
	w.g = &Game{DB: db, Bank: func() *bank.Bank { return b }, Now: func() time.Time { return w.now }}
	return w
}

func (w *world) user() int64 {
	w.t.Helper()
	w.next++
	res, err := w.db.Write.Exec(`INSERT INTO users (name, tag, created_at, seen_at) VALUES (?, ?, 0, 0)`,
		"Играч", fmt.Sprintf("player%d", w.next))
	if err != nil {
		w.t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func (w *world) wait(d time.Duration) { w.now = w.now.Add(d) }

// picks are a run's questions, as stored.
func (w *world) picks(runID int64) []Pick {
	var s string
	_ = w.db.Read.QueryRow(`SELECT questions FROM runs WHERE id = ?`, runID).Scan(&s)
	var p []Pick
	_ = json.Unmarshal([]byte(s), &p)
	return p
}

// right is the right answer to a run's question n, as the player would give it.
func (w *world) right(runID int64, n int) json.RawMessage {
	p := w.picks(runID)[n]
	q, _ := w.b.Get(p.ID)
	reveal, _ := json.Marshal(q.Deal(p.Seed).Reveal())
	var r struct {
		Pick  *int     `json:"pick"`
		Value *float64 `json:"value"`
		Order []int    `json:"order"`
		Truth *bool    `json:"truth"`
		Pairs []int    `json:"pairs"`
	}
	_ = json.Unmarshal(reveal, &r)
	var a any
	switch {
	case r.Pick != nil:
		a = map[string]int{"pick": *r.Pick}
	case r.Value != nil:
		a = map[string]float64{"value": *r.Value}
	case r.Truth != nil:
		a = map[string]bool{"truth": *r.Truth}
	case r.Pairs != nil:
		a = map[string][]int{"pairs": r.Pairs}
	default:
		a = map[string][]int{"order": r.Order}
	}
	out, _ := json.Marshal(a)
	return out
}

// wrong is a wrong answer to it (a choice's other option, a number far off, the other of true or not, every pair of
// a match joined one along, an order backwards).
func (w *world) wrong(runID int64, n int) json.RawMessage {
	var r map[string]any
	_ = json.Unmarshal(w.right(runID, n), &r)
	switch {
	case r["pick"] != nil:
		r["pick"] = (int(r["pick"].(float64)) + 1) % bank.ChoiceOptions
	case r["value"] != nil:
		p := w.picks(runID)[n]
		q, _ := w.b.Get(p.ID)
		num := q.(*bank.Number)
		r["value"] = num.Answer + 10*num.Tolerance*num.Answer // far off on either scale
	case r["truth"] != nil:
		r["truth"] = !r["truth"].(bool)
	case r["pairs"] != nil:
		p := r["pairs"].([]any)
		r["pairs"] = append(p[1:], p[0])
	default:
		o := r["order"].([]any)
		for i, j := 0, len(o)-1; i < j; i, j = i+1, j-1 {
			o[i], o[j] = o[j], o[i]
		}
	}
	out, _ := json.Marshal(r)
	return out
}

func (w *world) play(user, runID int64, answers ...func(int64, int) json.RawMessage) State {
	w.t.Helper()
	var s State
	for n, answer := range answers {
		if _, err := w.g.Show(w.t.Context(), user, runID); err != nil {
			w.t.Fatal(err)
		}
		w.wait(3 * time.Second)
		res, err := w.g.Answer(w.t.Context(), user, runID, n, answer(runID, n))
		if err != nil {
			w.t.Fatalf("answer %d: %v", n, err)
		}
		s = res.State
	}
	return s
}

func repeat(f func(int64, int) json.RawMessage, n int) []func(int64, int) json.RawMessage {
	out := make([]func(int64, int) json.RawMessage, n)
	for i := range out {
		out[i] = f
	}
	return out
}

func TestTheDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	s, err := w.g.StartDay(ctx, ana)
	if err != nil {
		t.Fatal(err)
	}
	if again, _ := w.g.StartDay(ctx, ana); again.ID != s.ID {
		t.Fatal("a second run of the same day")
	}
	if s.Total != Length || s.Day != "2026-11-12" {
		t.Fatalf("the day: %+v", s)
	}
	picks := w.picks(s.ID)
	topics := map[string]bool{}
	for i, p := range picks {
		q, _ := w.b.Get(p.ID)
		topics[q.Base().Category] = true
		if want := daySlots[i].typ; q.Base().Type != want && (want == "order" || want == "number") {
			t.Errorf("place %d is a %s, not a %s", i, q.Base().Type, want)
		}
	}
	if len(topics) != Length {
		t.Errorf("the day's questions come from %d topics", len(topics))
	}
	other, _ := w.g.StartDay(ctx, bo)
	if p := w.picks(other.ID); p[0] != picks[0] || p[9] != picks[9] {
		t.Fatal("two players got different days")
	}

	// Tomorrow's questions are new ones.
	w.wait(24 * time.Hour)
	tomorrow, _ := w.g.StartDay(ctx, ana)
	for _, p := range w.picks(tomorrow.ID) {
		for _, old := range picks {
			if p.ID == old.ID {
				t.Fatalf("%s again the next day", p.ID)
			}
		}
	}
}

func TestQuestionTime(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	s, _ := w.g.StartDay(ctx, u)
	if _, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0)); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("answered before the question was shown: %v", err)
	}
	shown, _ := w.g.Show(ctx, u, s.ID)
	if shown.Question == nil || shown.Question.LeftMs != shown.Question.LimitMs {
		t.Fatalf("shown: %+v", shown.Question)
	}
	if v, _ := json.Marshal(shown.Question.View); string(v) == "" || json.Valid(v) == false {
		t.Fatal("no view")
	}
	// Showing it again (a refresh) doesn't give more time.
	w.wait(5 * time.Second)
	again, _ := w.g.Show(ctx, u, s.ID)
	if again.Question.LeftMs != again.Question.LimitMs-5000 {
		t.Fatalf("after 5 s a refresh shows %d ms left of %d", again.Question.LeftMs, again.Question.LimitMs)
	}
	if _, err := w.g.Answer(ctx, u, s.ID, 1, w.right(s.ID, 0)); !errors.Is(err, ErrOutOfStep) {
		t.Fatalf("answered the wrong question: %v", err)
	}
	if _, err := w.g.Answer(ctx, u, s.ID, 0, json.RawMessage(`{"pick":9,"value":"x"}`)); !errors.Is(err, ErrBadAnswer) {
		t.Fatalf("a broken answer: %v", err)
	}
	res, err := w.g.Answer(ctx, u, s.ID, 0, w.right(s.ID, 0))
	if err != nil || res.Points != MaxPoints || !res.Right || res.State.At != 1 || res.Reveal == nil {
		t.Fatalf("the right answer: %+v %v", res, err)
	}

	// Left showing past its time: unanswered, as soon as anyone looks.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(time.Minute)
	st, _ := w.g.State(ctx, u, s.ID)
	if st.At != 2 || st.Question != nil || len(st.Trail) != 2 || st.Trail[1].Points != 0 {
		t.Fatalf("after its time ran out: %+v", st)
	}

	// An answer a little late (within the grace) counts; one later doesn't.
	_, _ = w.g.Show(ctx, u, s.ID)
	w.wait(Limit(w.question(s.ID, 2)) + Grace/2)
	if res, _ := w.g.Answer(ctx, u, s.ID, 2, w.right(s.ID, 2)); res.TimedOut || res.Points == 0 {
		t.Fatalf("an answer within the grace: %+v", res)
	}

	// Another player's run is as good as missing.
	if _, err := w.g.State(ctx, w.user(), s.ID); !errors.Is(err, ErrNoRun) {
		t.Fatalf("someone else's run: %v", err)
	}
}

func (w *world) question(runID int64, n int) bank.Question {
	q, _ := w.b.Get(w.picks(runID)[n].ID)
	return q
}

func TestBoardAndStreak(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.user(), w.user(), w.user()
	for _, p := range []struct {
		user  int64
		right int
	}{{ana, 7}, {bo, 10}, {vi, 3}} {
		s, _ := w.g.StartDay(ctx, p.user)
		answers := append(repeat(w.right, p.right), repeat(w.wrong, Length-p.right)...)
		if end := w.play(p.user, s.ID, answers...); !end.Done || end.Rights != p.right {
			t.Fatalf("finished %+v, want %d right", end, p.right)
		}
	}
	b, err := w.g.BoardOf(ctx, "2026-11-12", ana)
	if err != nil {
		t.Fatal(err)
	}
	if b.Players != 3 || b.Place != 2 || b.Top[0].Rights != 10 || !b.Top[1].Me || b.Mine.Rights != 7 {
		t.Fatalf("board %+v", b)
	}
	if n, _ := w.g.Streak(ctx, ana); n != 1 {
		t.Fatalf("streak %d after one day", n)
	}
	thursday := [7]bool{3: true} // 2026-11-12, Monday first
	if week, _ := w.g.Week(ctx, ana); week != thursday {
		t.Fatalf("week %v after Thursday", week)
	}
	w.wait(24 * time.Hour)
	if n, _ := w.g.Streak(ctx, ana); n != 1 {
		t.Fatalf("streak %d the next morning, before playing", n)
	}
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	if n, _ := w.g.Streak(ctx, ana); n != 2 {
		t.Fatalf("streak %d after two days", n)
	}
	w.wait(48 * time.Hour)
	if n, _ := w.g.Streak(ctx, ana); n != 0 {
		t.Fatalf("streak %d after missing a day", n)
	}
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{3: true, 4: true} {
		t.Fatalf("week %v on Sunday, after Thursday and Friday", week)
	}
	w.wait(24 * time.Hour)
	if week, _ := w.g.Week(ctx, ana); week != [7]bool{} {
		t.Fatalf("week %v on a new Monday", week)
	}
}

func TestTopics(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	if _, err := w.g.StartTopic(ctx, u, "astrology"); !errors.Is(err, ErrNoTopic) {
		t.Fatalf("an unknown topic: %v", err)
	}
	first, err := w.g.StartTopic(ctx, u, "history")
	if err != nil {
		t.Fatal(err)
	}
	w.play(u, first.ID, repeat(w.right, Length)...)
	firstPicks := map[string]bool{}
	for _, p := range w.picks(first.ID) {
		if q, _ := w.b.Get(p.ID); q.Base().Category != "history" {
			t.Fatalf("%s in a history run", p.ID)
		}
		firstPicks[p.ID] = true
	}
	// The next run starts with what the player hasn't seen.
	second, _ := w.g.StartTopic(ctx, u, "history")
	unseen := len(w.b.Live("history", "")) - len(firstPicks)
	fresh := 0
	for _, p := range w.picks(second.ID) {
		if !firstPicks[p.ID] {
			fresh++
		}
	}
	if fresh < min(unseen, Length) {
		t.Fatalf("%d fresh questions of %d unseen", fresh, unseen)
	}
	all, err := w.g.StartTopic(ctx, u, "")
	if err != nil || all.Total != Length {
		t.Fatalf("all topics: %+v %v", all, err)
	}
}

func TestMergeKeepsTheAccountsDay(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	guest, owner := w.user(), w.user()
	gs, _ := w.g.StartDay(ctx, guest)
	topic, _ := w.g.StartTopic(ctx, guest, "science")
	os, _ := w.g.StartDay(ctx, owner)
	err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, guest, owner) })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.State(ctx, owner, topic.ID); err != nil {
		t.Fatal("the guest's topic run didn't move")
	}
	if _, err := w.g.State(ctx, owner, gs.ID); !errors.Is(err, ErrNoRun) {
		t.Fatal("the guest's day replaced the account's")
	}
	if _, err := w.g.State(ctx, owner, os.ID); err != nil {
		t.Fatal(err)
	}
}

func TestStats(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	u := w.user()
	empty, err := w.g.StatsOf(ctx, u)
	if err != nil || empty.Games != 0 || len(empty.Topics) != 0 || empty.Recent == nil {
		t.Fatalf("a newcomer's stats: %+v %v", empty, err)
	}
	day, _ := w.g.StartDay(ctx, u)
	w.play(u, day.ID, append(repeat(w.right, 6), repeat(w.wrong, 4)...)...)
	topic, _ := w.g.StartTopic(ctx, u, "music")
	w.play(u, topic.ID, repeat(w.right, Length)...)
	s, err := w.g.StatsOf(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	if s.Streak != 1 || s.Days != 1 || s.Games != 2 || s.Answers != 20 || s.Right != 16 || len(s.Recent) != 2 {
		t.Fatalf("stats %+v", s)
	}
	if s.Topics[0].Category != "music" || s.Topics[0].Answers < 10 || s.Recent[0].Kind != "topic" || s.Recent[0].Total != Length {
		t.Fatalf("topics %+v, recent %+v", s.Topics, s.Recent)
	}
}

func TestRecordingsAndDuels(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo := w.user(), w.user()
	if rec, err := w.g.RecordingFor(ctx, bo); err != nil || rec != nil {
		t.Fatalf("a recording with nothing played: %v %v", rec, err)
	}
	run, _ := w.g.StartTopic(ctx, ana, "")
	w.play(ana, run.ID, repeat(w.right, Length)...)
	if rec, _ := w.g.RecordingFor(ctx, ana); rec != nil {
		t.Fatal("a player got their own game as a recording")
	}
	rec, err := w.g.RecordingFor(ctx, bo)
	if err != nil || rec == nil || len(rec.Picks) != Length || len(rec.Answers) != Length || rec.Answers[0].Ms != 3000 {
		t.Fatalf("Bo's recording: %+v %v", rec, err)
	}
	// What the recording gave grades right again, dealt the same way.
	q, _ := w.b.Get(rec.Picks[0].ID)
	if g, err := q.Deal(rec.Picks[0].Seed).Grade(rec.Answers[0].Shown); err != nil || !g.Right {
		t.Fatalf("the recorded answer: %+v %v", g, err)
	}

	d := Duel{UserID: bo, Picks: rec.Picks, Opponent: "Ана", Recorded: true, Outcome: "lost"}
	for _, p := range rec.Picks {
		d.Answers = append(d.Answers, DuelAnswer{QuestionID: p.ID, Ms: 15000})
	}
	if err := w.g.SaveDuel(ctx, d); err != nil {
		t.Fatal(err)
	}
	s, _ := w.g.StatsOf(ctx, bo)
	if s.Games != 1 || s.Answers != Length || s.Recent[0].Kind != "duel" || s.Duels != 1 || s.Won != 0 {
		t.Fatalf("Bo's stats after a duel: %+v", s)
	}
	if err := w.g.SaveDuel(ctx, Duel{UserID: bo, Picks: rec.Picks}); err == nil {
		t.Fatal("kept a duel without its answers")
	}
}

func TestFriends(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi := w.user(), w.user(), w.user()
	code, err := w.g.InviteCode(ctx, ana)
	if again, _ := w.g.InviteCode(ctx, ana); err != nil || len(code) != 8 || again != code {
		t.Fatalf("Ana's invite: %q, again %q, %v", code, again, err)
	}
	if _, _, err := w.g.Befriend(ctx, ana, code); !errors.Is(err, ErrOwnInvite) {
		t.Fatalf("befriended oneself: %v", err)
	}
	if _, _, err := w.g.Befriend(ctx, bo, "nosuchcd"); !errors.Is(err, ErrNoInvite) {
		t.Fatalf("a made-up invite: %v", err)
	}
	if id, _, err := w.g.Befriend(ctx, bo, code); err != nil || id != ana {
		t.Fatalf("Bo befriends Ana: %d %v", id, err)
	}
	if _, _, err := w.g.Befriend(ctx, bo, code); err != nil {
		t.Fatalf("befriending again: %v", err)
	}
	for _, p := range [][2]int64{{ana, bo}, {bo, ana}} {
		if _, err := w.g.Friend(ctx, p[0], p[1]); err != nil {
			t.Fatalf("%d and %d aren't friends both ways: %v", p[0], p[1], err)
		}
	}
	if _, err := w.g.Friend(ctx, ana, vi); !errors.Is(err, ErrNotFriends) {
		t.Fatalf("Ana and Vi: %v", err)
	}

	// The day: nobody's board until a friend has played; then both, best first.
	day := w.g.Today()
	if b, _ := w.g.FriendsBoard(ctx, day, ana); b != nil {
		t.Fatalf("a friends' board before anyone played: %+v", b)
	}
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, append(repeat(w.right, 4), repeat(w.wrong, Length-4)...)...)
	if b, _ := w.g.FriendsBoard(ctx, day, ana); b != nil {
		t.Fatalf("a friends' board with only oneself on it: %+v", b)
	}
	s, _ = w.g.StartDay(ctx, bo)
	w.play(bo, s.ID, repeat(w.right, Length)...)
	b, err := w.g.FriendsBoard(ctx, day, ana)
	if err != nil || len(b) != 2 || b[0].Me || !b[1].Me || b[0].Rights != Length {
		t.Fatalf("the friends' board: %+v %v", b, err)
	}

	// A duel between them counts in the record, from each side.
	picks := w.picks(s.ID)
	for _, d := range []Duel{
		{UserID: ana, OpponentID: bo, Opponent: "Бо", Outcome: "won"},
		{UserID: bo, OpponentID: ana, Opponent: "Ана", Outcome: "lost"},
	} {
		d.Picks = picks
		for _, p := range picks {
			d.Answers = append(d.Answers, DuelAnswer{QuestionID: p.ID, Ms: 1000})
		}
		if err := w.g.SaveDuel(ctx, d); err != nil {
			t.Fatal(err)
		}
	}
	list, err := w.g.FriendsOf(ctx, ana)
	if err != nil || len(list) != 1 || list[0].ID != bo || list[0].Won != 1 || list[0].Lost != 0 ||
		list[0].Today == nil || list[0].Today.Rights != Length {
		t.Fatalf("Ana's friends: %+v %v", list, err)
	}
	if list, _ := w.g.FriendsOf(ctx, bo); len(list) != 1 || list[0].Lost != 1 {
		t.Fatalf("Bo's friends: %+v", list)
	}

	// A guest who signs in to an account brings their friends and their record along.
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, bo, vi) }); err != nil {
		t.Fatal(err)
	}
	if list, _ := w.g.FriendsOf(ctx, ana); len(list) != 1 || list[0].ID != vi || list[0].Won != 1 {
		t.Fatalf("Ana's friends after Bo signed in as Vi: %+v", list)
	}
	if err := w.g.Unfriend(ctx, vi, ana); err != nil {
		t.Fatal(err)
	}
	if list, _ := w.g.FriendsOf(ctx, ana); len(list) != 0 {
		t.Fatalf("still friends: %+v", list)
	}
}

func TestProgress(t *testing.T) {
	for _, c := range []struct{ points, level, from, to int }{
		{0, 1, 0, 1000}, {999, 1, 0, 1000}, {1000, 2, 1000, 2500}, {2499, 2, 1000, 2500}, {2500, 3, 2500, 4500},
	} {
		if l, f, to := LevelOf(c.points); l != c.level || f != c.from || to != c.to {
			t.Fatalf("LevelOf(%d) = %d %d %d", c.points, l, f, to)
		}
	}
	w := setup(t)
	ctx := t.Context()
	ana := w.user()
	p, err := w.g.ProgressOf(ctx, ana)
	if err != nil || p.Level != 1 || p.Avatar != DefaultAvatar(ana) || len(p.Achievements) != len(Achievements) ||
		p.Achievements[0].At != 0 {
		t.Fatalf("a new player's progress: %+v %v", p, err)
	}
	for _, s := range p.Shapes {
		if locked := slices.Contains(Unlockable, s.Shape); s.Locked != locked || (locked && s.How == "") {
			t.Fatalf("a new player's shape %+v", s)
		}
	}
	if err := w.g.SetLook(ctx, ana, ptr("star-gold"), nil); !errors.Is(err, ErrNotYours) {
		t.Fatalf("a locked shape: %v", err)
	}

	// A perfect day: the achievements come with the last answer, and a level with the points.
	s, _ := w.g.StartDay(ctx, ana)
	w.play(ana, s.ID, repeat(w.right, Length)...)
	n, err := w.g.NewsOf(ctx, ana)
	ids := []string{}
	for _, a := range n.Achievements {
		ids = append(ids, a.ID)
	}
	if err != nil || !slices.Contains(ids, "perfect") || !n.LevelUp || n.Level != 2 || n.From != 1000 {
		t.Fatalf("news after a perfect day: %+v %v", n, err)
	}
	if again, _ := w.g.NewsOf(ctx, ana); len(again.Achievements) != 0 || again.LevelUp {
		t.Fatalf("the same news twice: %+v", again)
	}

	// What's earned may be worn; what isn't, can't.
	for _, c := range []struct {
		avatar, title *string
		ok            bool
	}{
		{ptr("star-gold"), ptr("perfect"), true},
		{ptr("crown-gold"), nil, false},
		{ptr("star-black"), nil, false},
		{ptr("bogus"), nil, false},
		{nil, ptr("duel1"), false},
		{nil, ptr("nosuch"), false},
	} {
		if err := w.g.SetLook(ctx, ana, c.avatar, c.title); (err == nil) != c.ok {
			t.Fatalf("SetLook(%v, %v): %v", c.avatar, c.title, err)
		}
	}
	b, _ := w.g.BoardOf(ctx, w.g.Today(), ana)
	if top := b.Top[0]; top.Avatar != "star-gold" || top.Title != "Десет от десет" || top.Level < 2 {
		t.Fatalf("the board shows %+v", top)
	}
	if err := w.g.SetLook(ctx, ana, nil, ptr("")); err != nil {
		t.Fatal(err)
	}
	if look, _ := w.g.LookOf(ctx, ana); look.Title != "" || look.Avatar != "star-gold" {
		t.Fatalf("after taking the title off: %+v", look)
	}

	// A guest who signs in brings what they earned.
	vi := w.user()
	if err := w.db.Tx(ctx, func(tx *sql.Tx) error { return Merge(tx, ana, vi) }); err != nil {
		t.Fatal(err)
	}
	if p, _ := w.g.ProgressOf(ctx, vi); p.Avatar != "star-gold" || !slices.ContainsFunc(p.Achievements, func(e Earned) bool { return e.ID == "perfect" && e.At > 0 }) {
		t.Fatalf("after the merge: %+v", p)
	}
}

func ptr(s string) *string { return &s }

func TestFriendRequests(t *testing.T) {
	w := setup(t)
	ctx := t.Context()
	ana, bo, vi, gal := w.user(), w.user(), w.user(), w.user()
	tag := func(id int64) string { return fmt.Sprintf("player%d", id-ana+1) }
	_, _ = w.db.Write.Exec(`UPDATE users SET email = 'vi@example.com' WHERE id = ?`, vi)
	_, _ = w.db.Write.Exec(`UPDATE users SET email = 'ana@example.com' WHERE id = ?`, ana)

	// By tag: Bo is asked by name, and answers yes.
	if _, err := w.g.Request(ctx, ana, "nosuchplayer", false); !errors.Is(err, ErrNoPlayer) {
		t.Fatalf("an unknown tag: %v", err)
	}
	if _, err := w.g.Request(ctx, ana, tag(ana), false); !errors.Is(err, ErrOwnInvite) {
		t.Fatalf("asked oneself: %v", err)
	}
	if sent, err := w.g.Request(ctx, ana, tag(bo), false); err != nil || sent.Friends || sent.Name != "Играч" {
		t.Fatalf("to Bo: %+v %v", sent, err)
	}
	in, _, _ := w.g.Requests(ctx, bo)
	_, out, _ := w.g.Requests(ctx, ana)
	if len(in) != 1 || in[0].Tag != tag(ana) || len(out) != 1 || out[0].Tag != tag(bo) {
		t.Fatalf("Bo's in %+v, Ana's out %+v", in, out)
	}
	if _, err := w.g.Accept(ctx, ana, in[0].ID); !errors.Is(err, ErrNoRequest) {
		t.Fatalf("the sender accepted her own request: %v", err)
	}
	if _, err := w.g.Accept(ctx, bo, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.g.Friend(ctx, ana, bo); err != nil {
		t.Fatalf("not friends after yes: %v", err)
	}
	if n, _ := w.g.RequestsWaiting(ctx, bo); n != 0 {
		t.Fatalf("%d still waiting", n)
	}

	// By email: the sender isn't told whether anyone has the address — the same answer either way.
	known, err := w.g.Request(ctx, ana, "vi@example.com", true)
	unknown, err2 := w.g.Request(ctx, ana, "nobody@example.com", true)
	if err != nil || err2 != nil || known != unknown || known.Name != "" {
		t.Fatalf("by email: %+v %v, %+v %v", known, err, unknown, err2)
	}
	if n, _ := w.g.RequestsWaiting(ctx, vi); n != 1 {
		t.Fatalf("Vi has %d waiting", n)
	}
	// Vi asks Ana back by her email: Ana asked first, so they're friends at once.
	if sent, err := w.g.Request(ctx, vi, "ana@example.com", true); err != nil || !sent.Friends {
		t.Fatalf("asking back: %+v %v", sent, err)
	}
	if _, out, _ := w.g.Requests(ctx, ana); len(out) != 1 || out[0].Email != "nobody@example.com" {
		t.Fatalf("Ana's requests left: %+v", out)
	}

	// Gal asks Bo; Bo says no, and Gal's request is simply gone.
	_, _ = w.g.Request(ctx, gal, tag(bo), false)
	in, _, _ = w.g.Requests(ctx, bo)
	if err := w.g.Withdraw(ctx, bo, in[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, out, _ := w.g.Requests(ctx, gal); len(out) != 0 {
		t.Fatalf("Gal's requests: %+v", out)
	}
	if err := w.g.Withdraw(ctx, vi, in[0].ID); !errors.Is(err, ErrNoRequest) {
		t.Fatalf("withdrew someone else's request: %v", err)
	}
}
