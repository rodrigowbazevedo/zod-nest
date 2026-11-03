import { singleton } from '../schema/singleton.js';

interface DeclaredLinksState {
  any: boolean;
}

const state = (): DeclaredLinksState =>
  singleton<DeclaredLinksState>('declared-links', () => ({ any: false }));

export const markLinksDeclared = (): void => {
  state().any = true;
};

export const anyLinksDeclared = (): boolean => state().any;
