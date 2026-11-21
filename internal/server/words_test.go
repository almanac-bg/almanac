package server

import "testing"

func TestWithWord(t *testing.T) {
	for in, want := range map[string]string{
		"Стефан Баторий": "със Стефан Баторий",
		"Заек 817":       "със Заек 817",
		"зора":           "със зора",
		"Мечка 12":       "с Мечка 12",
		"Ана":            "с Ана",
		"Sasho":          "със Sasho",
		"Zara":           "със Zara",
		"Shon":           "с Shon",
		"„Светило“":      "със „Светило“",
		"7":              "със 7",
		"17 дни":         "със 17 дни",
		"20 дни":         "с 20 дни",
		"0,05 г":         "с 0,05 г",
		"1000":           "с 1000",
		"7000":           "със 7000",
		"150 000":        "със 150 000",
	} {
		if got := withWord(in); got != want {
			t.Errorf("withWord(%q) = %q, want %q", in, got, want)
		}
	}
}
