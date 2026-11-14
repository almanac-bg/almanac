// "Something's wrong with this question": a sentence from the player to whoever keeps the bank.

import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";

export function report(id: string): Child {
  const state = signal<"closed" | "open" | "sent">("closed");
  const text = signal("");
  const error = signal("");
  const send = async (e: SubmitEvent) => {
    e.preventDefault();
    error.set("");
    try {
      await api("POST", `/api/questions/${encodeURIComponent(id)}/report`, { text: text.peek() });
      state.set("sent");
    } catch (err) {
      error.set((err as ApiError).message);
    }
  };
  return () => {
    switch (state()) {
      case "closed":
        return h("button", { class: "link muted", onclick: () => state.set("open") }, "Нещо не е наред с въпроса?");
      case "sent":
        return h("p", { class: "muted", role: "status" }, "Благодарим! Ще го прегледаме.");
      case "open":
        return h(
          "form",
          { class: "stack", onsubmit: send },
          h(
            "label",
            { class: "field" },
            h("span", null, "Какво не е наред?"),
            h("textarea", {
              rows: 3,
              maxlength: 500,
              required: true,
              oninput: (e: Event) => text.set((e.target as HTMLTextAreaElement).value),
              ref: (el) => queueMicrotask(() => el.focus()),
            }),
          ),
          h("button", { class: "btn" }, "Изпрати"),
          h("button", { type: "button", class: "link", onclick: () => state.set("closed") }, "Откажи"),
          error() && h("p", { class: "bad", role: "alert" }, error()),
        );
    }
  };
}
