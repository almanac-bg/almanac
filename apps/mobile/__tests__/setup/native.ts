// What the app's native modules can't do under Jest, done for every test: the sounds play nowhere (expo-audio's
// player needs the phone's audio). A test that cares what played spies on lib/sounds instead.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({ play: jest.fn(), seekTo: jest.fn(async () => {}), remove: jest.fn() })),
  setAudioModeAsync: jest.fn(async () => {}),
}));
