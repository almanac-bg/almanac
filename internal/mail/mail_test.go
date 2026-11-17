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
	"strings"
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

func TestOutboxRetriesThenGivesUp(t *testing.T) {
	db := storetest.Open(t)
	f := &failing{}
	o := NewOutbox(db, f, "a@almanac.bg")
	_ = db.Tx(t.Context(), func(tx *sql.Tx) error { return o.Enqueue(tx, Message{To: "x@y.bg", Subject: "s", Text: "t"}) })
	for i := range len(retries) + 1 {
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
}
