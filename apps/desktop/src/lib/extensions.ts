export type ExtensionId = "security" | "multiLens";

/**
 * Optional surfaces stay implemented, but the core app should not depend on
 * them. Flip these switches when you explicitly want to bring a feature back.
 */
export const APP_EXTENSIONS = {
  security: false,
  multiLens: false,
} as const satisfies Record<ExtensionId, boolean>;

export const isExtensionEnabled = (id: ExtensionId) => APP_EXTENSIONS[id];
