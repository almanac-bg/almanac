import { actions, api, plural, useStore } from '@almanac/client';
import { CATEGORIES, type CategoryChoice, ROOM_LIMITS, type RoomSettingsPatch, type RoomState } from '@almanac/shared';
import { View } from 'react-native';
import { useLoad } from '@/lib/load';
import { Button, Card, T } from '@/ui';
import { Choices, Toggle } from '@/ui/controls';

const update = (patch: RoomSettingsPatch) => actions.roomSettings(patch);

/** Quick sizes for the room, as far as the limits go: a class needs 30 in one tap, not 22 taps. */
const SIZES = [2, 4, 6, 8, 12, 16, 20, 30, 40];

/**
 * The room's settings (the web's settings card): the host changes them, everyone else sees them. „Само водя“ — the host
 * runs the game on a big screen and doesn't play — is the site's: a phone is no projector.
 */
export function RoomSettings({ room, isHost }: { room: RoomState; isHost: boolean }) {
  const s = room.settings;
  const off = !isHost;
  const crowded = room.players.length > ROOM_LIMITS.eliminationPlayers;
  // „Микс“, „Избира последният“ (rounds) or one category the host picks.
  const categoryMode = s.category !== 'mixed' ? 'one' : s.rounds ? 'rounds' : 'mixed';
  const min = Math.max(ROOM_LIMITS.maxPlayers[0], room.players.length);
  const max = s.elimination ? ROOM_LIMITS.eliminationPlayers : ROOM_LIMITS.maxPlayers[1];
  return (
    <Card style={{ gap: 18 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <T variant="h2" role="heading">
          Настройки
        </T>
        {off && (
          <T variant="caption" tone="fg3">
            Само домакинът ги променя
          </T>
        )}
      </View>

      <Setting label="Максимум играчи">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Button
            title="−"
            label="По-малко"
            variant="secondary"
            disabled={off || s.maxPlayers <= min}
            onPress={() => update({ maxPlayers: s.maxPlayers - 1 })}
          />
          <T
            variant="h1"
            align="center"
            style={{ minWidth: 48, fontVariant: ['tabular-nums'] }}
            accessibilityLabel={`Максимум ${s.maxPlayers} играчи`}
          >
            {s.maxPlayers}
          </T>
          <Button
            title="+"
            label="Повече"
            variant="secondary"
            disabled={off || s.maxPlayers >= max}
            onPress={() => update({ maxPlayers: s.maxPlayers + 1 })}
          />
        </View>
        {isHost && (
          <Choices
            label="Бързо"
            options={SIZES.filter((n) => n >= min && n <= max).map((n) => ({ id: String(n), label: String(n) }))}
            value={String(s.maxPlayers)}
            onChange={(n) => update({ maxPlayers: Number(n) })}
          />
        )}
      </Setting>

      <QuestionSource room={room} isHost={isHost} />

      {!s.set && (
        <Setting label="Брой въпроси">
          <Choices
            label="Брой въпроси"
            disabled={off || s.rounds}
            options={ROOM_LIMITS.questions.map((n) => ({ id: String(n), label: String(n) }))}
            value={String(s.questions)}
            onChange={(n) => update({ questions: Number(n) })}
          />
          {s.rounds && <Note text="Три рунда по три въпроса и финал." />}
        </Setting>
      )}

      <Setting label="Време за въпрос">
        <Choices
          label="Време за въпрос"
          disabled={off}
          options={ROOM_LIMITS.timeMs.map((ms) => ({ id: String(ms), label: ms ? `${ms / 1000} с` : 'Без часовник' }))}
          value={String(s.timeMs)}
          onChange={(ms) => update({ timeMs: Number(ms) })}
        />
        {s.timeMs === 0 && (
          <Note text="Въпросът стои, докато всички отговорят или докато домакинът покаже отговора. Без бонус за бързина." />
        )}
      </Setting>

      {!s.set && (
        <Setting label="Категории">
          <Choices
            label="Категории"
            disabled={off}
            options={[
              { id: 'mixed', label: 'Микс' },
              { id: 'rounds', label: 'Избира последният' },
              { id: 'one', label: 'Една' },
            ]}
            value={categoryMode}
            onChange={(mode) =>
              update(
                mode === 'one'
                  ? { category: s.category === 'mixed' ? CATEGORIES[0].id : s.category, rounds: false }
                  : { category: 'mixed', rounds: mode === 'rounds' },
              )
            }
          />
          <Note
            text={
              categoryMode === 'mixed'
                ? 'По малко от всичко.'
                : categoryMode === 'rounds'
                  ? 'Преди всеки рунд последният по точки избира категорията от три.'
                  : 'Всички въпроси от една категория:'
            }
          />
          {categoryMode === 'one' && (
            <Choices<CategoryChoice>
              label="Категория"
              disabled={off}
              options={CATEGORIES.map((c) => ({ id: c.id, label: `${c.icon} ${c.name}` }))}
              value={s.category}
              onChange={(category) => update({ category })}
            />
          )}
        </Setting>
      )}

      {!s.set && (
        <Toggle
          label="🎯 Финал с число"
          hint="Последният въпрос е число за въвеждане — година, височина, брой"
          value={s.final}
          disabled={off}
          onChange={(final) => update({ final })}
        />
      )}
      {!s.set && (
        <Toggle
          label="🖼️ Картини"
          hint="Въпроси със снимка: знамена, места, картини, животни (докъдето стигнат — после обикновени)"
          value={s.pictures}
          disabled={off}
          onChange={(pictures) => update({ pictures })}
        />
      )}
      <Toggle
        label="👥 Отбори"
        hint="2 отбора, точките се събират (при неравни — по средно на играч)"
        value={s.teams}
        disabled={off}
        onChange={(teams) => update({ teams })}
      />
      <Toggle
        label="💀 Отпадане"
        hint={
          s.teams
            ? 'Не важи при отборен мач'
            : crowded
              ? `До ${ROOM_LIMITS.eliminationPlayers} играчи`
              : `Последният отпада на всеки няколко въпроса (до ${ROOM_LIMITS.eliminationPlayers} играчи)`
        }
        value={s.elimination}
        disabled={off || s.teams || (crowded && !s.elimination)}
        onChange={(elimination) => update({ elimination })}
      />
      {!s.hostPlays && (
        <Note text="📽️ „Само водя“ е включено: домакинът води мача на голям екран и не играе. Сменя се на сайта." />
      )}
    </Card>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T variant="label" tone="fg2">
        {label}
      </T>
      {children}
    </View>
  );
}

function Note({ text }: { text: string }) {
  return (
    <T variant="caption" tone="fg3">
      {text}
    </T>
  );
}

/** The bank's questions, or one of the host's own sets („Моите въпроси“). */
function QuestionSource({ room, isHost }: { room: RoomState; isHost: boolean }) {
  const guest = useStore((s) => !!s.me?.isGuest);
  const mayPick = isHost && !guest;
  const { data } = useLoad(() => (mayPick ? api.sets() : Promise.resolve(null)), String(mayPick));
  const current = room.settings.set;
  const playable = (data?.sets ?? []).filter((x) => x.questions > 0 && !x.hidden);
  const options = [
    { id: '0', label: 'От АЛМАНАХ' },
    // The set in the room, while the list of them is still on its way.
    ...(current && !playable.some((x) => x.id === current.id)
      ? [{ id: String(current.id), label: `📝 ${current.name}` }]
      : []),
    ...playable.map((x) => ({ id: String(x.id), label: `📝 ${x.name} · ${plural(x.questions, 'въпрос', 'въпроса')}` })),
  ];
  return (
    <Setting label="Въпроси">
      {mayPick ? (
        <Choices
          label="Въпроси"
          options={options}
          value={String(current?.id ?? 0)}
          onChange={(id) => update({ set: Number(id) || null })}
        />
      ) : (
        <T variant="small" tone="fg2">
          {current ? `📝 „${current.name}“ на домакина` : 'От АЛМАНАХ'}
        </T>
      )}
      {current ? (
        <Note
          text={`Всичките ${current.questions} въпроса, в реда на набора. Без XP за отговорите: въпросите са на домакина.`}
        />
      ) : mayPick ? (
        <Note text="Или твои въпроси — направи набор на сайта, в „Моите въпроси“." />
      ) : null}
    </Setting>
  );
}
