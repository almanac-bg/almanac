package server

import (
	"fmt"
	"net/http"
	"time"
)

// writeWait is how long one line of a stream may take to reach a client before the stream gives up on it.
var writeWait = 10 * time.Second

// sender writes the lines of a Server-Sent Events stream to w, each flushed at once; false once the client is gone.
// The write deadline is cleared after every line: over HTTP/2 a deadline that passes resets the stream even when
// nothing is being written, which closed every quiet stream writeWait after its last line.
func sender(w http.ResponseWriter) func(line string) bool {
	rc := http.NewResponseController(w)
	return func(line string) bool {
		_ = rc.SetWriteDeadline(time.Now().Add(writeWait))
		defer func() { _ = rc.SetWriteDeadline(time.Time{}) }()
		if _, err := fmt.Fprint(w, line); err != nil {
			return false
		}
		return rc.Flush() == nil
	}
}
