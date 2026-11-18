//go:build !(linux || darwin)

package store

// freeSpace isn't known here: the check is left to the systems the game runs on.
func freeSpace(string) (free, total uint64, ok bool) { return 0, 0, false }
