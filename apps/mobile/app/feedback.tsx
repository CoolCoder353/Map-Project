import {
  type CarReport,
  type CarReportDetails,
  CarReportListSchema,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_TYPE_LABEL,
  type FeedbackCreate,
  type FeedbackType,
} from '@wayfinder/shared/schemas';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, Bug, ImagePlus, Lightbulb, MessageSquare, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Image, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '../src/lib/api';
import { formatDateTime } from '../src/lib/format';
import { goBack } from '../src/lib/goBack';
import { CONTENT_MAX_WIDTH, useLayout } from '../src/lib/layout';
import { lastMapView } from '../src/lib/mapView';
import { space, useTheme } from '../src/lib/theme';
import { Body, Button, Card, Field, Notice, Segmented, Small, Title } from '../src/ui/kit';

type Shot = { uri: string; base64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: number };

export default function FeedbackScreen() {
  const t = useTheme();
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [includeMap, setIncludeMap] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // The car's Report sends what it showed with one tap and says to explain later from here: your
  // recent ones, to pick one and say what was wrong.
  const [carReports, setCarReports] = useState<CarReport[]>([]);
  const [about, setAbout] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // None to show is no reason to stop anyone sending something new.
    void api
      .request('api/feedback/car-reports', { schema: CarReportListSchema })
      .then((r) => live && setCarReports(r.reports))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const mapView = lastMapView();
  // Where a hardware keyboard is likely (not a phone), Enter sends, as it does in a chat box.
  const enterSends = !useLayout().phone;

  const pick = async () => {
    setError(null);
    let res: ImagePicker.ImagePickerResult;
    try {
      // The system photo picker: no storage permission needed.
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, base64: true });
    } catch (e) {
      setError(`Couldn’t open your photos. ${errorMessage(e)}`);
      return;
    }
    const a = res.canceled ? null : res.assets?.[0];
    if (!a) return;
    if (!a.base64) {
      setError('Couldn’t read that image. Try a different screenshot.');
      return;
    }
    const mediaType = a.mimeType === 'image/png' || a.mimeType === 'image/webp' ? a.mimeType : 'image/jpeg';
    const bytes = Math.floor((a.base64.length * 3) / 4);
    if (bytes > FEEDBACK_SCREENSHOT_MAX_BYTES) {
      setError('That image is over 2 MB. Try a screenshot of just the part that matters.');
      return;
    }
    setShot({ uri: a.uri, base64: a.base64, mediaType, bytes });
  };

  const send = async () => {
    if (busy || message.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      if (about) {
        const details: CarReportDetails = { message: message.trim(), ...(shot ? { screenshot: { mediaType: shot.mediaType, data: shot.base64 } } : {}) };
        await api.request(`api/feedback/${about}/details`, { method: 'POST', body: details, timeoutMs: 120_000 });
        setSent(true);
        return;
      }
      const body: FeedbackCreate = {
        type,
        message: message.trim(),
        context: {
          screen: 'Android settings',
          platform: 'android',
          appVersion: Constants.expoConfig?.version ?? 'unknown',
          device: `Android ${String(Platform.Version)}${Constants.deviceName ? ` · ${Constants.deviceName}` : ''}`.slice(0, 400),
          ...(includeMap && mapView ? { mapView } : {}),
        },
        ...(shot ? { screenshot: { mediaType: shot.mediaType, data: shot.base64 } } : {}),
      };
      // A screenshot is up to 2 MB, which takes a while on a weak signal.
      await api.request('api/feedback', { method: 'POST', body, timeoutMs: 120_000 });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.surface }}>
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[4], width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Button label="Settings" kind="ghost" icon={ArrowLeft} compact onPress={() => goBack('/settings')} style={{ alignSelf: 'flex-start' }} />
        <Title>Send feedback</Title>
        {sent ? (
          <>
            <Notice tone="info">{about ? 'Thanks — that’s been added to your report from the car.' : 'Thanks — your feedback was sent.'}</Notice>
            <Button label="Done" onPress={() => goBack('/settings')} />
          </>
        ) : (
          <>
            {carReports.length ? (
              <View style={{ gap: space[2] }}>
                <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>Reports from the car</Text>
                <Small>Pick one to say what was wrong, or leave them all unpicked to send something new.</Small>
                {carReports.map((r) => (
                  <Card key={r.id} selected={about === r.id} onPress={() => setAbout(about === r.id ? null : r.id)}>
                    <Body>{formatDateTime(r.createdAt)}</Body>
                    <Small>{`${r.showing ?? 'No directions showing'}${r.detailsAdded ? ' · details added' : ''}`}</Small>
                  </Card>
                ))}
              </View>
            ) : null}
            {about ? null : (
            <Segmented<FeedbackType>
              label="Kind of feedback"
              value={type}
              onChange={setType}
              options={[
                { value: 'bug', label: FEEDBACK_TYPE_LABEL.bug, icon: Bug },
                { value: 'idea', label: FEEDBACK_TYPE_LABEL.idea, icon: Lightbulb },
                { value: 'other', label: FEEDBACK_TYPE_LABEL.other, icon: MessageSquare },
              ]}
            />
            )}
            <Field
              label={about || type === 'bug' ? 'What went wrong?' : type === 'idea' ? 'What would you like?' : 'Your message'}
              value={message}
              onChangeText={setMessage}
              multiline
              {...(enterSends ? { submitBehavior: 'submit' as const, returnKeyType: 'send' as const, onSubmitEditing: () => void send() } : {})}
              numberOfLines={5}
              maxLength={4000}
              textAlignVertical="top"
              style={{ minHeight: 120 }}
              placeholder={type === 'bug' ? 'What you did, what you expected, and what happened instead.' : undefined}
            />
            <View style={{ gap: space[2] }}>
              <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>Screenshot</Text>
              {shot ? (
                <>
                  <Image source={{ uri: shot.uri }} accessibilityLabel="Screenshot that will be sent" style={{ width: '100%', height: 220, borderRadius: 8 }} resizeMode="contain" />
                  <View style={{ flexDirection: 'row', gap: space[2] }}>
                    <Button label="Replace" kind="ghost" icon={ImagePlus} compact onPress={() => void pick()} />
                    <Button label="Remove" kind="ghost" icon={Trash2} compact onPress={() => setShot(null)} />
                  </View>
                </>
              ) : (
                <>
                  <Button label="Attach a screenshot" kind="secondary" icon={ImagePlus} compact onPress={() => void pick()} style={{ alignSelf: 'flex-start' }} />
                  <Small>Take a normal phone screenshot of the problem first, then attach it here.</Small>
                </>
              )}
            </View>
            {mapView && !about ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                <View style={{ flex: 1 }}>
                  <Body>Include what the map was showing</Body>
                  <Small>The map’s centre and zoom. Nothing else about where you are is sent.</Small>
                </View>
                <Switch accessibilityLabel="Include what the map was showing" value={includeMap} onValueChange={setIncludeMap} trackColor={{ true: t.accent, false: t.borderStrong }} />
              </View>
            ) : null}
            {about ? null : <Small>Also sent: your Android version, phone model and the app version.</Small>}
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button label="Send" onPress={() => void send()} busy={busy} disabled={message.trim().length < 3} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
