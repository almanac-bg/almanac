import { type ApiError, api } from "../lib/api.ts";
import { type Child, h, signal, when } from "../lib/dom.ts";
import { title } from "../lib/router.ts";
import { type User, user } from "../state.ts";

export function me() {
  title("Профил");
  return h(
    "section",
    { class: "screen" },
    h("h1", null, () => user()?.name ?? "Профил"),
    when(
      () => user(),
      () => [nameForm(), account()],
      () => [
        h("p", { class: "muted" }, "Още нямаш профил. Той се прави сам, щом започнеш да играеш, или тук, с имейл."),
        signIn(),
      ],
    ),
  );
}

function nameForm(): Child {
  const name = signal(user.peek()?.name ?? "");
  const busy = signal(false);
  const note = signal<{ text: string; bad?: boolean } | null>(null);
  return h(
    "form",
    {
      class: "stack",
      onsubmit: async (e: SubmitEvent) => {
        e.preventDefault();
        busy.set(true);
        note.set(null);
        try {
          const r = await api<{ user: User }>("PATCH", "/api/me", { name: name.peek() });
          user.set(r.user);
          name.set(r.user.name);
          note.set({ text: "Запазено." });
        } catch (err) {
          note.set({ text: (err as ApiError).message, bad: true });
        } finally {
          busy.set(false);
        }
      },
    },
    h(
      "label",
      { class: "field" },
      h("span", null, "Име"),
      h("input", {
        name: "name",
        autocomplete: "nickname",
        minlength: 2,
        maxlength: 20,
        required: true,
        value: name,
        oninput: (e: Event) => name.set((e.target as HTMLInputElement).value),
      }),
    ),
    h("button", { class: "btn", disabled: busy }, "Запази"),
    () => {
      const n = note();
      return n && h("p", { class: n.bad ? "bad" : "muted", role: "status" }, n.text);
    },
  );
}

function account(): Child {
  return h(
    "section",
    { class: "stack" },
    when(
      () => user()?.email,
      () => [
        h("h2", null, "Профилът ти"),
        h(
          "p",
          null,
          "Влизаш с ",
          h("strong", null, () => user()?.email ?? ""),
          ".",
        ),
        h("button", { class: "link", onclick: signOut }, "Изход"),
      ],
      () => [
        h("h2", null, "Запази профила си"),
        h(
          "p",
          { class: "muted" },
          "Сега играта ти се пази само на това устройство. Добави имейл и ще я имаш навсякъде, където влезеш с него.",
        ),
        signIn(),
      ],
    ),
  );
}

async function signOut() {
  await api("POST", "/api/auth/signout", {}).catch(() => {});
  user.set(null);
}

/** Signing in with an email: the address, then the code mailed to it. */
function signIn(): Child {
  const email = signal("");
  const code = signal("");
  const sent = signal(false);
  const busy = signal(false);
  const error = signal("");

  const run = async (fn: () => Promise<void>) => {
    busy.set(true);
    error.set("");
    try {
      await fn();
    } catch (err) {
      error.set((err as ApiError).message);
    } finally {
      busy.set(false);
    }
  };
  const send = () =>
    run(async () => {
      await api("POST", "/api/auth/code", { email: email.peek() });
      sent.set(true);
    });

  const errorLine = () => error() && h("p", { class: "bad", role: "alert" }, error());

  return when(
    () => sent(),
    () =>
      h(
        "form",
        {
          class: "stack",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
            run(async () => {
              const r = await api<{ user: User }>("POST", "/api/auth/verify", {
                email: email.peek(),
                code: code.peek(),
              });
              user.set(r.user);
            });
          },
        },
        h("p", null, "Пратихме код на ", h("strong", null, email.peek()), ". Въведи го тук:"),
        h(
          "label",
          { class: "field" },
          h("span", null, "Код"),
          h("input", {
            class: "code",
            inputmode: "numeric",
            autocomplete: "one-time-code",
            pattern: "[0-9]{6}",
            maxlength: 6,
            required: true,
            oninput: (e: Event) => code.set((e.target as HTMLInputElement).value.replace(/\D/g, "")),
            ref: (el) => queueMicrotask(() => el.focus()),
          }),
        ),
        h("button", { class: "btn", disabled: busy }, "Влез"),
        errorLine,
        h(
          "p",
          { class: "muted" },
          "Няма го? Виж в спама или ",
          h("button", { type: "button", class: "link", onclick: send, disabled: busy }, "прати нов код"),
          ". ",
          h("button", { type: "button", class: "link", onclick: () => sent.set(false) }, "Друг имейл"),
        ),
      ),
    () =>
      h(
        "form",
        {
          class: "stack",
          onsubmit: (e: SubmitEvent) => {
            e.preventDefault();
            send();
          },
        },
        h(
          "label",
          { class: "field" },
          h("span", null, "Имейл"),
          h("input", {
            type: "email",
            autocomplete: "email",
            required: true,
            value: email.peek(),
            oninput: (e: Event) => email.set((e.target as HTMLInputElement).value),
          }),
        ),
        h("button", { class: "btn", disabled: busy }, "Прати ми код"),
        errorLine,
        h("p", { class: "muted" }, "Без пароли: всеки път ти пращаме код за вход."),
      ),
  );
}
