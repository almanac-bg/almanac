package server

import (
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"sync"
	"time"
)

// recovered turns a panic in a handler into a 500, a log entry with its stack and a problem, instead of a dropped
// connection.
func (s *Server) recovered(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("panic", "method", r.Method, "path", r.URL.Path, "err", v, "stack", string(debug.Stack()))
				s.problems.add(fmt.Sprintf("panic: %s %s: %v", r.Method, r.Pattern, v))
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the connection (flushing a stream).
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// logged writes a line per request (but not per file): method, path, status, time.
func (s *Server) logged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		if isAsset(r.URL.Path) && sw.status < 400 {
			return
		}
		level := slog.LevelInfo
		if sw.status >= 500 {
			level = slog.LevelError
		}
		slog.Log(r.Context(), level, "request", "method", r.Method, "path", r.URL.Path, "status", sw.status,
			"ms", time.Since(start).Milliseconds(), "ip", s.clientIP(r))
	})
}

// csp lets the page load only its own files: no inline scripts, no third parties.
const csp = "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; " +
	"font-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"

func (s *Server) headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		if s.secure {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		}
		next.ServeHTTP(w, r)
	})
}

// limiter counts what each key (an address, an email) did in a window, to stop floods and guessing.
type limiter struct {
	mu   sync.Mutex
	hits map[string]*window
	last time.Time
}

type window struct {
	start time.Time
	n     int
}

func newLimiter() *limiter { return &limiter{hits: map[string]*window{}} }

// allow counts one for key and says whether it's within n per period.
func (l *limiter) allow(key string, n int, per time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.last) > time.Minute { // forget old windows now and then
		for k, w := range l.hits {
			if now.Sub(w.start) > 24*time.Hour {
				delete(l.hits, k)
			}
		}
		l.last = now
	}
	w := l.hits[key]
	if w == nil || now.Sub(w.start) >= per {
		w = &window{start: now}
		l.hits[key] = w
	}
	w.n++
	return w.n <= n
}
