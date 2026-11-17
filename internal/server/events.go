package server

import (
	"fmt"
	"math/rand/v2"
	"net/http"
	"strings"
	"time"
)

// writeWait is how long one line of a stream may take to reach a client before the stream gives up on it.
var writeWait = 10 * time.Second

// sender writes the lines of a Server-Sent Events stream to w, each flushed at once; false once the client is gone.
// The write deadline is cleared after every line: over HTTP/2 a deadline that passes resets the stream even when
// nothing is being written, which closed every quiet stream writeWait after its last line.
//
// The first line comes with how long the browser waits before it reconnects, should the line drop: a while picked at
// random (retry), so that the screens of a server that restarted don't all come back in the same instant (unless the
// stream says its own).
func sender(w http.ResponseWriter) func(line string) bool {
	rc := http.NewResponseController(w)
	first := true
	return func(line string) bool {
		if first && !strings.HasPrefix(line, "retry:") {
			line = fmt.Sprintf("retry: %d\n", retry()) + line
		}
		first = false
		_ = rc.SetWriteDeadline(time.Now().Add(writeWait))
		defer func() { _ = rc.SetWriteDeadline(time.Time{}) }()
		if _, err := fmt.Fprint(w, line); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
}

// retry is how long a browser waits to reconnect a stream that dropped, in milliseconds: 1.5 to 6 seconds.
func retry() int { return 1500 + rand.N(4500) }
