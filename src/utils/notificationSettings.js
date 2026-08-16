export const DEFAULT_NOTIFICATION_SETTINGS = {
  messageNotifications: 'all',
  statusNotifications: 'all',
  soundEnabled: true,
  soundVolume: 80,
  messagePreview: 'full',
  vibration: 'on',
  doNotDisturb: { enabled: false, startTime: '22:00', endTime: '07:00', allowedContacts: [] },
  groupNotifications: 'all',
  callNotifications: {
    voiceCallEnabled: true,
    videoCallEnabled: true,
    vibrateOnCall: true,
    missedCallReminders: true,
  },
  badgeCount: 'show',
  webNotifications: { enabled: true, soundOnWeb: true, syncReadAcrossDevices: true },
  priority: 'normal',
};

export function normalizeNotificationSettings(raw) {
  const src =
    raw && typeof raw.toObject === 'function'
      ? raw.toObject()
      : raw && typeof raw === 'object'
        ? raw
        : {};
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...src,
    doNotDisturb: {
      ...DEFAULT_NOTIFICATION_SETTINGS.doNotDisturb,
      ...(src.doNotDisturb || {}),
      allowedContacts: Array.isArray(src.doNotDisturb?.allowedContacts)
        ? src.doNotDisturb.allowedContacts.map((id) => String(id._id || id))
        : [],
    },
    callNotifications: {
      ...DEFAULT_NOTIFICATION_SETTINGS.callNotifications,
      ...(src.callNotifications || {}),
    },
    webNotifications: {
      ...DEFAULT_NOTIFICATION_SETTINGS.webNotifications,
      ...(src.webNotifications || {}),
    },
  };
}
