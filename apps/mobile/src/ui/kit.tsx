import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { radius, space, useTheme } from '../lib/theme';

export function Title({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[{ color: t.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.2 }, style]} accessibilityRole="header">{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.text, fontSize: 15, fontWeight: '700', marginTop: space[2] }} accessibilityRole="header">{children}</Text>;
}

export function Body({ children, muted, style, numberOfLines }: { children: ReactNode; muted?: boolean; style?: TextStyle; numberOfLines?: number }) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ color: muted ? t.text2 : t.text, fontSize: 15, lineHeight: 21 }, style]}>{children}</Text>;
}

export function Small({ children, color, style }: { children: ReactNode; color?: string; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[{ color: color ?? t.text2, fontSize: 13, fontVariant: ['tabular-nums'] }, style]}>{children}</Text>;
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ label, onPress, kind = 'primary', icon: Icon, busy, disabled, style, compact }: {
  label: string;
  onPress: PressableProps['onPress'];
  kind?: ButtonKind;
  icon?: LucideIcon;
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  compact?: boolean;
}) {
  const t = useTheme();
  const bg = { primary: t.accent, secondary: t.surface, ghost: 'transparent', danger: t.surface }[kind];
  const fg = { primary: t.onAccent, secondary: t.accent, ghost: t.text2, danger: t.danger }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        compact && { minHeight: 36, paddingHorizontal: space[3] },
        { backgroundColor: bg, borderColor: kind === 'secondary' || kind === 'danger' ? t.borderStrong : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : Icon ? <Icon size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: compact ? 14 : 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.text3}
        selectionColor={t.accent}
        style={[styles.input, { color: t.text, backgroundColor: t.surface, borderColor: error ? t.danger : t.borderStrong }]}
        {...props}
      />
      {hint && !error ? <Small color={t.text3}>{hint}</Small> : null}
      {error ? <Small color={t.danger}>{error}</Small> : null}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; icon?: LucideIcon }>; onChange(v: T): void; label: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segmented, { backgroundColor: t.surface3 }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: t.surface, elevation: 1 }]}
          >
            {o.icon ? <o.icon size={16} color={on ? t.text : t.text2} /> : null}
            <Text style={{ color: on ? t.text : t.text2, fontWeight: '600', fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function NewBadge({ text }: { text: string }) {
  const t = useTheme();
  // Striped border + label so novelty isn't carried by colour alone.
  return (
    <View style={{ borderRadius: radius.pill, backgroundColor: t.exploreSoft, borderWidth: 1, borderStyle: 'dashed', borderColor: t.explore, paddingHorizontal: 8, paddingVertical: 1, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.explore, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function Card({ children, selected, tone = 'accent', onPress, style }: { children: ReactNode; selected?: boolean; tone?: 'accent' | 'explore'; onPress?: () => void; style?: ViewStyle }) {
  const t = useTheme();
  const border = selected ? (tone === 'explore' ? t.explore : t.accent) : t.border;
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      {...(onPress ? { onPress, accessibilityRole: 'button' as const, accessibilityState: { selected: !!selected } } : {})}
      style={[{ borderWidth: selected ? 2 : 1, borderColor: border, borderRadius: radius.control, backgroundColor: t.surface, padding: space[3] }, style]}
    >
      {children}
    </Wrapper>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'warning' }) {
  const t = useTheme();
  const bg = tone === 'error' ? t.dangerSoft : tone === 'warning' ? t.warningSoft : t.surface2;
  const fg = tone === 'error' ? t.danger : tone === 'warning' ? t.warning : t.text2;
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={{ backgroundColor: bg, borderRadius: radius.control, padding: space[3] }}>
      <Text style={{ color: fg, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: space[5], gap: space[2] }}>
      <Icon size={28} color={t.text3} />
      <Text style={{ color: t.text2, textAlign: 'center', fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ padding: space[5], alignItems: 'center' }} accessibilityLabel="Loading">
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2], paddingHorizontal: space[4], borderRadius: radius.pill, borderWidth: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space[3], fontSize: 16 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, gap: 2, alignSelf: 'flex-start' },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space[3], borderRadius: radius.pill },
});
