import {
  api,
  errorMessage,
  fmt,
  itemName,
  requirementLabel,
  setState,
  toast,
  unlockContextOf,
  useStore,
} from '@almanac/client';
import {
  ACHIEVEMENTS,
  AVATARS,
  CATEGORIES,
  CHOICE_EVERY,
  choiceKey,
  EMOTES,
  FRAMES,
  type Loadout,
  MASTERY,
  MASTERY_TIERS,
  masteryTitleId,
  meetsRequirement,
  POWERUPS,
  type Requirement,
  TITLES,
  type TitleDef,
  titleName,
  type UnlockKind,
  xpToReach,
} from '@almanac/shared';
import { type ReactNode, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { LevelChoice } from '@/rewards/LevelChoice';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, Card, Progress, Screen, T, useSheetPadding } from '@/ui';
import { Choices } from '@/ui/controls';

type Tab = 'avatar' | 'frame' | 'title' | 'emote' | 'powerup';

/**
 * Колекция (the web's LockerPage): how you look, a level's reward waiting to be picked, and everything there is — avatars,
 * frames, titles (with each category's mastery), emotes and козове — what's yours worn with a tap, what isn't with what
 * it takes.
 */
export default function Locker() {
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState<Tab>('avatar');
  const [saving, setSaving] = useState<string | null>(null);
  if (!me) return null;
  const ctx = unlockContextOf(me);
  const unlocked = (kind: UnlockKind, item: { id: string; req: Requirement }) =>
    meetsRequirement(item.req, ctx, choiceKey({ kind, id: item.id }));

  const equip = async (patch: Partial<Loadout>) => {
    const key = Object.values(patch)[0] ?? null;
    setSaving(key);
    // Worn at once; put back if the server says no.
    setState({ me: { ...me, ...patch } });
    try {
      const { user } = await api.loadout(patch);
      setState({ me: user });
    } catch (err) {
      setState({ me });
      toast({ kind: 'error', title: errorMessage(err, 'Неуспешно запазване.') });
    } finally {
      setSaving(null);
    }
  };

  // Козове aren't collected: everyone has them all, so their tab has no count.
  const count = (kind: Exclude<Tab, 'powerup'>, list: { id: string; req: Requirement }[]) =>
    `${list.filter((x) => unlocked(kind, x)).length}/${list.length}`;
  return (
    <Screen>
      <T tone="fg2">Аватари, рамки, титли, емоции и козове — каквото си отключил и как изглеждаш.</T>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar avatar={me.avatar} frame={me.frame} size={72} />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="title" numberOfLines={2}>
            {me.username}
          </T>
          <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
            {titleName(me.title)}
          </T>
          <T variant="caption" tone="fg3">
            Ниво {ctx.level} · така те виждат другите играчи
          </T>
        </View>
      </Card>

      {me.choices.length > 0 && <ChoicesWaiting key={me.choices[0]?.level} />}

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Choices<Tab>
          label="Колекция"
          options={[
            { id: 'avatar', label: `Аватари ${count('avatar', AVATARS)}` },
            { id: 'frame', label: `Рамки ${count('frame', FRAMES)}` },
            { id: 'title', label: `Титли ${count('title', TITLES)}` },
            { id: 'emote', label: `Емоции ${count('emote', EMOTES)}` },
            { id: 'powerup', label: 'Козове' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </ScrollView>

      {tab === 'avatar' && (
        <Grid>
          {AVATARS.map((a) => (
            <Item
              key={a.id}
              name={a.name}
              req={a.req}
              unlocked={unlocked('avatar', a)}
              equipped={me.avatar === a.id}
              saving={saving === a.id}
              onEquip={() => void equip({ avatar: a.id })}
            >
              <Avatar avatar={a.id} frame={me.frame} size={60} />
            </Item>
          ))}
        </Grid>
      )}
      {tab === 'frame' && (
        <Grid>
          {FRAMES.map((f) => (
            <Item
              key={f.id}
              name={f.name}
              req={f.req}
              unlocked={unlocked('frame', f)}
              equipped={me.frame === f.id}
              saving={saving === f.id}
              onEquip={() => void equip({ frame: f.id })}
            >
              <Avatar avatar={me.avatar} frame={f.id} size={60} />
            </Item>
          ))}
        </Grid>
      )}
      {tab === 'title' && (
        <>
          {TITLES.filter((t) => !('mastery' in t.req)).map((t) => (
            <TitleRow
              key={t.id}
              title={t}
              open={unlocked('title', t)}
              equipped={me.title === t.id}
              onEquip={() => void equip({ title: t.id })}
            />
          ))}
          <T variant="h2" role="heading" style={{ marginTop: 8 }}>
            Майсторство
          </T>
          <T variant="small" tone="fg3">
            Степен във всяка категория според това колко добре я знаеш спрямо останалите играчи (след поне{' '}
            {MASTERY.minAnswers} отговора в нея). Веднъж стигната, остава твоя.
          </T>
          {CATEGORIES.map((c) => (
            <Card key={c.id} style={{ gap: 8, padding: 12 }}>
              <T variant="small" style={{ fontFamily: fonts.semibold }}>
                {c.icon} {c.name}
              </T>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {MASTERY_TIERS.map((tier, i) => {
                  const t = TITLES.find((x) => x.id === masteryTitleId({ category: c.id, tier: i }));
                  if (!t) return null;
                  return (
                    <TitleRow
                      key={t.id}
                      title={t}
                      label={tier.name}
                      icon={tier.icon}
                      open={unlocked('title', t)}
                      equipped={me.title === t.id}
                      onEquip={() => void equip({ title: t.id })}
                      compact
                    />
                  );
                })}
              </View>
            </Card>
          ))}
        </>
      )}
      {tab === 'emote' && (
        <>
          <T variant="small" tone="fg3">
            Емоциите се използват в мачовете срещу съперници — всички отключени са винаги под ръка.
          </T>
          <Grid>
            {EMOTES.map((e) => (
              <Item key={e.id} name={e.name} req={e.req} unlocked={unlocked('emote', e)}>
                <T style={{ fontSize: 40, lineHeight: 48 }}>{e.emoji}</T>
              </Item>
            ))}
          </Grid>
        </>
      )}
      {tab === 'powerup' && (
        <>
          <T variant="small" tone="fg2">
            Всеки играе с {['', 'единствения', 'двата', 'трите', 'четирите', 'петте'][POWERUPS.length] ?? 'всички'} от
            първия си мач, освен във въпросите на деня и в линковете с предизвикателство, където всички играят едно и
            също. Всеки коз се играе веднъж на мач — и най-много един на въпрос.
          </T>
          {POWERUPS.map((p) => (
            <Card key={p.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <T style={{ fontSize: 26, lineHeight: 32 }}>{p.icon}</T>
                <T variant="title">{p.name}</T>
              </View>
              <T variant="small" tone="fg2">
                {p.description}
              </T>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

/**
 * One item: worn (marked), yours (worn with a tap), or locked — still a button, which says what it takes (a disabled
 * one couldn't be reached or tapped).
 */
function Item({
  name,
  req,
  unlocked,
  equipped = false,
  saving = false,
  onEquip,
  children,
}: {
  name: string;
  req: Requirement;
  unlocked: boolean;
  equipped?: boolean;
  saving?: boolean;
  onEquip?: () => void;
  children: ReactNode;
}) {
  const colors = useColors();
  const [info, setInfo] = useState(false);
  // Worn is said by its state (selected); a locked one says what it takes.
  const label = unlocked ? name || 'Емоция' : `${name || 'Емоция'}, ${requirementLabel(req, true)} (заключено)`;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={unlocked && onEquip ? { selected: equipped, busy: saving } : undefined}
        accessibilityHint={!unlocked ? 'Казва какво отключва' : onEquip && !equipped ? 'Слага го' : undefined}
        onPress={!unlocked ? () => setInfo(true) : equipped ? undefined : onEquip}
        style={({ pressed }) => ({
          width: '31.5%',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 12,
          paddingHorizontal: 4,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          borderWidth: equipped ? 2 : 1,
          borderColor: equipped ? colors.violet : colors.line,
          backgroundColor: equipped ? `${colors.violet}22` : pressed ? colors.lineStrong : colors.glass,
          opacity: saving ? 0.6 : 1,
        })}
      >
        <View style={{ opacity: unlocked ? 1 : 0.3 }}>{children}</View>
        {name ? (
          <T variant="caption" align="center" numberOfLines={2} style={{ fontFamily: fonts.semibold }}>
            {name}
          </T>
        ) : null}
        {!unlocked && (
          <T variant="caption" tone="fg3" align="center" numberOfLines={2} style={{ fontSize: 11, lineHeight: 14 }}>
            {'level' in req ? '🔒 ' : ''}
            {requirementLabel(req, true)}
          </T>
        )}
        {equipped && (
          <View
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.violet,
            }}
          >
            <T style={{ fontSize: 11, lineHeight: 14, color: '#fff', fontFamily: fonts.bold }}>✓</T>
          </View>
        )}
      </Pressable>
      {!unlocked && (
        <LockedInfo name={name || 'Емоция'} req={req} open={info} onClose={() => setInfo(false)}>
          {children}
        </LockedInfo>
      )}
    </>
  );
}

/** What a locked item takes, and how far along you are. */
function LockedInfo({
  name,
  req,
  open,
  onClose,
  children,
}: {
  name: string;
  req: Requirement;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  const colors = useColors();
  const sheet = useSheetPadding();
  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.ink }} contentContainerStyle={{ ...sheet, gap: 14 }}>
        <T variant="h1" role="heading">
          {name}
        </T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          {children && <View style={{ opacity: 0.6 }}>{children}</View>}
          <View style={{ flex: 1 }}>
            <T variant="small" tone="fg3">
              🔒 Отключва се с
            </T>
            <T variant="bodyStrong">{requirementLabel(req)}</T>
          </View>
        </View>
        {open && 'level' in req && <LevelProgress level={req.level} />}
        {open && 'achievement' in req && <AchievementSteps id={req.achievement} />}
        {open && 'mastery' in req && (
          <T variant="small" tone="fg2">
            Степента се мери спрямо останалите играчи, след поне {MASTERY.minAnswers} отговора в категорията.
          </T>
        )}
        <Button title="Затвори" variant="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

function LevelProgress({ level }: { level: number }) {
  const xp = useStore((s) => s.me?.xp ?? 0);
  const need = xpToReach(level);
  return (
    <View style={{ gap: 6 }}>
      <Progress value={need ? xp / need : 0} label={`До ниво ${level}`} valueText={`${fmt(xp)} от ${fmt(need)} XP`} />
      <T variant="small" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
        {fmt(xp)} / {fmt(need)} XP · още {fmt(Math.max(0, need - xp))} XP
      </T>
    </View>
  );
}

function AchievementSteps({ id }: { id: string }) {
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  const { data } = useLoad(() => api.achievements());
  const progress = data?.achievements.find((a) => a.id === id)?.progress ?? null;
  return (
    <View style={{ gap: 6 }}>
      {def && (
        <T variant="small" tone="fg2">
          {def.description}
        </T>
      )}
      {def?.goal !== undefined && progress !== null && (
        <>
          <Progress value={progress / def.goal} label={def.name} valueText={`${fmt(progress)} от ${fmt(def.goal)}`} />
          <T variant="small" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt(progress)} / {fmt(def.goal)}
          </T>
        </>
      )}
    </View>
  );
}

/**
 * A title to wear: picked with a tap once it's yours; until then, what it takes. `compact`: a mastery tier in its
 * category's row (`icon` and `label` say which; its name for a screen reader says it in full).
 */
function TitleRow({
  title: t,
  label,
  icon,
  open,
  equipped,
  onEquip,
  compact = false,
}: {
  title: TitleDef;
  label?: string;
  icon?: string;
  open: boolean;
  equipped: boolean;
  onEquip: () => void;
  compact?: boolean;
}) {
  const colors = useColors();
  const [info, setInfo] = useState(false);
  const state = open ? (equipped ? 'Избрана' : 'Избери') : compact ? 'заключена' : requirementLabel(t.req);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t.name}: ${open ? state.toLowerCase() : requirementLabel(t.req)}`}
        accessibilityState={open ? { selected: equipped } : undefined}
        onPress={!open ? () => setInfo(true) : equipped ? undefined : onEquip}
        style={({ pressed }) => ({
          flex: compact ? 1 : undefined,
          flexDirection: compact ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: compact ? 2 : 12,
          padding: compact ? 8 : 14,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          borderWidth: equipped ? 2 : 1,
          borderColor: equipped ? colors.violet : colors.line,
          backgroundColor: equipped ? `${colors.violet}22` : pressed ? colors.lineStrong : colors.glass,
        })}
      >
        {compact ? (
          <>
            <T style={{ fontSize: 18, lineHeight: 24, opacity: open ? 1 : 0.5 }}>{equipped ? '✓' : icon}</T>
            <T variant="small" numberOfLines={1} style={{ fontFamily: fonts.semibold }}>
              {label}
            </T>
            <T variant="caption" tone="fg3">
              {state}
            </T>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong">{t.name}</T>
              <T variant="caption" tone="fg3">
                {state}
              </T>
            </View>
            <T tone={equipped ? 'link' : 'fg3'}>{equipped ? '✓' : open ? '' : '🔒'}</T>
          </>
        )}
      </Pressable>
      {!open && <LockedInfo name={t.name} req={t.req} open={info} onClose={() => setInfo(false)} />}
    </>
  );
}

/** The level milestones reached and not yet decided (every fifth level: one of two), the lowest first. */
function ChoicesWaiting() {
  const colors = useColors();
  const choices = useStore((s) => s.me?.choices ?? []);
  const [first] = choices;
  if (!first) return null;
  return (
    <Card accent={colors.gold}>
      <T variant="h2" role="heading">
        🎁 Ниво {first.level}: избери награда
      </T>
      <T variant="small" tone="fg2">
        На всеки {CHOICE_EVERY} нива — едно от две.
        {choices.length === 2 ? ` Чака още едно: на ниво ${choices[1]?.level}.` : ''}
        {choices.length > 2 ? ` Чакат още ${choices.length - 1}: следващото е на ниво ${choices[1]?.level}.` : ''}
      </T>
      {/* Picked, the next one takes its place at once: a toast says what was taken. */}
      <LevelChoice choice={first} onPicked={(item) => toast({ kind: 'success', title: `Взе „${itemName(item)}“` })} />
    </Card>
  );
}
