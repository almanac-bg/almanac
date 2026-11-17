//go:build !unix

package main

import "os/exec"

func aside(*exec.Cmd)               {}
func lower(int)                     {}
func ownAs(path, like string) error { return nil }
