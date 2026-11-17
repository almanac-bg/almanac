//go:build unix

package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
)

// aside makes cmd start in a process group of its own, so that lower can lower the priority of all of it.
func aside(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// lower gives the process pid (started by aside) the processor only when the game leaves it some (nice 10), and makes
// it, not the game, what the kernel stops first if memory runs out. Each is best effort: a copy made at the usual
// priority is still a copy.
func lower(pid int) {
	// By group: every thread of the process, those it makes after taking the lower priority too (on Linux, a nice is
	// a thread's own).
	_ = syscall.Setpriority(syscall.PRIO_PGRP, pid, 10)
	_ = os.WriteFile(fmt.Sprintf("/proc/%d/oom_score_adj", pid), []byte("500"), 0)
}

// ownAs gives the file at path the owner of the file or directory like (the game's user, when root restores a copy
// for it). Only root can, and needs to.
func ownAs(path, like string) error {
	if os.Geteuid() != 0 {
		return nil
	}
	fi, err := os.Stat(like)
	if err != nil {
		return err
	}
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return nil
	}
	return os.Chown(path, int(st.Uid), int(st.Gid))
}
