//go:build !(linux || darwin)

package store

// freeSpace isn't known here: the check is left to the systems the game runs on.
func freeSpace(string) (uint64, bool) { return 0, false }
