/// <reference types="vite/client" />
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, EmailAuthProvider } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, getFirestore, enableNetwork, setLogLevel, getDoc, getDocs, getDocFromCache, DocumentReference, Query, getDocFromServer, doc } from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

export function getStoredFirebaseConfig() {
  const envDbId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
  const defaultDbId = firebaseConfigJson.firestoreDatabaseId || (envDbId && envDbId.trim().length > 0 ? envDbId.trim() : '');
  const defaultConfig = {
    apiKey: (firebaseConfigJson.apiKey && firebaseConfigJson.apiKey.trim().length > 10)
      ? firebaseConfigJson.apiKey.trim()
      : (import.meta.env.VITE_FIREBASE_API_KEY || ''),
    authDomain: firebaseConfigJson.authDomain || import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: firebaseConfigJson.projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: firebaseConfigJson.storageBucket || import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: firebaseConfigJson.messagingSenderId || import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: firebaseConfigJson.appId || import.meta.env.VITE_FIREBASE_APP_ID || '',
    firestoreDatabaseId: defaultDbId
  };

  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('custom_firebase_config');
    if (custom) {
      try {
        const parsed = JSON.parse(custom);
        const isApiKeyValid = typeof parsed?.apiKey === 'string' && parsed.apiKey.trim().length >= 20 && !parsed.apiKey.includes('YOUR_');
        if (
          !parsed || 
          !isApiKeyValid || 
          parsed.projectId !== defaultConfig.projectId ||
          !parsed.firestoreDatabaseId ||
          parsed.firestoreDatabaseId !== defaultDbId
        ) {
          console.warn('Purging invalid, incomplete or mismatched custom_firebase_config from localStorage');
          localStorage.removeItem('custom_firebase_config');
          return defaultConfig;
        }
        return {
          ...defaultConfig,
          ...parsed,
          apiKey: parsed.apiKey.trim()
        };
      } catch (e) {
        console.warn('Failed to parse custom_firebase_config from localStorage:', e);
        localStorage.removeItem('custom_firebase_config');
      }
    }
  }
  return defaultConfig;
}

const currentConfig = getStoredFirebaseConfig();

const firebaseConfig = {
  apiKey: currentConfig.apiKey,
  authDomain: currentConfig.authDomain,
  projectId: currentConfig.projectId,
  storageBucket: currentConfig.storageBucket,
  messagingSenderId: currentConfig.messagingSenderId,
  appId: currentConfig.appId,
};

const targetDatabaseId = currentConfig.firestoreDatabaseId;

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);

// Initialize Firestore instance using target database ID and memory cache to avoid IndexedDB assertions
function createDbInstance() {
  try {
    const dbSettings = { 
      localCache: memoryLocalCache(),
    };
    if (targetDatabaseId && targetDatabaseId !== '(default)' && targetDatabaseId.trim().length > 0) {
      try {
        return initializeFirestore(app, dbSettings, targetDatabaseId);
      } catch (e1) {
        return getFirestore(app, targetDatabaseId);
      }
    } else {
      try {
        return initializeFirestore(app, dbSettings);
      } catch (e1) {
        return getFirestore(app);
      }
    }
  } catch (e) {
    console.error("Error creating db instance:", e);
    try {
      return getFirestore(app);
    } catch (err) {
      console.error("Fallback getFirestore error:", err);
      return getFirestore(app);
    }
  }
}

export const db = createDbInstance();

export function extractErrorString(item: any): string {
  if (!item) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (item instanceof Error) {
    return `${item.name || ''} ${item.message || ''} ${item.stack || ''}`;
  }
  if (typeof item === 'object') {
    try {
      const parts = [
        item.name,
        item.message,
        item.stack,
        item.code,
        item.reason,
        item.detail,
        item.error ? extractErrorString(item.error) : ''
      ].filter(Boolean);
      let json = '';
      try { json = JSON.stringify(item); } catch { json = ''; }
      return `${parts.join(' ')} ${json}`.trim();
    } catch {
      return String(item);
    }
  }
  return String(item);
}

export const isFirestoreInternalAssertion = (msg: any) => {
  if (!msg) return false;
  const str = extractErrorString(msg).toLowerCase();
  return (
    str.includes('internal assertion failed') ||
    str.includes('unexpected state') ||
    str.includes('missing stream token') ||
    str.includes('target id already exists') ||
    str.includes('database is closing') ||
    str.includes('database is hidden') ||
    str.includes('closing/hidden') ||
    str.includes('da08') ||
    str.includes('c050') ||
    str.includes('ca9') ||
    str.includes('fi08') ||
    str.includes('12.17.0') ||
    (str.includes('firestore') && (str.includes('assertion') || str.includes('internal') || str.includes('unexpected') || str.includes('closing')))
  );
};

if (typeof window !== 'undefined') {
  try {
    setLogLevel('silent');
  } catch (e) {
    // Ignore if log level setting fails
  }

  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const combinedMsg = args.map(a => extractErrorString(a)).join(' ');
    if (isFirestoreInternalAssertion(combinedMsg) || args.some(a => isFirestoreInternalAssertion(a))) {
      console.warn('[Firestore Internal SDK Assertion Handled]:', combinedMsg);
      return;
    }
    originalConsoleError.apply(console, args);
  };

  const prevOnError = window.onerror;
  window.onerror = function (message, source, lineno, colno, error) {
    const msg = extractErrorString(message) + ' ' + extractErrorString(error);
    if (isFirestoreInternalAssertion(msg) || isFirestoreInternalAssertion(error)) {
      console.warn('[Firestore Internal SDK Assertion Intercepted]:', msg);
      return true;
    }
    if (prevOnError) {
      return prevOnError.call(window, message, source, lineno, colno, error);
    }
    return false;
  };

  window.addEventListener('online', () => {
    enableNetwork(db).catch((e) => console.error('Error re-enabling Firestore network on online:', e));
  });

  window.addEventListener('error', (event) => {
    const msg = extractErrorString(event.message) + ' ' + extractErrorString(event.error);
    if (isFirestoreInternalAssertion(msg) || isFirestoreInternalAssertion(event.error)) {
      console.warn('[Firestore Internal SDK Assertion Handled]:', msg);
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reasonMsg = extractErrorString(event.reason);
    if (isFirestoreInternalAssertion(reasonMsg) || isFirestoreInternalAssertion(event.reason) || reasonMsg.includes('WebSocket closed without opened') || reasonMsg.includes('failed to connect to websocket')) {
      console.warn('[Firestore Internal SDK Assertion Handled]:', reasonMsg);
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    }
  }, true);
}

export async function restoreFirestoreConnection() {
  try {
    await enableNetwork(db);
    return true;
  } catch (err) {
    console.error('Failed to restore Firestore connection:', err);
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Firestore operation timed out'));
    }, ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function safeGetDoc(docRef: DocumentReference) {
  try {
    return await withTimeout(getDoc(docRef), 3000);
  } catch (err: any) {
    console.warn("safeGetDoc primary attempt failed or timed out:", err?.message || err);
    try {
      return await getDocFromCache(docRef);
    } catch (cacheErr) {
      throw err;
    }
  }
}

export async function safeGetDocs(q: Query) {
  try {
    return await withTimeout(getDocs(q), 3000);
  } catch (err: any) {
    console.warn("safeGetDocs primary attempt failed or timed out:", err?.message || err);
    throw err;
  }
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'settings', 'global'));
    console.log('[Firestore] Connection successfully established and verified.');
  } catch (error: any) {
    if (error?.message?.includes('offline') || error?.code === 'unavailable') {
      console.warn("Firestore client offline, re-enabling network...");
      await enableNetwork(db).catch(() => {});
    }
  }
}

if (typeof window !== 'undefined') {
  setTimeout(() => {
    testConnection().catch(() => {});
  }, 500);
}

export const emailProvider = new EmailAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  if (isFirestoreInternalAssertion(error)) {
    console.warn('[Firestore Internal Error Suppressed]:', error);
    return;
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}




