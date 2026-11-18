package mail

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"mime"
	"mime/quotedprintable"
	"net/textproto"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/store/storetest"
)

func TestCompose(t *testing.T) {
	raw := Compose("АЛМАНАХ <no-reply@almanac.bg>", Message{To: "a@b.bg", Subject: "Кодът ти: 123456", Text: "Ред едно\nРед две — с тире"}, time.Unix(0, 0))
	r := textproto.NewReader(bufio.NewReader(bytes.NewReader(raw)))
	h, err := r.ReadMIMEHeader()
	if err != nil {
		t.Fatal(err)
	}
	dec := new(mime.WordDecoder)
	if s, _ := dec.DecodeHeader(h.Get("Subject")); s != "Кодът ти: 123456" {
		t.Errorf("subject %q", s)
	}
	if s, _ := dec.DecodeHeader(h.Get("From")); s != "АЛМАНАХ <no-reply@almanac.bg>" {
		t.Errorf("from %q", s)
	}
	if !strings.HasSuffix(h.Get("Message-Id"), "@almanac.bg>") {
		t.Errorf("message id %q", h.Get("Message-Id"))
	}
	body, _ := io.ReadAll(quotedprintable.NewReader(r.R))
	if string(body) != "Ред едно\r\nРед две — с тире" {
		t.Errorf("body %q", body)
	}
	if h.Get("List-Unsubscribe") != "" {
		t.Errorf("a code mail with a way to stop it: %q", h.Get("List-Unsubscribe"))
	}
}

// A mail the player may stop says how, for the mail program's own button (RFC 8058).
func TestComposeUnsubscribe(t *testing.T) {
	raw := Compose("АЛМАНАХ <no-reply@almanac.bg>", Message{To: "a@b.bg", Subject: "С", Text: "Т",
		Unsubscribe: "https://almanac.bg/mail/off?k=streak"}, time.Unix(0, 0))
	h, err := textproto.NewReader(bufio.NewReader(bytes.NewReader(raw))).ReadMIMEHeader()
	if err != nil {
		t.Fatal(err)
	}
	if h.Get("List-Unsubscribe") != "<https://almanac.bg/mail/off?k=streak>" ||
		h.Get("List-Unsubscribe-Post") != "List-Unsubscribe=One-Click" {
		t.Errorf("headers %v", h)
	}
}

type failing struct{ n int }

func (f *failing) Send(context.Context, string, Message) error {
	f.n++
	return errors.New("down")
}

// A message that fails is tried again, then given up on; the sends failing in a row, and the giving up, are told
// (without the address), and the outbox says it's failing until a send goes.
func TestOutboxRetriesThenGivesUp(t *testing.T) {
	db := storetest.Open(t)
	f := &failing{}
	o := NewOutbox(db, f, "a@almanac.bg")
	var told []string
	o.Problem = func(kind string) { told = append(told, kind) }
	_ = db.Tx(t.Context(), func(tx *sql.Tx) error { return o.Enqueue(tx, Message{To: "x@y.bg", Subject: "s", Text: "t"}) })
	for i := range len(retries) + 1 {
		if failing := o.Failing(); failing != (i >= failingSends) {
			t.Fatalf("before attempt %d: failing %v", i+1, failing)
		}
		o.Flush(t.Context())
		var n int
		_ = db.Read.QueryRow(`SELECT count(*) FROM outbox`).Scan(&n)
		want := 1
		if i == len(retries) {
			want = 0 // given up
		}
		if n != want {
			t.Fatalf("after attempt %d: %d queued, want %d", i+1, n, want)
		}
		_, _ = db.Write.Exec(`UPDATE outbox SET next_at = 0`) // as if the wait were over
	}
	if f.n != len(retries)+1 {
		t.Fatalf("%d attempts", f.n)
	}
	if len(told) != 2 || !strings.Contains(told[0], "in a row failed") || !strings.Contains(told[1], "given up") ||
		strings.Contains(strings.Join(told, " "), "x@y.bg") {
		t.Fatalf("told %q", told)
	}
	o.Sender = &kept{}
	_ = db.Tx(t.Context(), func(tx *sql.Tx) error { return o.Enqueue(tx, Message{To: "x@y.bg", Subject: "s", Text: "t"}) })
	if o.Flush(t.Context()); o.Failing() {
		t.Fatal("still failing after a send went")
	}
}

// kept is a sender that keeps what it sends, slowly if told to.
type kept struct {
	mu   sync.Mutex
	sent []string
	slow time.Duration
}

func (k *kept) Send(_ context.Context, _ string, m Message) error {
	time.Sleep(k.slow)
	k.mu.Lock()
	defer k.mu.Unlock()
	k.sent = append(k.sent, m.Subject)
	return nil
}

// A code goes before the mail queued ahead of it, and not at all once its time is out (review 2026-11-17, S4); one
// replaced before it went (Drop) doesn't go either.
func TestOutboxUrgentFirstAndDroppedWhenDead(t *testing.T) {
	db := storetest.Open(t)
	k := &kept{}
	o := NewOutbox(db, k, "a@almanac.bg")
	var told []string
	o.Problem = func(kind string) { told = append(told, kind) }
	err := db.Tx(t.Context(), func(tx *sql.Tx) error {
		for _, s := range []string{"streak 1", "streak 2"} {
			if err := o.Enqueue(tx, Message{To: "x@y.bg", Subject: s, Text: "t"}); err != nil {
				return err
			}
		}
		if _, err := o.Urgent(tx, Message{To: "x@y.bg", Subject: "dead code", Text: "t"}, time.Now().Add(-time.Second), 0); err != nil {
			return err
		}
		replaced, err := o.Urgent(tx, Message{To: "x@y.bg", Subject: "replaced code", Text: "t"}, time.Now().Add(time.Minute), 0)
		if err != nil {
			return err
		}
		if _, err := o.Urgent(tx, Message{To: "x@y.bg", Subject: "code", Text: "t"}, time.Now().Add(time.Minute), 0); err != nil {
			return err
		}
		return o.Drop(tx, replaced)
	})
	if err != nil {
		t.Fatal(err)
	}
	o.Flush(t.Context())
	if got := strings.Join(k.sent, ", "); got != "code, streak 1, streak 2" {
		t.Fatalf("sent %s", got)
	}
	if len(told) != 1 || !strings.Contains(told[0], "sign-in codes dropped unsent") {
		t.Fatalf("told %q", told)
	}
	var n int
	_ = db.Read.QueryRow(`SELECT count(*) FROM outbox`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d left in the outbox", n)
	}
}

// A message's id is never another's after it has gone: dropping a code's mail that went drops nothing else.
func TestOutboxDropsOnlyItsOwn(t *testing.T) {
	db := storetest.Open(t)
	k := &kept{}
	o := NewOutbox(db, k, "a@almanac.bg")
	urgent := func(subject string) (id int64) {
		_ = db.Tx(t.Context(), func(tx *sql.Tx) (err error) {
			id, err = o.Urgent(tx, Message{To: "x@y.bg", Subject: subject, Text: "t"}, time.Now().Add(time.Minute), 0)
			return err
		})
		return id
	}
	gone := urgent("gone")
	o.Flush(t.Context())
	if next := urgent("next"); next == gone {
		t.Fatalf("id %d used again", gone)
	}
	_ = db.Tx(t.Context(), func(tx *sql.Tx) error { return o.Drop(tx, gone) })
	o.Flush(t.Context())
	if got := strings.Join(k.sent, ", "); got != "gone, next" {
		t.Fatalf("sent %s", got)
	}
}

// The worker and a Flush at a shutdown never send the same mail both (review 2026-11-17, A25).
func TestOutboxSendsOnce(t *testing.T) {
	db := storetest.Open(t)
	k := &kept{slow: 20 * time.Millisecond}
	o := NewOutbox(db, k, "a@almanac.bg")
	_ = db.Tx(t.Context(), func(tx *sql.Tx) error {
		for i := range 5 {
			if err := o.Enqueue(tx, Message{To: "x@y.bg", Subject: strconv.Itoa(i), Text: "t"}); err != nil {
				return err
			}
		}
		return nil
	})
	ctx, stop := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { o.Run(ctx); close(done) }()
	time.Sleep(30 * time.Millisecond) // the worker is sending
	stop()
	o.Flush(t.Context())
	<-done
	if got := strings.Join(k.sent, ","); got != "0,1,2,3,4" {
		t.Fatalf("sent %s", got)
	}
}

// refusing is a mail server that answers every message with err, at its recipient (rcpt) or after.
type refusing struct {
	n    int
	err  error
	rcpt bool
}

func (f *refusing) Send(context.Context, string, Message) error {
	f.n++
	return refusal(f.err, f.rcpt)
}

// A message the mail server refuses for good (a 5xx) isn't sent again; one refused for its address suppresses the
// address: no other mail is queued to it, until the suppression ends (review 2026-11-18, S5).
func TestOutboxRefusedForGood(t *testing.T) {
	for _, c := range []struct {
		name     string
		err      error
		rcpt     bool
		attempts int // before it's let go
		off      bool
	}{
		{"no such mailbox", &textproto.Error{Code: 550, Msg: "5.1.1 user unknown"}, true, 1, true},
		{"no such domain", &textproto.Error{Code: 550, Msg: "5.1.2 bad destination system"}, true, 1, true},
		{"a bare 553", &textproto.Error{Code: 553, Msg: "mailbox name not allowed"}, true, 1, true},
		{"a spam filter", &textproto.Error{Code: 550, Msg: "5.7.1 message rejected"}, true, 1, false},
		{"the content", &textproto.Error{Code: 554, Msg: "5.6.0 bad content"}, false, 1, false},
		{"a mailbox full for now", &textproto.Error{Code: 452, Msg: "4.2.2 mailbox full"}, true, len(retries) + 1, false},
		{"the network", errors.New("down"), false, len(retries) + 1, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			db := storetest.Open(t)
			f := &refusing{err: c.err, rcpt: c.rcpt}
			o := NewOutbox(db, f, "a@almanac.bg")
			enqueue := func() {
				_ = db.Tx(t.Context(), func(tx *sql.Tx) error { return o.Enqueue(tx, Message{To: "x@y.bg", Subject: "s", Text: "t"}) })
			}
			enqueue()
			for range len(retries) + 1 {
				o.Flush(t.Context())
				_, _ = db.Write.Exec(`UPDATE outbox SET next_at = 0`) // as if the wait were over
			}
			if f.n != c.attempts {
				t.Fatalf("%d attempts, want %d", f.n, c.attempts)
			}
			off := func(at time.Time) (off bool) {
				_ = db.Tx(t.Context(), func(tx *sql.Tx) (err error) { off, err = Suppressed(tx, "x@y.bg", at); return err })
				return off
			}
			if off(time.Now()) != c.off {
				t.Fatalf("suppressed: %v", !c.off)
			}
			if !c.off {
				return
			}
			enqueue()
			var n int
			_ = db.Read.QueryRow(`SELECT count(*) FROM outbox`).Scan(&n)
			if n != 0 {
				t.Fatal("a mail queued to a suppressed address")
			}
			if off(time.Now().Add(SuppressFirst)) {
				t.Fatal("still suppressed after SuppressFirst")
			}
		})
	}
}

// An address refused again while its last suppression is remembered is suppressed longer; one deleted (Unqueue) is
// forgotten.
func TestSuppressedLongerAgain(t *testing.T) {
	db := storetest.Open(t)
	o := NewOutbox(db, &refusing{}, "a@almanac.bg")
	off := func(at time.Time) (off bool) {
		_ = db.Tx(t.Context(), func(tx *sql.Tx) (err error) { off, err = Suppressed(tx, "x@y.bg", at); return err })
		return off
	}
	now := time.Now()
	if err := o.suppress("x@y.bg", "550", now); err != nil {
		t.Fatal(err)
	}
	if !off(now.Add(SuppressFirst-time.Minute)) || off(now.Add(SuppressFirst)) {
		t.Fatal("the first suppression isn't SuppressFirst")
	}
	later := now.Add(SuppressFirst + 24*time.Hour)
	if err := o.suppress("x@y.bg", "550", later); err != nil {
		t.Fatal(err)
	}
	if !off(later.Add(SuppressAgain - time.Minute)) {
		t.Fatal("refused again, not suppressed for SuppressAgain")
	}
	_ = db.Tx(t.Context(), func(tx *sql.Tx) error { return Unqueue(tx, "x@y.bg") })
	if off(later) {
		t.Fatal("still suppressed after the address was forgotten")
	}
}

// The urgent go by rank: a code from a network that asked for many this minute waits for everyone else's.
func TestOutboxUrgentByRank(t *testing.T) {
	db := storetest.Open(t)
	k := &kept{}
	o := NewOutbox(db, k, "a@almanac.bg")
	_ = db.Tx(t.Context(), func(tx *sql.Tx) error {
		for i, rank := range []int{3, 4, 1, 5, 1} {
			m := Message{To: "x@y.bg", Subject: strconv.Itoa(i), Text: "t"}
			if _, err := o.Urgent(tx, m, time.Now().Add(time.Minute), rank); err != nil {
				return err
			}
		}
		return nil
	})
	o.Flush(t.Context())
	if got := strings.Join(k.sent, ","); got != "2,4,0,1,3" {
		t.Fatalf("sent %s", got)
	}
}
