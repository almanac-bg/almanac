import { actions, getState, setState, toast, useStore } from '@almanac/client';
import { nicknameProblem, ROOM_CODE_DIGITS, ROOM_NICKNAME, tidyNickname } from '@almanac/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button, Card, Field, Screen, T } from '@/ui';

/** What the server says to a code no room has (rooms.ts → join). */
const NO_SUCH_ROOM = 'Няма стая с този код.';

/**
 * A room by its code, /join/<code> (the web's JoinRoute): a player with an account goes straight in; a guest first says
 * what to call them there. A locked room keeps you at its door until the host lets you in or not; leaving this screen
 * leaves the door.
 */
export default function Join() {
  const { code = '' } = useLocalSearchParams<{ code: string }>();
  const connected = useStore((s) => s.connected);
  const guest = useStore((s) => !!s.me?.isGuest);
  const inside = useStore((s) => s.room?.code === code);
  const knock = useStore((s) => (s.knock?.code === code ? s.knock : null));
  const tried = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In: straight away, or once the host opens the door (the room's state comes before any answer to joining).
  useEffect(() => {
    if (inside) router.replace('/room');
  }, [inside]);

  // Leaving the door leaves the room's queue at it.
  useEffect(
    () => () => {
      const { knock: at } = getState();
      if (at?.code !== code) return;
      if (at.refused) setState({ knock: null });
      else actions.leaveRoom();
    },
    [code],
  );

  useEffect(() => {
    if (guest || !connected || tried.current) return;
    tried.current = true;
    void actions.joinRoom(code).then((res) => {
      if (res.ok) return;
      toast({ kind: 'error', title: res.error });
      router.replace('/');
    });
  }, [guest, connected, code]);

  const joinAs = async (nickname: string, corrected?: string) => {
    // Another code typed in: that room's screen, the name with it.
    if (corrected && corrected !== code) {
      setError(null);
      router.replace({ pathname: '/join/[code]', params: { code: corrected } });
      return;
    }
    setBusy(true);
    const res = await actions.joinRoom(code, nickname);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  if (knock)
    return (
      <Screen centered>
        <Card style={{ alignItems: 'center', gap: 12 }}>
          <T style={{ fontSize: 40, lineHeight: 48 }}>🚪</T>
          {knock.refused ? (
            <>
              <T variant="h2" role="heading" align="center">
                Не влезе в стаята
              </T>
              <T tone="fg2" align="center">
                {knock.refused}
              </T>
            </>
          ) : (
            <>
              <T variant="h2" role="heading" align="center">
                Чакаш домакина
              </T>
              <T tone="fg2" align="center">
                Стая {code} е заключена. Домакинът вижда, че чакаш, и решава дали да те пусне.
              </T>
              <ActivityIndicator />
            </>
          )}
          <Button
            title={knock.refused ? 'Към началото' : 'Откажи се'}
            variant={knock.refused ? 'primary' : 'ghost'}
            onPress={() => router.replace('/')}
            style={{ alignSelf: 'stretch' }}
          />
        </Card>
      </Screen>
    );
  if (!guest)
    return (
      <Screen centered>
        <ActivityIndicator />
      </Screen>
    );
  return (
    <Screen centered>
      <Nickname
        key={code}
        code={code}
        busy={busy}
        error={error}
        wrongCode={error === NO_SUCH_ROOM}
        onJoin={(n, corrected) => void joinAs(n, corrected)}
      />
    </Screen>
  );
}

/**
 * A guest joining a room says what to call them there (they have no name of their own yet): the host and the others
 * see it, a class's teacher above all. A code no room has can be corrected here, the name kept.
 */
function Nickname({
  code,
  busy,
  error,
  wrongCode,
  onJoin,
}: {
  code: string;
  busy: boolean;
  error: string | null;
  wrongCode: boolean;
  onJoin: (nickname: string, code?: string) => void;
}) {
  const [name, setName] = useState('');
  const [typed, setTyped] = useState(code);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = () => {
    const issue = nicknameProblem(name);
    setProblem(issue);
    if (issue) return;
    onJoin(tidyNickname(name), wrongCode && typed.length === ROOM_CODE_DIGITS ? typed : undefined);
  };
  const message = problem ?? (wrongCode ? null : error);
  return (
    <Card style={{ gap: 14 }}>
      <T variant="h2" role="heading">
        Влизаш в стая {code}
      </T>
      {wrongCode ? (
        <Field
          label="Код на стаята"
          value={typed}
          onChangeText={(t) => setTyped(t.replace(/\D/g, '').slice(0, ROOM_CODE_DIGITS))}
          keyboardType="number-pad"
          error={`Няма стая с код ${code} — провери го: ${ROOM_CODE_DIGITS} цифри, както са на дъската.`}
        />
      ) : (
        <T tone="fg2">Как да те виждат там?</T>
      )}
      <View style={{ gap: 6 }}>
        <Field
          label="Име в стаята"
          value={name}
          onChangeText={setName}
          maxLength={ROOM_NICKNAME.max}
          autoComplete="nickname"
          autoFocus
          placeholder="Например Мария или Иван 7Б"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={message}
        />
        <T variant="caption" tone="fg3">
          Първо име или прякор е достатъчно: виждат го всички в стаята.
        </T>
      </View>
      <Button title="Влез в стаята" size="lg" loading={busy} onPress={submit} />
    </Card>
  );
}
