/** Runs before every Jest test file. */
import { configure } from '@testing-library/react-native';

// findBy/waitFor give up after 1 s by default; a busy CI machine can need longer.
configure({ asyncUtilTimeout: 5000 });

// No car app in tests unless a test brings its own fake (fakeCarNative in fakes.tsx).
jest.mock('../modules/wayfinder-car', () => ({ native: null }));
