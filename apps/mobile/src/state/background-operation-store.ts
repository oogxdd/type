import { create } from "zustand";

type BackgroundOperationState = {
  count: number;
  begin: () => void;
  end: () => void;
};

/** Native pickers/transfers that must not be unmounted by Type's own auto-lock. */
export const useBackgroundOperationStore = create<BackgroundOperationState>(
  (set) => ({
    count: 0,
    begin: () => set((state) => ({ count: state.count + 1 })),
    end: () => set((state) => ({ count: Math.max(0, state.count - 1) })),
  })
);
