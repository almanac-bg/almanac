package server

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/push"
	"github.com/almanac-bg/almanac/internal/safe"
)

// Notifications go out through a queue in the database (push_queue): notify saves a row for each player, in its own
// transaction or in the caller's (the day's reminder with its claim, Роял's call with its, the week's end in the
// leagues with its places), and Push sends them, pushWorkers players at a time, each player's browsers and phones at
// once, each send within pushTimeout. So a slow or dead device holds up only its own player's slot, a player has a
// few devices at most (pushDevices of each kind: notify.go), and the evening's reminders and Роял's call go out in
// seconds, whoever else is in the queue.
//
// A restart loses nothing: what's queued stays queued. Push, stopping, finishes the sends it has begun and begins no
// more, so a deploy sends nothing twice. A crash can: a row being sent is leased (its next_at pushLease ahead) and is
// sent again once the lease is over, at most pushTries times in all. Each notification carries its row's id as its
// tag (push.Message), so that a device shows one sent twice once.
//
// A row that reached none of the player's devices because their services were busy is tried again, after what the
// service asked or pushBackoff, while it's still of use (until). Each device's failures are kept: one gone (404/410,
// a token its maker no longer knows) is forgotten at once; one refused or unreached at every try for pushForgetAfter,
// pushForgetTries tries at least, is forgotten then (a week, so that an outage of the service's, or a mistake of the
// game's own that refuses everyone, forgets nobody before it's seen and mended). Counted by the message's kind
// (play/measure.go): push:sent, a device reached; push:gone, a device found gone; push:failed, a notification that
// reached none of the player's devices, though they had some.

const (
	// pushWorkers is how many players' notifications are sent at once.
	pushWorkers = 64
	// pushTimeout is how long a send to one device may take (an iPhone's two hosts together).
	pushTimeout = 5 * time.Second
	// pushLease is how long a row being sent is held from another try: past it, a crash's row is sent again.
	pushLease = time.Minute
	// pushTries is how many times a row is tried at most.
	pushTries = 3
	// pushTTL is how long a notification with no time of its own is of use: as long as the services keep it.
	pushTTL = 12 * time.Hour
	// pushForgetAfter and pushForgetTries are how long, and how many tries, a device may refuse every push before
	// it's forgotten.
	pushForgetAfter = 7 * 24 * time.Hour
	pushForgetTries = 3
)

// pushBackoff are the waits before a busy row's second and third tries, when the service didn't ask for longer.
var pushBackoff = []time.Duration{30 * time.Second, 2 * time.Minute}

// pushQueue is the queue's state in memory: a nudge to look at it now, and the counts not yet written.
type pushQueue struct {
	once    sync.Once
	wake    chan struct{}
	mu      sync.Mutex
	tallies map[string]int
}

func (q *pushQueue) woken() chan struct{} {
	q.once.Do(func() { q.wake = make(chan struct{}, 1) })
	return q.wake
}

// poke tells Push that there's something new in the queue.
func (q *pushQueue) poke() {
	select {
	case q.woken() <- struct{}{}:
	default:
	}
}

func (q *pushQueue) count(key string, n int) {
	if n == 0 {
		return
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.tallies == nil {
		q.tallies = map[string]int{}
	}
	q.tallies[key] += n
}

// flushTallies writes the counts kept so far (play/measure.go): written as they come, they would be a write a send.
func (s *Server) flushTallies(ctx context.Context) {
	s.pushq.mu.Lock()
	t := s.pushq.tallies
	s.pushq.tallies = nil
	s.pushq.mu.Unlock()
	for key, n := range t {
		if err := s.game.Tally(ctx, key, n); err != nil {
			slog.Error("push: counting", "err", err)
		}
	}
}

// notice is a notification to queue: its kind and its message; until when it's of use (zero: pushTTL); a day's
// reminder's day (remind.go); the part of the game the player must have met for it ("league").
type notice struct {
	kind  pushKind
	m     push.Message
	until time.Time
	day   string
	needs string
}

// queuer queues notices in a transaction.
type queuer struct {
	stmt *sql.Stmt
	now  time.Time
}

func (s *Server) queuer(ctx context.Context, tx *sql.Tx) (*queuer, error) {
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO push_queue (user_id, kind, message, day, needs, next_at, until)
		SELECT ?1, ?2, ?3, nullif(?4, ''), nullif(?5, ''), ?6, ?7
		WHERE EXISTS (SELECT 1 FROM push_subs WHERE user_id = ?1) OR EXISTS (SELECT 1 FROM phones WHERE user_id = ?1)`)
	return &queuer{stmt: stmt, now: s.game.Now()}, err
}

// add queues n for a player, if they have a device to send it to, and says whether it did.
func (q *queuer) add(ctx context.Context, n notice, userID int64) (bool, error) {
	until := n.until
	if until.IsZero() {
		until = q.now.Add(pushTTL)
	}
	m, err := json.Marshal(n.m)
	if err != nil {
		return false, err
	}
	res, err := q.stmt.ExecContext(ctx, userID, string(n.kind), string(m), n.day, n.needs, q.now.UnixMilli(), until.UnixMilli())
	if err != nil {
		return false, err
	}
	k, _ := res.RowsAffected()
	return k > 0, nil
}

func (q *queuer) close() { _ = q.stmt.Close() }

// queue queues n for each of these players in tx, and says for how many.
func (s *Server) queue(ctx context.Context, tx *sql.Tx, n notice, userIDs ...int64) (int, error) {
	q, err := s.queuer(ctx, tx)
	if err != nil {
		return 0, err
	}
	defer q.close()
	k := 0
	for _, id := range userIDs {
		ok, err := q.add(ctx, n, id)
		if err != nil {
			return k, err
		}
		if ok {
			k++
		}
	}
	return k, nil
}

// notify queues a message of a kind for these players, to go to every browser and phone of theirs that asked for
// notifications, if they want that kind (sent by Push, soon after).
func (s *Server) notify(ctx context.Context, kind pushKind, m push.Message, userIDs ...int64) {
	if (s.push == nil && s.phones == nil) || len(userIDs) == 0 {
		return
	}
	err := s.db.Tx(ctx, func(tx *sql.Tx) error {
		_, err := s.queue(ctx, tx, notice{kind: kind, m: m}, userIDs...)
		return err
	})
	if err != nil {
		slog.Error("push", "err", err)
		return
	}
	s.pushq.poke()
}

// Push sends what's queued, as it comes, until ctx ends; then it finishes the sends under way and returns.
func (s *Server) Push(ctx context.Context) { s.pushes(ctx, false) }

// sendQueued sends what's queued and due now, and returns once nothing is left due or under way.
func (s *Server) sendQueued(ctx context.Context) { s.pushes(ctx, true) }

func (s *Server) pushes(ctx context.Context, untilIdle bool) {
	if s.push == nil && s.phones == nil {
		if !untilIdle {
			<-ctx.Done()
		}
		return
	}
	work := context.WithoutCancel(ctx) // a send begun is finished, within pushTimeout
	done := make(chan struct{}, pushWorkers)
	busy := 0
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	defer func() {
		for ; busy > 0; busy-- {
			<-done
		}
		s.flushTallies(work)
	}()
	for ctx.Err() == nil {
		if busy < pushWorkers {
			jobs, err := s.claimPushes(ctx, pushWorkers-busy)
			if err != nil && ctx.Err() == nil {
				slog.Error("push", "err", err)
			}
			for _, j := range jobs {
				busy++
				go func() {
					defer func() { done <- struct{}{} }()
					s.deliver(work, j)
				}()
			}
			if untilIdle && busy == 0 {
				return
			}
		}
		select {
		case <-ctx.Done():
		case <-done:
			busy--
		case <-s.pushq.woken():
		case <-tick.C:
			s.flushTallies(work)
		}
	}
}

// queued is a row of the queue, as it's sent.
type queued struct {
	id, user   int64
	kind       pushKind
	m          push.Message
	day, needs string
	until      int64
	tries      int
}

// claimPushes leases up to n rows that are due, the oldest first.
func (s *Server) claimPushes(ctx context.Context, n int) ([]queued, error) {
	now := s.game.Now().UnixMilli()
	var due bool
	// Looked at first on the readers' side: a lease is a write, and the queue is mostly empty.
	if err := s.db.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM push_queue WHERE next_at <= ?)`, now).
		Scan(&due); err != nil || !due {
		return nil, err
	}
	rows, err := s.db.Write.QueryContext(ctx, `UPDATE push_queue SET next_at = ?1, tries = tries + 1
		WHERE id IN (SELECT id FROM push_queue WHERE next_at <= ?2 ORDER BY next_at, id LIMIT ?3)
		RETURNING id, user_id, kind, message, coalesce(day, ''), coalesce(needs, ''), until, tries`,
		now+pushLease.Milliseconds(), now, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []queued
	for rows.Next() {
		var j queued
		var m string
		if err := rows.Scan(&j.id, &j.user, &j.kind, &m, &j.day, &j.needs, &j.until, &j.tries); err != nil {
			return out, err
		}
		_ = json.Unmarshal([]byte(m), &j.m)
		out = append(out, j)
	}
	return out, rows.Err()
}

// device is a browser's subscription (platform "") or a phone's token, as a row of the queue is sent to it.
type device struct {
	sub      push.Subscription
	platform string
	token    string
	fails    int
}

// table and key are where the device is kept.
func (d device) table() (table, column, key string) {
	if d.platform == "" {
		return "push_subs", "endpoint", d.sub.Endpoint
	}
	return "phones", "token", d.token
}

// devices are a player's browsers and phones that want notifications of a kind (the newest pushDevices of each) and
// that the game has a sender for.
func (s *Server) devices(ctx context.Context, userID int64, kind pushKind) ([]device, error) {
	want := ""
	if kind != pushAsked {
		want = ` AND ` + wants(kind, "?1")
	}
	rows, err := s.db.Read.QueryContext(ctx, `SELECT * FROM (SELECT endpoint, p256dh, auth, '', fails FROM push_subs
			WHERE user_id = ?1`+want+` ORDER BY created_at DESC LIMIT ?2)
		UNION ALL SELECT * FROM (SELECT token, '', '', platform, fails FROM phones
			WHERE user_id = ?1`+want+` ORDER BY created_at DESC LIMIT ?2)`, userID, pushDevices)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	platforms := s.phones.Platforms()
	var out []device
	for rows.Next() {
		var d device
		var key string
		if err := rows.Scan(&key, &d.sub.Keys.P256dh, &d.sub.Keys.Auth, &d.platform, &d.fails); err != nil {
			return nil, err
		}
		switch {
		case d.platform == "" && s.push != nil:
			d.sub.Endpoint = key
		case d.platform != "" && slices.Contains(platforms, d.platform):
			d.token = key
		default:
			continue // none to send it with here: kept for when there is
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Server) sendTo(ctx context.Context, d device, m push.Message) error {
	if d.platform == "" {
		return s.push.Send(ctx, d.sub, m)
	}
	return s.phones.Send(ctx, d.platform, d.token, m)
}

// deliver sends a row of the queue to the player's devices, and keeps what came of it: the row done (or tried again
// later), the devices gone or failing forgotten or counted, a day's reminder's devices reached.
func (s *Server) deliver(ctx context.Context, j queued) {
	defer safe.Recover("push: a send") // the row's lease runs out, and it's tried again
	now := s.game.Now()
	m, ok, err := s.message(ctx, j, now)
	var devices []device
	if err == nil && ok {
		devices, err = s.devices(ctx, j.user, j.kind)
	}
	if err != nil {
		slog.Error("push", "err", err)
		return // the lease runs out, and it's tried again
	}
	if len(devices) == 0 {
		s.pushDone(ctx, j, nil, nil, 0, now)
		return
	}
	m.Kind = cmp.Or(m.Kind, j.kind.name()) // a message may say more of itself (the day's last reminder: "stop")
	m.Tag = "n" + strconv.FormatInt(j.id, 10)
	errs := make([]error, len(devices))
	var wg sync.WaitGroup
	for i, d := range devices {
		wg.Go(func() {
			ctx, cancel := context.WithTimeout(ctx, pushTimeout)
			defer cancel()
			errs[i] = s.sendTo(ctx, d, m)
		})
	}
	wg.Wait()

	reached, gone := 0, 0
	var wait time.Duration
	busy := false
	for i, err := range errs {
		var b *push.Busy
		var r *push.Refused
		switch {
		case err == nil:
			reached++
		case errors.Is(err, push.ErrGone):
			gone++
		case errors.As(err, &b):
			busy, wait = true, max(wait, b.After)
			slog.Warn("push", "err", err, "kind", m.Kind)
		case errors.As(err, &r):
			slog.Warn("push", "err", err, "kind", m.Kind)
		default: // the game's own: says nothing of the device
			devices[i].fails = -1
			slog.Warn("push", "err", err, "kind", m.Kind)
		}
	}
	s.pushq.count("push:sent:"+m.Kind, reached)
	s.pushq.count("push:gone:"+m.Kind, gone)
	if reached == 0 && busy && j.tries < pushTries {
		next := now.Add(max(wait, pushBackoff[min(j.tries, len(pushBackoff))-1]))
		if next.UnixMilli() <= j.until {
			s.pushDone(ctx, j, devices, errs, -1, next)
			return
		}
	}
	if reached == 0 && gone < len(devices) {
		s.pushq.count("push:failed:"+m.Kind, 1)
	}
	s.pushDone(ctx, j, devices, errs, reached, now)
}

// message is a row's message as it's sent, and whether it's still to be sent: a row too late, or tried too often, or
// for a player who no longer needs it, isn't.
func (s *Server) message(ctx context.Context, j queued, now time.Time) (push.Message, bool, error) {
	if now.UnixMilli() > j.until || j.tries > pushTries {
		return j.m, false, nil
	}
	switch j.needs {
	case "":
	case "league":
		open, err := s.game.OpenOf(ctx, j.user)
		if err != nil || !open.League {
			return j.m, false, err
		}
	default:
		return j.m, false, nil
	}
	if j.day == "" {
		return j.m, true, nil
	}
	// A day's reminder is written as it's sent, and not sent to one who has played the day since it was queued.
	var playedToday bool
	var played sql.NullString
	if err := s.db.Read.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM runs WHERE user_id = ?1 AND kind = 'day'
			AND day = ?2 AND finished_at IS NOT NULL),
		(SELECT max(day) FROM runs WHERE user_id = ?1 AND kind = 'day' AND finished_at IS NOT NULL)`, j.user, j.day).
		Scan(&playedToday, &played); err != nil || playedToday {
		return j.m, false, err
	}
	if j.m.Kind == "stop" {
		return s.lastReminder(ctx, j.user, played.String), true, nil
	}
	return s.reminder(ctx, j.day, j.user), true, nil
}

// pushDone keeps what came of a row's try, in one write: each device's failures (errs, by devices); then the row
// done, with the devices it reached (a day's reminder keeps that), or, for reached -1, to be tried again at `at`.
func (s *Server) pushDone(ctx context.Context, j queued, devices []device, errs []error, reached int, at time.Time) {
	ms := at.UnixMilli()
	err := s.db.Tx(ctx, func(tx *sql.Tx) error {
		for i, d := range devices {
			table, column, key := d.table()
			var q string
			var args []any
			switch err := errs[i]; {
			case d.fails < 0: // the game's own failure
				continue
			case err == nil && d.fails == 0:
				continue
			case err == nil:
				q = `UPDATE ` + table + ` SET fails = 0, failing_since = NULL WHERE ` + column + ` = ?`
				args = []any{key}
			case errors.Is(err, push.ErrGone):
				q, args = `DELETE FROM `+table+` WHERE `+column+` = ?`, []any{key}
			default:
				q = `UPDATE ` + table + ` SET fails = fails + 1, failing_since = coalesce(failing_since, ?2) WHERE ` + column + ` = ?1`
				args = []any{key, s.game.Now().UnixMilli()}
				if _, err := tx.ExecContext(ctx, q, args...); err != nil {
					return err
				}
				q = `DELETE FROM ` + table + ` WHERE ` + column + ` = ? AND fails >= ? AND failing_since <= ?`
				args = []any{key, pushForgetTries, s.game.Now().Add(-pushForgetAfter).UnixMilli()}
			}
			if _, err := tx.ExecContext(ctx, q, args...); err != nil {
				return err
			}
		}
		if reached < 0 {
			_, err := tx.ExecContext(ctx, `UPDATE push_queue SET next_at = ? WHERE id = ?`, ms, j.id)
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM push_queue WHERE id = ?`, j.id); err != nil {
			return err
		}
		if j.day == "" || reached == 0 {
			return nil
		}
		_, err := tx.ExecContext(ctx, `UPDATE push_reminded SET delivered = ? WHERE user_id = ? AND day = ?`, reached, j.user, j.day)
		return err
	})
	if err != nil {
		slog.Error("push", "err", err)
	}
}
