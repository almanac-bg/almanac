// "Something's wrong with this question": a sentence from the player to whoever keeps the bank.

import { api, errorText } from "../lib/api.ts";
import { type Child, h, signal } from "../lib/dom.ts";

export function report(id: string): Child {
  const state = signal<"closed" | "open" | "sent">("closed");
  const text = signal("");
  const error = signal("");
  let field: HTMLTextAreaElement | undefined;
  const send = async (e: SubmitEvent) => {
    e.preventDefault();
    // Said the game's way, not in the browser's bubble (in the browser's language, English as often as not).
    if (!text.peek().trim()) {
      error.set("Напиши какво не е наред.");
      field?.focus();
      return;
    }
    error.set("");
    try {
      await api("POST", `/api/questions/${encodeURIComponent(id)}/report`, { text: text.peek() });
      state.set("sent");
    } catch (err) {
      error.set(errorText(err));
    }
  };
  return () => {
    switch (state()) {
      case "closed":
        return h("button", { class: "link muted tap", onclick: () => state.set("open") }, "Нещо не е наред с въпроса?");
      case "sent":
        return h("p", { class: "muted", role: "status" }, "Благодарим ти! Ще го прегледаме.");
      case "open":
        return h(
          "form",
          { class: "stack", onsubmit: send },
          h(
            "label",
            { class: "field" },
            h("span", null, "Какво не е наред?"),
            h("textarea", {
              value: text.peek(),
              rows: 3,
              maxlength: 500,
              oninput: (e: Event) => {
                text.set((e.target as HTMLTextAreaElement).value);
                error.set("");
              },
              ref: (el) => {
                field = el as HTMLTextAreaElement;
                queueMicrotask(() => el.focus());
              },
            }),
          ),
          // Under the field it's about. Its own child: read by the form, an error would draw the form again and lose
          // what was typed.
          () => error() && h("p", { class: "bad", role: "alert" }, error()),
          h("button", { class: "btn" }, "Прати"),
          h("button", { type: "button", class: "link", onclick: () => state.set("closed") }, "Отказ"),
        );
    }
  };
}
