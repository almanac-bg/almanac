// The parts of the Sentry SDK the app uses, as the one module loaded lazily: importing the package's namespace instead
// bundles all of it (replays, feedback, tracing), several times the size.
export { captureException, init, setUser } from '@sentry/browser';
