// Package mail sends the game's emails through an outbox: a message is saved first and sent by a worker that retries
// until it goes out, so a slow or failing mail server never holds up a player, and nothing is lost on a restart.
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
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/almanac-bg/almanac/internal/store"
)

// Message is a plain-text email to one address.
type Message struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Text    string `json:"text"`
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
}

func NewOutbox(db *store.DB, sender Sender, from string) *Outbox {
	return &Outbox{DB: db, Sender: sender, From: from, wake: make(chan struct{}, 1)}
}

// Enqueue saves a message to send, inside the caller's transaction: it goes out only if the transaction commits.
func (o *Outbox) Enqueue(tx *sql.Tx, m Message) error {
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	now := store.Now()
	_, err = tx.Exec(`INSERT INTO outbox (message, next_at, created_at) VALUES (?, ?, ?)`, string(body), now, now)
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

// Flush sends whatever is due now (before a shutdown, and in tests).
func (o *Outbox) Flush(ctx context.Context) {
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

// sendDue sends the oldest message that's due, and says whether there was one.
func (o *Outbox) sendDue(ctx context.Context) bool {
	var id int64
	var body string
	var attempts int
	err := o.DB.Write.QueryRowContext(ctx,
		`SELECT id, message, attempts FROM outbox WHERE next_at <= ? ORDER BY next_at LIMIT 1`, store.Now(),
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
	switch {
	case err == nil:
		_, err = o.DB.Write.Exec(`DELETE FROM outbox WHERE id = ?`, id)
	case attempts >= len(retries):
		slog.Error("mail given up", "to", m.To, "subject", m.Subject, "err", err)
		_, err = o.DB.Write.Exec(`DELETE FROM outbox WHERE id = ?`, id)
	default:
		slog.Warn("mail failed, will retry", "to", m.To, "in", retries[attempts], "err", err)
		_, err = o.DB.Write.Exec(`UPDATE outbox SET attempts = attempts + 1, next_at = ?, last_error = ? WHERE id = ?`,
			store.Ms(time.Now().Add(retries[attempts])), err.Error(), id)
	}
	if err != nil {
		slog.Error("outbox", "err", err)
		return false
	}
	return true
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
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(Compose(from, m, time.Now())); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
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
	b.WriteString("\r\n")
	qp := quotedprintable.NewWriter(&b)
	_, _ = qp.Write([]byte(strings.ReplaceAll(m.Text, "\n", "\r\n")))
	_ = qp.Close()
	return b.Bytes()
}
