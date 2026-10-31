// Tiny in-house navigation: three tabs plus a stack of overlays.
export type Tab = 'friends' | 'places' | 'me';
export type Route =
  | { screen: 'friend'; id: string }
  | { screen: 'addFriend' }
  | { screen: 'newPlace'; friendId?: string }
  | { screen: 'primer'; kind: 'foreground' | 'background' | 'notifications'; friendId?: string; denied?: boolean }
  | { screen: 'backgroundConsent'; friendId: string };
export type NavState = Readonly<{ tab: Tab; stack: readonly Route[] }>;
export type NavAction =
  | { type: 'tab'; tab: Tab; then?: Route }
  | { type: 'push'; route: Route }
  | { type: 'pop' }
  | { type: 'reset' };

export const initialNav: NavState = { tab: 'friends', stack: [] };

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'tab':
      return { tab: action.tab, stack: action.then ? [action.then] : [] };
    case 'push': {
      const top = state.stack[state.stack.length - 1];
      if (top && top.screen === 'friend' && action.route.screen === 'friend') {
        return { ...state, stack: [...state.stack.slice(0, -1), action.route] };
      }
      return { ...state, stack: [...state.stack, action.route] };
    }
    case 'pop':
      return state.stack.length ? { ...state, stack: state.stack.slice(0, -1) } : state;
    case 'reset':
      return initialNav;
  }
}
