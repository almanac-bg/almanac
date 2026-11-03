import { useLocalSearchParams } from 'expo-router';
import { DailyScreen } from '@/daily/DailyScreen';

/** /daily/<code>: today's questions from a friend's link, their result there to beat. */
export default function DailyByLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <DailyScreen code={code ?? null} />;
}
