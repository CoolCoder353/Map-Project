import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';

/**
 * The map is native code: a failure inside it would otherwise take the whole app down. This
 * keeps the rest of the screen usable and says what happened.
 */
export class MapErrorBoundary extends Component<{ children: ReactNode; fallbackNote?: string }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : 'The map could not be shown' };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ textAlign: 'center', opacity: 0.8 }}>
          {this.props.fallbackNote ?? 'The map could not be shown. Routes and search still work.'}
        </Text>
        <Text style={{ textAlign: 'center', opacity: 0.5, fontSize: 12, marginTop: 8 }}>{this.state.message}</Text>
      </View>
    );
  }
}
