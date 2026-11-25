// Package mail sends the game's emails through an outbox: a message is saved first and sent by a worker that retries
// until it goes out, so a slow or failing mail server never holds up a player, and nothing is lost on a restart.
//
// A message worth sending only for a while (a sign-in code: Urgent) goes before every other, and is dropped unsent once
// its time is out, so that a queue of other mail, or a flood of codes, never delivers a code that no longer works.
// Urgent messages go by their rank, the lowest first: a code asked for from a network that asked for many this minute
// waits for everyone else's (account.SendCode). One message is sent at a time, and once the mail server has taken it
// (its DATA accepted) it counts as sent, whatever happens after: a mail goes once.
//
// A message the mail server refuses for good (a 5xx answer to its recipient or its content: Refused) is not sent
// again. When the refusal is of the address itself (no such mailbox or domain), the address is suppressed: no mail
// goes to it for SuppressFirst, or SuppressAgain if it was refused before (as the provider blocks it on its side), so
// that the game doesn't keep mailing an address that bounces and lose its good name with the mail providers. A 5xx
// to anything else (signing in to the mail server, the sender) is the game's own trouble, the same for every message:
// those are tried again, as a 4xx is.
//
// What goes wrong with the mail as a whole is told (Outbox.Problem), not only logged: a message given up after every
// retry, sign-in codes dropped unsent, several sends in a row failed (Failing, which /api/health shows too, since the
// mail that tells of problems goes the same way).
package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Message is a plain-text email to one address. A mail the player may stop (not the sign-in code) has its Unsubscribe
// address: a mail program offers it as a button, which posts to it (RFC 8058).
type Message struct {
	To          string `json:"to"`
	Subject     string `json:"subject"`
	Text        string `json:"text"`
	Unsubscribe string `json:"unsubscribe,omitempty"`
}

// Sender delivers a message (SMTP in production; the log in development).
type Sender interface {
	Send(ctx context.Context, from string, m Message) error
}

// Outbox queues messages in the database and sends them in the background.
type Outbox struct {
	DB     *store.DB
	Sender Sender
	From   string // "АЛМАНАХ <no-reply@almanac.bg>"
	wake   chan struct{}
	// Problem, if set, is told what goes wrong with the mail as a whole (a kind of problem, without addresses): a
	// message given up, sign-in codes dropped unsent, failingSends in a row failed. A dead login to the mail server
	// stops every sign-in on a new device, and the log alone would keep that quiet.
	Problem func(kind string)
	// sending is held while a message is picked and sent: the worker (Run) and a Flush (at a shutdown) never send the
	// same message at once.
	sending sync.Mutex
	failing atomic.Int32 // sends failed in a row (not refused for their address)
}

// failingSends is how many sends in a row may fail before it's told: one address's server may be slow, every
// message's failing is the game's.
const failingSends = 3

// Failing says whether the last failingSends sends or more all failed: the mail server isn't taking the game's mail
// (/api/health says so, for a monitor outside: the mail that would tell of it goes the same way).
func (o *Outbox) Failing() bool { return o.failing.Load() >= failingSends }

// tell tells a problem, if anyone listens.
func (o *Outbox) tell(kind string) {
	if o.Problem != nil {
		o.Problem(kind)
	}
}

func NewOutbox(db *store.DB, sender Sender, from string) *Outbox {
	return &Outbox{DB: db, Sender: sender, From: from, wake: make(chan struct{}, 1)}
}

// Enqueue saves a message to send, inside the caller's transaction: it goes out only if the transaction commits. A
// message to a suppressed address (Suppressed) is let go unsaved.
func (o *Outbox) Enqueue(tx *sql.Tx, m Message) error {
	if off, err := Suppressed(tx, m.To, time.Now()); err != nil || off {
		return err
	}
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	now := store.Now()
	_, err = tx.Exec(`INSERT INTO outbox (message, next_at, created_at) VALUES (?, ?, ?)`, string(body), now, now)
	return err
}

// Urgent saves a message worth sending only until a time (a sign-in code), inside the caller's transaction: it goes
// out before any other mail, the urgent of the lowest rank first, and is dropped unsent once that time is past. It
// says the message's id, for Drop.
func (o *Outbox) Urgent(tx *sql.Tx, m Message, until time.Time, rank int) (int64, error) {
	body, err := json.Marshal(m)
	if err != nil {
		return 0, err
	}
	now := store.Now()
	res, err := tx.Exec(`INSERT INTO outbox (message, next_at, created_at, urgent, expires_at, rank)
		VALUES (?, ?, ?, 1, ?, ?)`, string(body), now, now, store.Ms(until), rank)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// Unqueue takes every message to an address out of the queue, and forgets whether mail reaches it, inside the
// caller's transaction: the player there has deleted their account.
func Unqueue(tx *sql.Tx, to string) error {
	if _, err := tx.Exec(`DELETE FROM outbox WHERE json_extract(message, '$.to') = ?`, to); err != nil {
		return err
	}
	_, err := tx.Exec(`DELETE FROM mail_suppressed WHERE email = ?`, to)
	return err
}

// How long an address the mail server refused is suppressed: the first time, and again if it was refused within
// SuppressKept of its last suppression's end (as Scaleway's own blocklist does: two days, then a month). An address
// refused once by mistake (a mail server's bad day) is reachable again soon; one that keeps bouncing, for a month.
const (
	SuppressFirst = 48 * time.Hour
	SuppressAgain = 30 * 24 * time.Hour
	SuppressKept  = 30 * 24 * time.Hour
)

// Suppressed says whether no mail goes to an address now: the mail server refused it (Refused.Address).
func Suppressed(tx *sql.Tx, to string, now time.Time) (bool, error) {
	var off bool
	err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM mail_suppressed WHERE email = ? AND until > ?)`, to, store.Ms(now)).
		Scan(&off)
	return off, err
}

// suppress keeps mail from going to an address the mail server refused: for SuppressFirst, or SuppressAgain if it's
// still remembered from before (SuppressKept).
func (o *Outbox) suppress(to, why string, now time.Time) error {
	_, err := o.DB.Write.Exec(`INSERT INTO mail_suppressed (email, until, times, reason) VALUES (?1, ?2, 1, ?4)
		ON CONFLICT (email) DO UPDATE SET until = ?3, times = times + 1, reason = ?4`,
		to, store.Ms(now.Add(SuppressFirst)), store.Ms(now.Add(SuppressAgain)), why)
	return err
}

// Refused is a mail server's refusal, for good, of one message (a 5xx answer to its recipient or its content):
// sending it again won't help. Address says it's a refusal of the address itself: no such mailbox or domain, or a
// mailbox disabled.
type Refused struct {
	Code    int
	Msg     string
	Address bool
}

func (e *Refused) Error() string { return fmt.Sprintf("refused: %d %s", e.Code, e.Msg) }

// refusal is a mail server's answer to a message's recipient (rcpt) or its content, as Refused if it refuses for good;
// else the error as it was.
func refusal(err error, rcpt bool) error {
	var te *textproto.Error
	if !errors.As(err, &te) || te.Code < 500 || te.Code > 599 {
		return err
	}
	return &Refused{Code: te.Code, Msg: te.Msg, Address: rcpt && addressRefused(te.Code, te.Msg)}
}

// addressRefused says whether a 5xx to a recipient refuses the address itself: by its enhanced status (RFC 3463),
// 5.1.x (a bad mailbox, domain or address) or 5.2.1 (a mailbox disabled); without one, 550, 551 or 553. A refusal by
// policy (5.7.x: a spam filter, a block on the sender) says nothing of the address.
func addressRefused(code int, msg string) bool {
	if f := strings.Fields(msg); len(f) > 0 && strings.Count(f[0], ".") == 2 && strings.HasPrefix(f[0], "5.") {
		return strings.HasPrefix(f[0], "5.1.") || f[0] == "5.2.1"
	}
	return code == 550 || code == 551 || code == 553
}

// Drop takes a message out of the queue if it hasn't gone yet: a code replaced by a newer one.
func (o *Outbox) Drop(tx *sql.Tx, id int64) error {
	_, err := tx.Exec(`DELETE FROM outbox WHERE id = ?`, id)
	return err
}

// Wake tells the worker there's mail, after the transaction that queued it has committed.
func (o *Outbox) Wake() {
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

// retries are the waits between attempts; after the last, a message is given up on.
var retries = []time.Duration{10 * time.Second, time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour}

// Flush sends whatever is due now (before a shutdown, and in tests), the urgent first, once the mail out of time is
// dropped (and the suppressions long over forgotten).
func (o *Outbox) Flush(ctx context.Context) {
	if res, err := o.DB.Write.ExecContext(ctx, `DELETE FROM outbox WHERE expires_at <= ?`, store.Now()); err == nil {
		if n, _ := res.RowsAffected(); n > 0 {
			slog.Warn("mail dropped: its time was out before it could go", "n", n)
			o.tell("mail: sign-in codes dropped unsent, their time out: is the mail server taking mail? (journalctl: mail)")
		}
	}
	_, _ = o.DB.Write.ExecContext(ctx, `DELETE FROM mail_suppressed WHERE until <= ?`,
		store.Ms(time.Now().Add(-SuppressKept)))
	for o.sendDue(ctx) {
	}
}

// Run sends queued mail until ctx ends.
func (o *Outbox) Run(ctx context.Context) {
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	for {
		o.Flush(ctx)
		select {
		case <-ctx.Done():
			return
		case <-o.wake:
		case <-tick.C:
		}
	}
}

// sendDue sends the message due first (the urgent before the rest, by rank, then the oldest), and says whether there
// was one.
func (o *Outbox) sendDue(ctx context.Context) bool {
	o.sending.Lock()
	defer o.sending.Unlock()
	var id int64
	var body string
	var attempts int
	now := store.Now()
	err := o.DB.Write.QueryRowContext(ctx, `SELECT id, message, attempts FROM outbox
		WHERE next_at <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY urgent DESC, rank, next_at LIMIT 1`, now, now,
	).Scan(&id, &body, &attempts)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) && ctx.Err() == nil {
			slog.Error("outbox", "err", err)
		}
		return false
	}
	var m Message
	if err := json.Unmarshal([]byte(body), &m); err != nil {
		slog.Error("outbox: a broken message, dropped", "id", id, "err", err)
		_, _ = o.DB.Write.Exec(`DELETE FROM outbox WHERE id = ?`, id)
		return true
	}
	sendCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	err = o.Sender.Send(sendCtx, o.From, m)
	cancel()
	var refused *Refused
	switch {
	case err == nil:
		o.failing.Store(0)
	case !errors.As(err, &refused) || !refused.Address:
		if o.failing.Add(1) == failingSends {
			o.tell(fmt.Sprintf("mail: %d sends in a row failed: the mail server, or the game's login to it? (journalctl: mail failed)", failingSends))
		}
	}
	switch {
	case err == nil:
		_, err = o.DB.Write.Exec(`DELETE FROM outbox WHERE id = ?`, id)
	case errors.As(err, &refused):
		slog.Warn("mail refused, not sent again", "outbox", id, "to", domainOf(m.To), "subject", m.Subject, "err", hidden(err, m.To), "address", refused.Address)
		if refused.Address {
			if err := o.suppress(m.To, refused.Error(), time.Now()); err != nil {
				slog.Error("outbox: suppressing an address", "err", err)
			}
		}
		_, err = o.DB.Write.Exec(`DELETE FROM outbox WHERE id = ?`, id)
	case attempts >= len(retries):
		slog.Error("mail given up", "outbox", id, "to", domainOf(m.To), "subject", m.Subject, "err", hidden(err, m.To))
		o.tell("mail: a message was given up after every retry (journalctl: mail given up)")
		_, err = o.DB.Write.Exec(`DELETE FROM outbox WHERE id = ?`, id)
	default:
		slog.Warn("mail failed, will retry", "outbox", id, "to", domainOf(m.To), "in", retries[attempts], "err", hidden(err, m.To))
		_, err = o.DB.Write.Exec(`UPDATE outbox SET attempts = attempts + 1, next_at = ? WHERE id = ?`,
			store.Ms(time.Now().Add(retries[attempts])), id)
	}
	if err != nil {
		slog.Error("outbox", "err", err)
		return false
	}
	return true
}

// domainOf is what a log says of an address: its domain only. The logs keep no player's address (server/privacy.go),
// and one mail that keeps failing would put it in them at every try.
func domainOf(to string) string {
	if i := strings.LastIndexByte(to, '@'); i >= 0 {
		return "…" + strings.TrimRight(to[i:], ">")
	}
	return "…"
}

// hidden is an error's text with the address taken out: a mail server's refusal often names it.
func hidden(err error, to string) string {
	return strings.ReplaceAll(err.Error(), to, domainOf(to))
}

// Log is the development sender: the message goes to the log, where the sign-in code can be read — and, if Dir is
// set, to <Dir>/<address>.txt, where the browser tests read it.
type Log struct{ Dir string }

func (l Log) Send(_ context.Context, from string, m Message) error {
	slog.Info("mail (not sent: development)", "to", m.To, "subject", m.Subject, "text", m.Text)
	if l.Dir == "" {
		return nil
	}
	if err := os.MkdirAll(l.Dir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(l.Dir, filepath.Base(m.To)+".txt"), []byte(m.Subject+"\n\n"+m.Text), 0o600)
}

// SMTP sends through a mail server, with STARTTLS required: smtp://user:password@host:587.
type SMTP struct {
	host, addr string
	auth       smtp.Auth
}

func NewSMTP(rawURL string) (*SMTP, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "smtp" || u.Hostname() == "" {
		return nil, errors.New("SMTP_URL must be smtp://user:password@host:587")
	}
	port := u.Port()
	if port == "" {
		port = "587"
	}
	s := &SMTP{host: u.Hostname(), addr: net.JoinHostPort(u.Hostname(), port)}
	if u.User != nil {
		password, _ := u.User.Password()
		s.auth = smtp.PlainAuth("", u.User.Username(), password, s.host)
	}
	return s, nil
}

func (s *SMTP) Send(ctx context.Context, from string, m Message) error {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", s.addr)
	if err != nil {
		return err
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	c, err := smtp.NewClient(conn, s.host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if err := c.StartTLS(&tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}); err != nil {
		return fmt.Errorf("starttls: %w", err)
	}
	if s.auth != nil {
		if err := c.Auth(s.auth); err != nil {
			return err
		}
	}
	addr, err := mailAddress(from)
	if err != nil {
		return err
	}
	if err := c.Mail(addr); err != nil {
		return err
	}
	if err := c.Rcpt(m.To); err != nil {
		return refusal(err, true)
	}
	w, err := c.Data()
	if err != nil {
		return refusal(err, false)
	}
	if _, err := w.Write(Compose(from, m, time.Now())); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return refusal(err, false)
	}
	// The server has taken the message: it's sent. A failed goodbye after that isn't a failed send, which would send
	// the message again.
	_ = c.Quit()
	return nil
}

// mailAddress is the bare address of "Name <address>".
func mailAddress(from string) (string, error) {
	if i, j := strings.LastIndexByte(from, '<'), strings.LastIndexByte(from, '>'); i >= 0 && j > i {
		return from[i+1 : j], nil
	}
	if strings.Contains(from, "@") {
		return from, nil
	}
	return "", errors.New("MAIL_FROM must be an address")
}

// Compose writes a message as the wire carries it: UTF-8 text, quoted-printable, headers encoded.
func Compose(from string, m Message, at time.Time) []byte {
	var b bytes.Buffer
	name, addr := "", from
	if i := strings.LastIndexByte(from, '<'); i > 0 {
		name, addr = strings.TrimSpace(from[:i]), from[i:]
	}
	if name != "" {
		addr = mime.QEncoding.Encode("utf-8", name) + " " + addr
	}
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	domain := "almanac.bg"
	if a, err := mailAddress(from); err == nil {
		domain = a[strings.LastIndexByte(a, '@')+1:]
	}
	for _, h := range [][2]string{
		{"From", addr},
		{"To", m.To},
		{"Subject", mime.QEncoding.Encode("utf-8", m.Subject)},
		{"Date", at.Format(time.RFC1123Z)},
		{"Message-ID", "<" + hex.EncodeToString(id) + "@" + domain + ">"},
		{"MIME-Version", "1.0"},
		{"Content-Type", "text/plain; charset=utf-8"},
		{"Content-Transfer-Encoding", "quoted-printable"},
	} {
		b.WriteString(h[0] + ": " + h[1] + "\r\n")
	}
	if m.Unsubscribe != "" {
		b.WriteString("List-Unsubscribe: <" + m.Unsubscribe + ">\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n")
	}
	b.WriteString("\r\n")
	qp := quotedprintable.NewWriter(&b)
	_, _ = qp.Write([]byte(strings.ReplaceAll(m.Text, "\n", "\r\n")))
	_ = qp.Close()
	return b.Bytes()
}
