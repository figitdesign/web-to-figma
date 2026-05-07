/**
 * Tiny event bus shared by the content-script entrypoint and the React UI
 * mounted inside the shadow root. The entrypoint dispatches actions; the React
 * tree subscribes and renders accordingly.
 *
 * Lives outside React because the entrypoint needs imperative access to the UI
 * before/after the React tree mounts.
 */

export type UiAction = { type: "start-picker" } | { type: "cancel-picker" };

type Listener = (action: UiAction) => void;

const listeners = new Set<Listener>();

export const controller = {
  dispatch(action: UiAction): void {
    for (const listener of listeners) {
      listener(action);
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
