/**
 * Native System Notifications for Mobile (Android Notification Bar) and Desktop (PC Notification Center)
 * Utilizes Service Worker Registration showNotification for full PWA and Android compatibility.
 */

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

export async function requestSystemNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) {
    return 'denied';
  }

  try {
    // Ensure service worker is registered
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (swErr) {
        console.warn('Service Worker registration warning:', swErr);
      }
    }

    const permission = await Notification.requestPermission();
    return permission;
  } catch (error) {
    console.error('Error requesting notification permission:', error);
    return 'denied';
  }
}

export interface SystemNotificationOptions {
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: any;
  silent?: boolean;
}

export async function showSystemNotification(
  title: string,
  options: SystemNotificationOptions = {}
): Promise<boolean> {
  if (!isNotificationSupported()) return false;

  if (Notification.permission !== 'granted') {
    return false;
  }

  const notificationOptions = {
    body: options.body || '',
    icon: options.icon || '/logo_dunor.png',
    badge: options.badge || '/logo_dunor.png',
    tag: options.tag || `dunor-${Date.now()}`,
    vibrate: [200, 100, 200],
    renotify: true,
    data: {
      url: options.url || '/',
      ...(options.data || {}),
    },
  };

  // Try vibration API if on mobile device
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch (e) {}

  // 1. Preferred method: Service Worker Registration (Required for Android status bar and PWA background)
  if ('serviceWorker' in navigator) {
    try {
      // Race ready with a 2-second timeout in case SW is not yet active
      const regPromise = navigator.serviceWorker.ready;
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
      const registration = await Promise.race([regPromise, timeoutPromise]);

      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, notificationOptions);
        return true;
      }
    } catch (swError) {
      console.warn('Service Worker showNotification notice, attempting fallback:', swError);
    }
  }

  // 2. Desktop browser fallback: new Notification() constructor
  try {
    const notif = new Notification(title, {
      body: notificationOptions.body,
      icon: notificationOptions.icon,
      tag: notificationOptions.tag,
    });

    notif.onclick = (e) => {
      e.preventDefault();
      window.focus();
      notif.close();
    };

    return true;
  } catch (constructorError) {
    console.warn('Notification constructor error (normal on some mobile browsers without SW):', constructorError);
    return false;
  }
}

export async function sendTestNotification(): Promise<boolean> {
  const perm = await requestSystemNotificationPermission();
  if (perm !== 'granted') {
    return false;
  }

  return await showSystemNotification('🔔 Notificaciones DUNOR Activas', {
    body: 'Las alertas de incidencias, canalizaciones y tareas aparecerán aquí en tu barra de notificaciones.',
    tag: 'test-notification',
    url: '/',
  });
}
