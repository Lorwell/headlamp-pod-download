import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import React from 'react';

/** Must match the `name` field in package.json and the plugin folder name. */
export const PLUGIN_NAME = 'headlamp-pod-download';

/** Minimal `{{var}}` interpolation used when the plugin i18n is not ready yet. */
export function interpolate(key: string, values?: Record<string, unknown>): string {
  if (!values) {
    return key;
  }
  return key.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match
  );
}

/**
 * Translate a string of this plugin.
 *
 * Keys are the English source strings, so a missing translation (or the short
 * window before the locale files are loaded) still renders readable text.
 */
export function useT() {
  const { t, ready } = useTranslation(PLUGIN_NAME);

  return React.useCallback(
    (key: string, values?: Record<string, unknown>): string => {
      if (!ready) {
        return interpolate(key, values);
      }
      return t(key, values);
    },
    [ready, t]
  );
}
