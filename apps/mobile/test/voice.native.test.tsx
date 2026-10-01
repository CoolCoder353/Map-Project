/// <reference types="jest" />
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

it('uses the app’s own voice, which dips music, where it is built in', () => {
  const car = { speak: jest.fn(), stopSpeaking: jest.fn() };
  let Speech!: typeof import('expo-speech');
  jest.isolateModules(() => {
    Speech = require('expo-speech') as typeof import('expo-speech');
    jest.doMock('../modules/wayfinder-car', () => ({ native: car }));
    const voice = require('../src/nav/voice') as typeof import('../src/nav/voice');
    voice.speak('Turn left');
    voice.stopSpeaking();
  });
  expect(car.speak).toHaveBeenCalledWith('Turn left');
  expect(car.stopSpeaking).toHaveBeenCalled();
  expect(Speech.speak).not.toHaveBeenCalled();
});

it('falls back to Expo’s voice elsewhere', () => {
  // isolateModules gives the voice its own copy of expo-speech, so read it from the same registry.
  let Speech!: typeof import('expo-speech');
  jest.isolateModules(() => {
    // The first test's doMock outlives it, so say again that the module isn't built in.
    jest.doMock('../modules/wayfinder-car', () => ({ native: null }));
    Speech = require('expo-speech') as typeof import('expo-speech');
    const voice = require('../src/nav/voice') as typeof import('../src/nav/voice');
    voice.speak('Turn left');
    voice.stopSpeaking();
  });
  expect(Speech.speak).toHaveBeenCalledWith('Turn left', { language: 'en-AU', rate: 1.0 });
  expect(Speech.stop).toHaveBeenCalled();
});
