/**
 * Cache Isolation Utility for CodeWithMee
 * Ensures all user-specific data in browser storage is strictly namespaced by authenticated user ID.
 */

const DEVICE_PREFERENCE_KEYS = new Set([
  'cwm-theme',
  'cwm_theme',
  'cwm_custom_cursor',
  'cwm_editor_settings',
  'cwm_space_chat_fab_pos',
  'cwm_notes_widget_fab_pos',
]);

/**
 * Returns a user-scoped storage key for user-specific data.
 * @param {string | null | undefined} userId
 * @param {string} keyName
 * @returns {string}
 */
export function getUserStorageKey(userId, keyName) {
  if (!userId || typeof userId !== 'string') {
    return `cwm_anon_${keyName}`;
  }
  return `cwm_${userId}_${keyName}`;
}

/**
 * Cleans up legacy/obsolete unscoped storage keys from previous builds.
 * Preserves device-wide preference keys.
 */
export function cleanupObsoleteStorageKeys() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      // Identify obsolete unscoped keys that lack user ID namespacing
      if (
        key === 'cwm_saved_roadmaps' ||
        key === 'cwm_saved_notes' ||
        key.startsWith('cwm_vid_progress_') ||
        key === 'notesWidgetFabPos' ||
        key === 'spaceChatFabPos' ||
        key === 'notesDesktopOnlyDismissed' ||
        key === 'mobileWarningDismissed'
      ) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        // Storage remove error fallback
        void err;
      }
    });
  } catch (err) {
    // Storage access error fallback
    void err;
  }
}

/**
 * Clears all user-scoped storage keys upon logout or account switch,
 * preserving device-wide preferences.
 */
export function clearUserScopedStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      if (key.startsWith('cwm_') && !DEVICE_PREFERENCE_KEYS.has(key)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        // Storage remove error fallback
        void err;
      }
    });
  } catch (err) {
    // Storage access error fallback
    void err;
  }
}
