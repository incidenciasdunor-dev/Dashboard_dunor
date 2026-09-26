import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  X, 
  Send, 
  Paperclip, 
  Image as ImageIcon, 
  Clock, 
  Lock, 
  Search, 
  User as UserIcon, 
  Download, 
  FileText, 
  Palette, 
  ArrowLeft, 
  Minimize2, 
  Maximize2,
  Check,
  CheckCheck,
  GraduationCap,
  Sparkles,
  School,
  File,
  Users,
  UserPlus,
  BellRing,
  Bell,
  MessageSquare,
  Plus,
  ArrowDown
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  updateDoc, 
  setDoc, 
  getDocs 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, TeacherMessage, TeacherConversation, normalizeUserRole } from '../types';
import { cn, getUserEducationLevel } from '../lib/utils';
import { format } from 'date-fns';
import { 
  showSystemNotification, 
  requestSystemNotificationPermission, 
  getNotificationPermission 
} from '../lib/nativeNotifications';

export type ChatTheme = 'stealth-slate' | 'dark-blackout' | 'emerald-glass' | 'academic-warm';

interface ActiveChat {
  id: string; // conversationId
  isGroup: boolean;
  name: string;
  partner?: UserProfile; // for 1-to-1
  participantUids: string[];
  participantNames: Record<string, string>;
  participantEmails?: Record<string, string>;
}

interface TeacherSecretChatProps {
  currentUser: UserProfile;
  allUsers: UserProfile[];
  sendNotification?: (
    targetUserId: string | string[],
    title: string,
    message: string,
    incidentId?: string,
    skipAdmins?: boolean,
    extraData?: any
  ) => Promise<void>;
  externalOpenPartner?: UserProfile | null;
  onCloseExternal?: () => void;
  ttlHours?: number;
}

export const THEME_CONFIGS: Record<ChatTheme, {
  name: string;
  badge: string;
  containerBg: string;
  headerBg: string;
  sidebarBg: string;
  chatAreaBg: string;
  incomingBubble: string;
  outgoingBubble: string;
  border: string;
  accentText: string;
  inputBg: string;
}> = {
  'stealth-slate': {
    name: 'Pizarra Minimal (Discreta)',
    badge: 'bg-slate-700 text-slate-200 border-slate-600',
    containerBg: 'bg-slate-900/95 text-slate-100 backdrop-blur-md shadow-2xl',
    headerBg: 'bg-slate-800/90 border-b border-slate-700/80',
    sidebarBg: 'bg-slate-900/90 border-r border-slate-800',
    chatAreaBg: 'bg-slate-950/70',
    incomingBubble: 'bg-slate-800 text-slate-100 border border-slate-700/70',
    outgoingBubble: 'bg-indigo-600 text-white shadow-sm',
    border: 'border-slate-700',
    accentText: 'text-indigo-400',
    inputBg: 'bg-slate-800/80 text-white placeholder-slate-400 border-slate-700'
  },
  'dark-blackout': {
    name: 'Sigilo Nocturno (Espía)',
    badge: 'bg-emerald-950 text-emerald-400 border-emerald-800',
    containerBg: 'bg-black/95 text-neutral-100 backdrop-blur-xl shadow-2xl',
    headerBg: 'bg-neutral-950 border-b border-neutral-800',
    sidebarBg: 'bg-neutral-950 border-r border-neutral-900',
    chatAreaBg: 'bg-black',
    incomingBubble: 'bg-neutral-900 text-neutral-100 border border-neutral-800',
    outgoingBubble: 'bg-emerald-700 text-emerald-50 border border-emerald-600',
    border: 'border-neutral-800',
    accentText: 'text-emerald-400',
    inputBg: 'bg-neutral-900 text-white placeholder-neutral-500 border-neutral-800'
  },
  'emerald-glass': {
    name: 'Neo-Cristal (Esmeralda Fresh)',
    badge: 'bg-teal-900/70 text-teal-200 border-teal-700/50',
    containerBg: 'bg-gradient-to-br from-teal-950/95 via-slate-900/95 to-emerald-950/95 text-white backdrop-blur-2xl shadow-2xl',
    headerBg: 'bg-teal-900/40 border-b border-teal-700/40 backdrop-blur-md',
    sidebarBg: 'bg-teal-950/40 border-r border-teal-800/30',
    chatAreaBg: 'bg-slate-950/50',
    incomingBubble: 'bg-teal-900/50 text-teal-50 border border-teal-700/40',
    outgoingBubble: 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md',
    border: 'border-teal-700/50',
    accentText: 'text-teal-300',
    inputBg: 'bg-teal-950/60 text-white placeholder-teal-300/50 border-teal-700/40'
  },
  'academic-warm': {
    name: 'Cuaderno Editorial (Sepia Cálido)',
    badge: 'bg-amber-800 text-amber-100 border-amber-700',
    containerBg: 'bg-stone-900 text-stone-100 shadow-2xl',
    headerBg: 'bg-stone-800/90 border-b border-stone-700',
    sidebarBg: 'bg-stone-900 border-r border-stone-800',
    chatAreaBg: 'bg-stone-950/80',
    incomingBubble: 'bg-stone-800 text-stone-100 border border-stone-700',
    outgoingBubble: 'bg-amber-700 text-amber-50 shadow-sm',
    border: 'border-stone-700',
    accentText: 'text-amber-400',
    inputBg: 'bg-stone-800/90 text-white placeholder-stone-400 border-stone-700'
  }
};

// Safe Web Audio API synthesizer for instant pleasant chime on new message
const playChatChime = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Ignore audio restrictions
  }
};

export const TeacherSecretChat: React.FC<TeacherSecretChatProps> = ({
  currentUser,
  allUsers,
  sendNotification,
  externalOpenPartner,
  onCloseExternal,
  ttlHours = 6
}) => {
  const isTeacher = normalizeUserRole(currentUser.role) === 'TEACHER';
  const effectiveTtlHours = Math.max(1, ttlHours);
  const ttlMs = effectiveTtlHours * 60 * 60 * 1000;

  // Secret Corner activation sequence state
  const [cornerTaps, setCornerTaps] = useState<string[]>([]);
  const [tapFeedback, setTapFeedback] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Unread badge and notification tracking for minimized bar
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastUnreadSender, setLastUnreadSender] = useState<string | null>(null);
  const [lastUnreadPreview, setLastUnreadPreview] = useState<string | null>(null);
  const [hasNewMessagePulse, setHasNewMessagePulse] = useState(false);

  // Active chat (direct 1-to-1 or group)
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'contacts' | 'groups'>('active');
  const [allUserMessages, setAllUserMessages] = useState<TeacherMessage[]>([]);

  // Group chat management modals
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [showAddParticipantsModal, setShowAddParticipantsModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedGroupMemberUids, setSelectedGroupMemberUids] = useState<string[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');

  // Persisted group conversations
  const [groups, setGroups] = useState<TeacherConversation[]>([]);

  // Active theme
  const [theme, setTheme] = useState<ChatTheme>(() => {
    return (localStorage.getItem('dunor_teacher_chat_theme') as ChatTheme) || 'stealth-slate';
  });
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  // Messages state
  const [messages, setMessages] = useState<TeacherMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachedFile, setAttachedFile] = useState<{
    data: string;
    name: string;
    type: 'image' | 'file';
    size: number;
  } | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Typing indicator state
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingFlagRef = useRef<boolean>(false);

  // Native notification permission state
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    return getNotificationPermission();
  });

  // Image preview modal
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastActiveChatIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sequenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstLoadRef = useRef<boolean>(true);

  // Helper function to reliably position chat at the latest message
  const scrollToBottom = (behavior: 'auto' | 'smooth' = 'smooth') => {
    // 1. Scroll container directly (prevents parent window or iframe scrolling)
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      if (behavior === 'auto') {
        container.scrollTop = container.scrollHeight;
      } else {
        try {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
          });
        } catch {
          container.scrollTop = container.scrollHeight;
        }
      }
    }
    // 2. Also ensure end marker is brought into view
    if (messagesEndRef.current) {
      try {
        messagesEndRef.current.scrollIntoView({
          behavior: behavior === 'auto' ? 'auto' : 'smooth',
          block: 'end'
        });
      } catch {}
    }
  };

  // Monitor scroll position to know if user is reading previous messages
  const handleMessagesScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isNearBottom = distanceFromBottom < 80;
    isNearBottomRef.current = isNearBottom;
    setShowScrollBottomBtn(!isNearBottom);
  };

  // Active theme configuration
  const currentTheme = THEME_CONFIGS[theme];

  // Helper to persist theme choice
  const handleSelectTheme = (newTheme: ChatTheme) => {
    setTheme(newTheme);
    localStorage.setItem('dunor_teacher_chat_theme', newTheme);
    setShowThemeMenu(false);
  };

  // Filter only active registered teachers, excluding current user
  const teacherContacts = useMemo(() => {
    return allUsers.filter(u => {
      const role = normalizeUserRole(u.role);
      const isT = role === 'TEACHER';
      const isActive = u.status !== 'BLOQUEADO' && !u.isBlocked;
      const isNotMe = u.uid !== currentUser.uid && u.email?.toLowerCase() !== currentUser.email?.toLowerCase();
      return isT && isActive && isNotMe;
    });
  }, [allUsers, currentUser]);

  const filteredContacts = useMemo(() => {
    if (!searchQuery.trim()) return teacherContacts;
    const q = searchQuery.toLowerCase();
    return teacherContacts.filter(u => {
      const nameMatch = u.name?.toLowerCase().includes(q);
      const emailMatch = u.email?.toLowerCase().includes(q);
      const levelMatch = getUserEducationLevel(u)?.toLowerCase().includes(q);
      return nameMatch || emailMatch || levelMatch;
    });
  }, [teacherContacts, searchQuery]);

  // Helper to format timestamps for active chat preview
  const formatMessageTime = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Build active conversations list (chats already initiated, 1-on-1 or groups)
  const activeConversations = useMemo(() => {
    if (!currentUser) return [];

    const convMap = new Map<string, TeacherMessage[]>();
    allUserMessages.forEach(msg => {
      if (!convMap.has(msg.conversationId)) {
        convMap.set(msg.conversationId, []);
      }
      convMap.get(msg.conversationId)!.push(msg);
    });

    const list: {
      conversationId: string;
      isGroup: boolean;
      name: string;
      partner?: UserProfile;
      group?: TeacherConversation;
      lastMessage: TeacherMessage;
      level?: string;
    }[] = [];

    convMap.forEach((msgs, convId) => {
      msgs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const latestMsg = msgs[0];
      const matchingGroup = groups.find(g => g.id === convId);

      if (matchingGroup) {
        list.push({
          conversationId: convId,
          isGroup: true,
          name: matchingGroup.name || 'Grupo Docente',
          group: matchingGroup,
          lastMessage: latestMsg
        });
      } else {
        let partnerUid = latestMsg.participantUids?.find(u => u !== currentUser.uid);
        if (!partnerUid) {
          partnerUid = latestMsg.senderUid === currentUser.uid ? latestMsg.receiverUid : latestMsg.senderUid;
        }

        const partnerTeacher: UserProfile = teacherContacts.find(t => t.uid === partnerUid) || {
          uid: partnerUid || 'unknown',
          name: latestMsg.senderUid === currentUser.uid ? (latestMsg.receiverName || 'Docente') : (latestMsg.senderName || 'Docente'),
          email: latestMsg.senderUid === currentUser.uid ? (latestMsg.receiverEmail || '') : (latestMsg.senderEmail || ''),
          role: 'TEACHER'
        };

        const level = getUserEducationLevel(partnerTeacher);

        list.push({
          conversationId: convId,
          isGroup: false,
          name: partnerTeacher.name || 'Docente',
          partner: partnerTeacher,
          lastMessage: latestMsg,
          level
        });
      }
    });

    // Also include registered groups so created groups appear as active
    groups.forEach(grp => {
      if (!convMap.has(grp.id)) {
        const grpCreatedAt = grp.lastMessageAt || grp.createdAt || Date.now();
        list.push({
          conversationId: grp.id,
          isGroup: true,
          name: grp.name || 'Grupo Docente',
          group: grp,
          lastMessage: {
            id: `grp_init_${grp.id}`,
            conversationId: grp.id,
            senderUid: grp.createdByUid || currentUser.uid,
            senderName: grp.participantNames?.[grp.createdByUid] || 'Docente',
            senderEmail: grp.participantEmails?.[grp.createdByUid] || '',
            participantUids: grp.participantUids,
            text: grp.lastMessageText || 'Grupo creado',
            createdAt: grpCreatedAt,
            expiresAt: grpCreatedAt + ttlMs,
            read: true
          }
        });
      }
    });

    list.sort((a, b) => (b.lastMessage.createdAt || 0) - (a.lastMessage.createdAt || 0));
    return list;
  }, [allUserMessages, groups, currentUser, teacherContacts]);

  const filteredActiveConversations = useMemo(() => {
    if (!searchQuery.trim()) return activeConversations;
    const q = searchQuery.toLowerCase().trim();
    return activeConversations.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.lastMessage.text?.toLowerCase().includes(q) ||
      c.partner?.email?.toLowerCase().includes(q)
    );
  }, [activeConversations, searchQuery]);

  // Request native notifications permission
  const handleRequestNotifications = async () => {
    const perm = await requestSystemNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      showSystemNotification('🔔 Notificaciones de Chat Activadas', {
        body: 'Recibirás avisos instantáneos en tu barra de notificaciones cuando los docentes te envíen mensajes.',
        icon: '/logo_dunor.png'
      });
    }
  };

  // Open 1-on-1 chat with a teacher
  const openDirectChat = (teacher: UserProfile) => {
    const convId = [currentUser.uid, teacher.uid].sort().join('_');
    setActiveChat({
      id: convId,
      isGroup: false,
      name: teacher.name || 'Docente',
      partner: teacher,
      participantUids: [currentUser.uid, teacher.uid],
      participantNames: {
        [currentUser.uid]: currentUser.name || 'Docente',
        [teacher.uid]: teacher.name || 'Docente'
      },
      participantEmails: {
        [currentUser.uid]: currentUser.email || '',
        [teacher.uid]: teacher.email || ''
      }
    });
    isNearBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setUnreadCount(0);
    setHasNewMessagePulse(false);
  };

  // Open group conversation
  const openGroupChat = (group: TeacherConversation) => {
    setActiveChat({
      id: group.id,
      isGroup: true,
      name: group.name || 'Grupo Docente',
      participantUids: group.participantUids,
      participantNames: group.participantNames,
      participantEmails: group.participantEmails
    });
    isNearBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setUnreadCount(0);
    setHasNewMessagePulse(false);
  };

  // Open automatically if requested externally (e.g. clicking notification or toast)
  useEffect(() => {
    if (externalOpenPartner) {
      openDirectChat(externalOpenPartner);
      setIsOpen(true);
      setIsMinimized(false);
    }
  }, [externalOpenPartner]);

  // Corner tap handler (Secret Sequence: Top-Right -> Top-Left -> Bottom-Right -> Bottom-Left)
  const handleCornerClick = (cornerId: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left') => {
    if (!isTeacher) return;

    setTapFeedback(cornerId);
    setTimeout(() => setTapFeedback(null), 300);

    if (sequenceTimerRef.current) {
      clearTimeout(sequenceTimerRef.current);
    }
    sequenceTimerRef.current = setTimeout(() => {
      setCornerTaps([]);
    }, 8000);

    const updated = [...cornerTaps, cornerId];

    if (updated[0] !== 'top-right') {
      setCornerTaps([]);
      return;
    }

    if (updated.length === 4) {
      const startsWithTR = updated[0] === 'top-right';
      const endsWithBL = updated[3] === 'bottom-left';
      const uniqueCorners = new Set(updated);

      if (startsWithTR && endsWithBL && uniqueCorners.size === 4) {
        setIsOpen(true);
        setIsMinimized(false);
        setCornerTaps([]);
        if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
        return;
      } else {
        setCornerTaps([]);
        return;
      }
    }

    setCornerTaps(updated);
  };

  const handleCloseChat = () => {
    setIsOpen(false);
    setActiveChat(null);
    setCornerTaps([]);
    setShowThemeMenu(false);
    setShowCreateGroupModal(false);
    setShowAddParticipantsModal(false);
    if (onCloseExternal) {
      onCloseExternal();
    }
  };

  // Mobile device hardware/browser back button listener for Teacher Secret Chat
  // Requirement 1: "en caso de tener abierto el chat, si se presiona esta tecla lo minimice"
  useEffect(() => {
    if (!isOpen || isMinimized) return;

    // Push a history state marker for the open secret chat
    window.history.pushState({ teacherChatOpen: true }, '');

    const handleChatPopState = () => {
      // 1. Close full-screen image viewer if active
      if (zoomedImage) {
        setZoomedImage(null);
        window.history.pushState({ teacherChatOpen: true }, '');
        return;
      }
      // 2. Close group modals if active
      if (showCreateGroupModal) {
        setShowCreateGroupModal(false);
        window.history.pushState({ teacherChatOpen: true }, '');
        return;
      }
      if (showAddParticipantsModal) {
        setShowAddParticipantsModal(false);
        window.history.pushState({ teacherChatOpen: true }, '');
        return;
      }
      // 3. Minimize the chat as requested: "en caso de tener abierto el chat, si se presiona esta tecla lo minimice"
      setIsMinimized(true);
    };

    window.addEventListener('popstate', handleChatPopState);
    return () => {
      window.removeEventListener('popstate', handleChatPopState);
    };
  }, [isOpen, isMinimized, zoomedImage, showCreateGroupModal, showAddParticipantsModal]);

  // 1. LISTEN TO GROUP CONVERSATIONS
  useEffect(() => {
    if (!currentUser || !isTeacher) return;

    const q = query(
      collection(db, 'teacher_conversations'),
      where('participantUids', 'array-contains', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const convList: TeacherConversation[] = [];
      snapshot.docs.forEach((d) => {
        convList.push({ id: d.id, ...d.data() } as TeacherConversation);
      });
      convList.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setGroups(convList);
    }, (error) => {
      console.warn("Group conversations listener notice:", error);
    });

    return () => unsubscribe();
  }, [currentUser, isTeacher]);

  // 2. GLOBAL BACKGROUND REAL-TIME LISTENER FOR INCOMING MESSAGES
  // Allows notifications, unread badges on minimized chat, and instant delivery without refreshing
  useEffect(() => {
    if (!currentUser || !isTeacher) return;

    // Listen to messages where current user is a participant
    const q1 = query(
      collection(db, 'teacher_messages'),
      where('participantUids', 'array-contains', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q1, (snapshot) => {
      // Keep all user messages updated in real-time for the active chats section
      const now = Date.now();
      const userMsgs: TeacherMessage[] = [];
      snapshot.docs.forEach((d) => {
        const data = { id: d.id, ...d.data() } as TeacherMessage;
        const expiresAt = data.expiresAt || (data.createdAt + ttlMs);
        if (now < expiresAt) {
          userMsgs.push(data);
        }
      });
      setAllUserMessages(userMsgs);

      // Skip actions on the very first mount snapshot to avoid playing audio for historic messages
      if (isFirstLoadRef.current) {
        isFirstLoadRef.current = false;
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const msg = { id: change.doc.id, ...change.doc.data() } as TeacherMessage;
          const isFromOther = msg.senderUid !== currentUser.uid;
          const isRecent = Date.now() - (msg.createdAt || 0) < 25000;

          if (isFromOther && isRecent) {
            // Is this message from the currently active and focused conversation?
            const isCurrentActive = isOpen && !isMinimized && activeChat && activeChat.id === msg.conversationId;

            if (!isCurrentActive) {
              // Play soft sound chime
              playChatChime();

              // Update minimized notification state
              setUnreadCount(prev => prev + 1);
              setLastUnreadSender(msg.senderName || 'Docente');
              setLastUnreadPreview(msg.text || (msg.fileType === 'image' ? '📷 Foto' : '📎 Archivo'));
              setHasNewMessagePulse(true);

              // Trigger native OS notification bar (mobile & PC)
              const preview = msg.text
                ? (msg.text.length > 80 ? msg.text.substring(0, 80) + '...' : msg.text)
                : (msg.fileType === 'image' ? '📷 Foto adjunta' : '📎 Archivo adjunto');

              showSystemNotification(`💬 Mensaje de ${msg.senderName || 'Docente'}`, {
                body: preview,
                icon: '/logo_dunor.png',
                badge: '/logo_dunor.png',
                tag: `teacher-chat-${msg.id}`,
                vibrate: [200, 100, 200],
                data: {
                  conversationId: msg.conversationId,
                  senderUid: msg.senderUid
                }
              });
            }
          }
        }
      });
    }, (err) => {
      console.warn("Background messages listener warning:", err);
    });

    return () => unsubscribe();
  }, [currentUser, isTeacher, isOpen, isMinimized, activeChat, ttlMs]);

  // 3. ACTIVE CONVERSATION REAL-TIME MESSAGES LISTENER
  useEffect(() => {
    if (!isOpen || !activeChat || !currentUser) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'teacher_messages'),
      where('conversationId', '==', activeChat.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const validMsgs: TeacherMessage[] = [];
      const expiredDocs: string[] = [];

      snapshot.docs.forEach((d) => {
        const data = { id: d.id, ...d.data() } as TeacherMessage;
        const expiresAt = data.expiresAt || (data.createdAt + ttlMs);
        if (now >= expiresAt) {
          expiredDocs.push(d.id);
        } else {
          validMsgs.push(data);
        }
      });

      // Sort in memory to guarantee real-time delivery without requiring composite indices
      validMsgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      
      // Preserve any pending optimistic messages that have not yet arrived in server snapshot
      setMessages(prev => {
        const serverKeys = new Set(validMsgs.map(m => `${m.senderUid}_${m.createdAt}`));
        const pendingOptimistic = prev.filter(m => 
          m.id.startsWith('temp_') && !serverKeys.has(`${m.senderUid}_${m.createdAt}`)
        );
        return [...validMsgs, ...pendingOptimistic].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      });

      // Asynchronously purge expired messages from Firestore
      if (expiredDocs.length > 0) {
        expiredDocs.forEach(docId => {
          deleteDoc(doc(db, 'teacher_messages', docId)).catch(() => {});
        });
      }
    }, (error) => {
      console.warn("Active conversation messages error:", error);
    });

    return () => unsubscribe();
  }, [isOpen, activeChat, currentUser, ttlMs]);

  // 4. REAL-TIME TYPING INDICATOR LISTENER
  useEffect(() => {
    if (!isOpen || !activeChat || !currentUser) {
      setTypingUsers([]);
      return;
    }

    const q = query(
      collection(db, 'teacher_typing'),
      where('conversationId', '==', activeChat.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const activeTyping: string[] = [];

      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (
          data.userId !== currentUser.uid &&
          data.isTyping === true &&
          now - (data.timestamp || 0) < 6000
        ) {
          activeTyping.push(data.userName || 'Docente');
        }
      });

      setTypingUsers(activeTyping);
    }, (err) => {
      console.warn("Typing indicator error:", err);
    });

    return () => unsubscribe();
  }, [isOpen, activeChat, currentUser]);

  // Handle local user typing debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (!activeChat || !currentUser) return;

    const typingDocRef = doc(db, 'teacher_typing', `${activeChat.id}_${currentUser.uid}`);

    if (val.trim()) {
      if (!isTypingFlagRef.current) {
        isTypingFlagRef.current = true;
        setDoc(typingDocRef, {
          conversationId: activeChat.id,
          userId: currentUser.uid,
          userName: currentUser.name || 'Docente',
          isTyping: true,
          timestamp: Date.now()
        }, { merge: true }).catch(() => {});
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = setTimeout(() => {
        isTypingFlagRef.current = false;
        setDoc(typingDocRef, {
          isTyping: false,
          timestamp: Date.now()
        }, { merge: true }).catch(() => {});
      }, 3000);
    } else {
      if (isTypingFlagRef.current) {
        isTypingFlagRef.current = false;
        setDoc(typingDocRef, {
          isTyping: false,
          timestamp: Date.now()
        }, { merge: true }).catch(() => {});
      }
    }
  };

  // Reset typing on unmount or active chat change
  useEffect(() => {
    return () => {
      if (activeChat && currentUser && isTypingFlagRef.current) {
        const typingDocRef = doc(db, 'teacher_typing', `${activeChat.id}_${currentUser.uid}`);
        setDoc(typingDocRef, { isTyping: false, timestamp: Date.now() }, { merge: true }).catch(() => {});
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [activeChat, currentUser]);

  // Auto scroll to latest message when messages change or chat is switched
  useEffect(() => {
    if (!activeChat || messages.length === 0) return;

    const isDifferentChat = lastActiveChatIdRef.current !== activeChat.id;
    lastActiveChatIdRef.current = activeChat.id;

    const lastMsg = messages[messages.length - 1];
    const isMine = lastMsg?.senderUid === currentUser?.uid;

    if (isDifferentChat) {
      // First load of conversation: immediately pin to bottom without visual delay
      scrollToBottom('auto');
      const t1 = setTimeout(() => scrollToBottom('auto'), 40);
      const t2 = setTimeout(() => scrollToBottom('auto'), 120);
      const t3 = setTimeout(() => scrollToBottom('auto'), 280);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    } else {
      // In active conversation: if user sent it OR was already near bottom, scroll smoothly to the new message
      if (isMine || isNearBottomRef.current) {
        scrollToBottom('smooth');
        const t1 = setTimeout(() => scrollToBottom('smooth'), 50);
        const t2 = setTimeout(() => scrollToBottom('auto'), 150);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
        };
      }
    }
  }, [messages, typingUsers, activeChat?.id, currentUser?.uid]);

  // Periodic cleanup timer for active view (every 30s)
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages(prev => prev.filter(m => {
        const expiresAt = m.expiresAt || (m.createdAt + ttlMs);
        return now < expiresAt;
      }));
    }, 30000);
    return () => clearInterval(interval);
  }, [isOpen, ttlMs]);

  // Image compressor helper (optimizes dimensions and quality for instant delivery)
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 900;
          const MAX_HEIGHT = 900;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height = Math.round((height * MAX_WIDTH) / width);
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = Math.round((width * MAX_HEIGHT) / height);
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(e.target?.result as string);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          let quality = 0.72;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          if (dataUrl.length > 300 * 1024) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.58);
          }
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle file select
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'file') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'file' && file.size > 800 * 1024) {
      alert('El archivo no debe exceder 800 KB para asegurar la sincronización en tiempo real.');
      return;
    }

    try {
      if (type === 'image') {
        const compressedData = await compressImage(file);
        setAttachedFile({
          data: compressedData,
          name: file.name,
          type: 'image',
          size: file.size
        });
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachedFile({
            data: reader.result as string,
            name: file.name,
            type: 'file',
            size: file.size
          });
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.error('Error loading file:', err);
    }

    e.target.value = '';
  };

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeChat || !currentUser) return;
    if (!inputText.trim() && !attachedFile) return;

    setIsSending(true);
    const now = Date.now();
    const expiresAt = now + ttlMs;

    // Stop typing state immediately
    if (isTypingFlagRef.current) {
      isTypingFlagRef.current = false;
      const typingDocRef = doc(db, 'teacher_typing', `${activeChat.id}_${currentUser.uid}`);
      setDoc(typingDocRef, { isTyping: false, timestamp: now }, { merge: true }).catch(() => {});
    }

    const newMsg: Omit<TeacherMessage, 'id'> = {
      conversationId: activeChat.id,
      senderUid: currentUser.uid,
      senderName: currentUser.name || 'Docente',
      senderEmail: currentUser.email || '',
      participantUids: activeChat.participantUids,
      text: inputText.trim(),
      createdAt: now,
      expiresAt: expiresAt,
      read: false
    };

    if (!activeChat.isGroup && activeChat.partner) {
      newMsg.receiverUid = activeChat.partner.uid;
      newMsg.receiverName = activeChat.partner.name || 'Docente';
      newMsg.receiverEmail = activeChat.partner.email || '';
    }

    if (attachedFile) {
      newMsg.fileData = attachedFile.data;
      newMsg.fileName = attachedFile.name;
      newMsg.fileType = attachedFile.type;
      newMsg.fileSize = attachedFile.size;
    }

    // Optimistic local update: Render image or text immediately without waiting for server round-trip
    const tempId = `temp_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const optimisticMsg: TeacherMessage = { id: tempId, ...newMsg };
    setMessages(prev => [...prev, optimisticMsg]);
    setAllUserMessages(prev => [optimisticMsg, ...prev]);

    setInputText('');
    setAttachedFile(null);

    // Automatically position view at the newly sent message immediately
    isNearBottomRef.current = true;
    setShowScrollBottomBtn(false);
    scrollToBottom('smooth');
    setTimeout(() => scrollToBottom('auto'), 50);
    setTimeout(() => scrollToBottom('auto'), 180);

    try {
      await addDoc(collection(db, 'teacher_messages'), newMsg);

      // If group, update group conversation document
      if (activeChat.isGroup) {
        await updateDoc(doc(db, 'teacher_conversations', activeChat.id), {
          lastMessageText: newMsg.text || (newMsg.fileType === 'image' ? '📷 Foto' : '📎 Archivo'),
          lastMessageSenderName: currentUser.name || 'Docente',
          lastMessageAt: now,
          updatedAt: now
        }).catch(() => {});
      }

      // Notify all other participants (SIN CORREO ELECTRÓNICO)
      const otherRecipients = activeChat.participantUids.filter(uid => uid !== currentUser.uid);
      const preview = newMsg.text
        ? (newMsg.text.length > 100 ? newMsg.text.substring(0, 100) + '...' : newMsg.text)
        : (newMsg.fileType === 'image' ? '📷 Foto adjunta' : '📎 Archivo adjunto');

      const notifTitle = activeChat.isGroup
        ? `💬 ${activeChat.name} (${currentUser.name || 'Docente'})`
        : `💬 Mensaje de ${currentUser.name || 'Docente'}`;

      if (sendNotification && otherRecipients.length > 0) {
        await sendNotification(
          otherRecipients,
          notifTitle,
          preview,
          '',
          true, // skipAdmins: true
          {
            skipEmail: true, // OBLIGATORIO: Jamás enviar correo
            type: 'teacher_chat',
            chatPartnerUid: currentUser.uid,
            chatPartnerName: currentUser.name || 'Docente',
            chatPartnerEmail: currentUser.email || '',
            conversationId: activeChat.id,
            isCreationNotification: false
          }
        );
      }
    } catch (err) {
      console.error('Error sending message:', err);
      // Revert optimistic message on failure
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setAllUserMessages(prev => prev.filter(m => m.id !== tempId));
      alert('No se pudo enviar el mensaje. Inténtalo nuevamente.');
    } finally {
      setIsSending(false);
    }
  };

  // Helper to format remaining time
  const getRemainingTime = (createdAt: number, expiresAt?: number) => {
    const expireTime = expiresAt || (createdAt + ttlMs);
    const diffMs = expireTime - Date.now();
    if (diffMs <= 0) return 'Expirando...';
    const hours = Math.floor(diffMs / (3600 * 1000));
    const mins = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  // 5. CREATE A NEW GROUP CHAT
  const handleCreateGroup = async () => {
    if (selectedGroupMemberUids.length === 0) {
      alert('Selecciona al menos un docente para crear el grupo.');
      return;
    }

    const participants = [currentUser.uid, ...selectedGroupMemberUids];
    const pNames: Record<string, string> = {
      [currentUser.uid]: currentUser.name || 'Docente'
    };
    const pEmails: Record<string, string> = {
      [currentUser.uid]: currentUser.email || ''
    };

    selectedGroupMemberUids.forEach(uid => {
      const teacher = allUsers.find(u => u.uid === uid);
      if (teacher) {
        pNames[uid] = teacher.name || 'Docente';
        pEmails[uid] = teacher.email || '';
      }
    });

    const defaultName = newGroupName.trim() || `Grupo: ${Object.values(pNames).slice(0, 3).join(', ')}`;
    const now = Date.now();
    const groupId = `group_${now}_${currentUser.uid.substring(0, 6)}`;

    const newGroupData: TeacherConversation = {
      id: groupId,
      isGroup: true,
      name: defaultName,
      participantUids: participants,
      participantNames: pNames,
      participantEmails: pEmails,
      createdByUid: currentUser.uid,
      createdAt: now,
      updatedAt: now,
      lastMessageText: 'Grupo creado',
      lastMessageSenderName: currentUser.name || 'Docente',
      lastMessageAt: now
    };

    try {
      await setDoc(doc(db, 'teacher_conversations', groupId), newGroupData);

      // Add initial system message
      await addDoc(collection(db, 'teacher_messages'), {
        conversationId: groupId,
        senderUid: currentUser.uid,
        senderName: currentUser.name || 'Docente',
        senderEmail: currentUser.email || '',
        participantUids: participants,
        isSystem: true,
        text: `✨ ${currentUser.name || 'Docente'} creó el grupo "${defaultName}" con ${participants.length} participantes.`,
        createdAt: now,
        expiresAt: now + ttlMs,
        read: false
      });

      // Open newly created group
      openGroupChat(newGroupData);
      setShowCreateGroupModal(false);
      setNewGroupName('');
      setSelectedGroupMemberUids([]);
    } catch (err) {
      console.error('Error creating group:', err);
      alert('No se pudo crear el grupo.');
    }
  };

  // 6. ADD PARTICIPANTS TO ACTIVE CHAT (Converts 1-to-1 to group or adds to group)
  const handleAddParticipantsToChat = async () => {
    if (!activeChat || selectedGroupMemberUids.length === 0) return;

    const newMembers = selectedGroupMemberUids.filter(uid => !activeChat.participantUids.includes(uid));
    if (newMembers.length === 0) {
      setShowAddParticipantsModal(false);
      return;
    }

    const updatedParticipantUids = [...activeChat.participantUids, ...newMembers];
    const updatedNames = { ...activeChat.participantNames };
    const updatedEmails = { ...(activeChat.participantEmails || {}) };

    const addedNamesList: string[] = [];
    newMembers.forEach(uid => {
      const t = allUsers.find(u => u.uid === uid);
      if (t) {
        updatedNames[uid] = t.name || 'Docente';
        updatedEmails[uid] = t.email || '';
        addedNamesList.push(t.name || 'Docente');
      }
    });

    const now = Date.now();

    try {
      if (activeChat.isGroup) {
        // Update existing group
        await updateDoc(doc(db, 'teacher_conversations', activeChat.id), {
          participantUids: updatedParticipantUids,
          participantNames: updatedNames,
          participantEmails: updatedEmails,
          updatedAt: now
        });

        // Add system message
        await addDoc(collection(db, 'teacher_messages'), {
          conversationId: activeChat.id,
          senderUid: currentUser.uid,
          senderName: currentUser.name || 'Docente',
          senderEmail: currentUser.email || '',
          participantUids: updatedParticipantUids,
          isSystem: true,
          text: `👥 ${currentUser.name || 'Docente'} agregó a ${addedNamesList.join(', ')} al grupo.`,
          createdAt: now,
          expiresAt: now + ttlMs,
          read: false
        });

        setActiveChat(prev => prev ? {
          ...prev,
          participantUids: updatedParticipantUids,
          participantNames: updatedNames,
          participantEmails: updatedEmails
        } : null);
      } else {
        // Upgrade 1-to-1 conversation to a group conversation
        const groupName = newGroupName.trim() || `Grupo con ${Object.values(updatedNames).slice(0, 3).join(', ')}`;
        const newGroupId = `group_${now}_${currentUser.uid.substring(0, 6)}`;

        const newGroupDoc: TeacherConversation = {
          id: newGroupId,
          isGroup: true,
          name: groupName,
          participantUids: updatedParticipantUids,
          participantNames: updatedNames,
          participantEmails: updatedEmails,
          createdByUid: currentUser.uid,
          createdAt: now,
          updatedAt: now,
          lastMessageText: 'Grupo iniciado',
          lastMessageSenderName: currentUser.name || 'Docente',
          lastMessageAt: now
        };

        await setDoc(doc(db, 'teacher_conversations', newGroupId), newGroupDoc);

        // Add system announcement message
        await addDoc(collection(db, 'teacher_messages'), {
          conversationId: newGroupId,
          senderUid: currentUser.uid,
          senderName: currentUser.name || 'Docente',
          senderEmail: currentUser.email || '',
          participantUids: updatedParticipantUids,
          isSystem: true,
          text: `👥 Conversación ampliada: ${currentUser.name || 'Docente'} agregó a ${addedNamesList.join(', ')}.`,
          createdAt: now,
          expiresAt: now + ttlMs,
          read: false
        });

        openGroupChat(newGroupDoc);
      }

      setShowAddParticipantsModal(false);
      setSelectedGroupMemberUids([]);
      setNewGroupName('');
    } catch (e) {
      console.error('Error adding participants:', e);
      alert('Error al agregar participantes.');
    }
  };

  if (!isTeacher) return null;

  return (
    <>
      {/* 4 SECRET CORNER TRIGGER ZONES (Only for teachers) */}
      {!isOpen && (
        <>
          <div
            id="secret-corner-top-right"
            onClick={() => handleCornerClick('top-right')}
            className="fixed top-0 right-0 w-16 h-16 sm:w-20 sm:h-20 z-[99999] cursor-pointer pointer-events-auto select-none"
          >
            {tapFeedback === 'top-right' && (
              <span className="block w-full h-full bg-indigo-500/20 rounded-bl-full animate-ping" />
            )}
          </div>

          <div
            id="secret-corner-top-left"
            onClick={() => handleCornerClick('top-left')}
            className="fixed top-0 left-0 w-16 h-16 sm:w-20 sm:h-20 z-[99999] cursor-pointer pointer-events-auto select-none"
          >
            {tapFeedback === 'top-left' && (
              <span className="block w-full h-full bg-indigo-500/20 rounded-br-full animate-ping" />
            )}
          </div>

          <div
            id="secret-corner-bottom-right"
            onClick={() => handleCornerClick('bottom-right')}
            className="fixed bottom-0 right-0 w-16 h-16 sm:w-20 sm:h-20 z-[99999] cursor-pointer pointer-events-auto select-none"
          >
            {tapFeedback === 'bottom-right' && (
              <span className="block w-full h-full bg-indigo-500/20 rounded-tl-full animate-ping" />
            )}
          </div>

          <div
            id="secret-corner-bottom-left"
            onClick={() => handleCornerClick('bottom-left')}
            className="fixed bottom-0 left-0 w-16 h-16 sm:w-20 sm:h-20 z-[99999] cursor-pointer pointer-events-auto select-none"
          >
            {tapFeedback === 'bottom-left' && (
              <span className="block w-full h-full bg-indigo-500/20 rounded-tr-full animate-ping" />
            )}
          </div>
        </>
      )}

      {/* FLOATING TEACHER CHAT MODAL */}
      {isOpen && (
        <div 
          id="teacher-secret-chat-floating-container"
          className={cn(
            "fixed z-[99999] transition-all duration-300 rounded-2xl border shadow-2xl flex flex-col overflow-hidden",
            currentTheme.containerBg,
            currentTheme.border,
            isMinimized 
              ? cn(
                  "bottom-4 right-4 w-80 h-14 cursor-pointer hover:scale-102",
                  hasNewMessagePulse ? "ring-2 ring-emerald-400 dark:ring-emerald-500 animate-pulse" : ""
                )
              : "bottom-4 right-4 w-[95vw] sm:w-[480px] md:w-[520px] h-[640px] max-h-[88vh]"
          )}
          onClick={() => {
            if (isMinimized) {
              setIsMinimized(false);
              setHasNewMessagePulse(false);
              setUnreadCount(0);
            }
          }}
        >
          {/* HEADER */}
          <div className={cn("px-4 py-3 flex items-center justify-between select-none", currentTheme.headerBg)}>
            <div className="flex items-center gap-2 min-w-0">
              {activeChat && !isMinimized && (
                <button
                  onClick={() => setActiveChat(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title="Volver a contactos"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              
              <div className="p-1.5 rounded-lg bg-white/10 text-white shadow-inner shrink-0">
                {activeChat?.isGroup ? (
                  <Users className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Lock className="w-4 h-4 text-emerald-400" />
                )}
              </div>

              <div className="truncate">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm tracking-wide truncate text-white">
                    {isMinimized && unreadCount > 0 && lastUnreadSender
                      ? `💬 ${lastUnreadSender}`
                      : activeChat ? activeChat.name : 'Canal Docente Cifrado'}
                  </span>
                  
                  {/* Minimized new message indicator badge */}
                  {isMinimized && unreadCount > 0 ? (
                    <span className="px-2 py-0.5 rounded-full bg-red-500 text-white font-black text-[10px] animate-bounce flex items-center gap-1 shadow-md shrink-0">
                      <BellRing className="w-3 h-3" />
                      {unreadCount} nuevo{unreadCount > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full border shrink-0", currentTheme.badge)}>
                      {effectiveTtlHours}h TTL
                    </span>
                  )}
                </div>

                {!isMinimized && (
                  <p className="text-[11px] text-slate-400 truncate">
                    {activeChat 
                      ? (activeChat.isGroup
                          ? `${activeChat.participantUids.length} participantes • Cifrado docente`
                          : `${activeChat.partner?.email || ''} • ${getUserEducationLevel(activeChat.partner) || 'Docente'}`)
                      : 'Chat privado y en tiempo real exclusivo para docentes'}
                  </p>
                )}
              </div>
            </div>

            {/* Actions: Theme picker, group participants, minimize, close */}
            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
              {/* Add participants button (visible when inside a chat) */}
              {activeChat && !isMinimized && (
                <button
                  onClick={() => {
                    setSelectedGroupMemberUids([]);
                    setShowAddParticipantsModal(true);
                  }}
                  title="Agregar participantes a este chat"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-emerald-300 transition-colors cursor-pointer flex items-center gap-1 text-xs"
                >
                  <UserPlus className="w-4 h-4" />
                </button>
              )}

              {/* Theme Menu Toggle */}
              {!isMinimized && (
                <div className="relative">
                  <button
                    onClick={() => setShowThemeMenu(!showThemeMenu)}
                    title="Cambiar estilo de diseño"
                    className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <Palette className="w-4 h-4" />
                  </button>

                  {showThemeMenu && (
                    <div className="absolute right-0 top-10 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 z-50 text-xs">
                      <p className="font-bold text-slate-300 px-2 py-1 mb-1 border-b border-slate-800">
                        Opciones de Diseño
                      </p>
                      {(Object.keys(THEME_CONFIGS) as ChatTheme[]).map((themeKey) => (
                        <button
                          key={themeKey}
                          onClick={() => handleSelectTheme(themeKey)}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors my-0.5 cursor-pointer",
                            theme === themeKey ? "bg-indigo-600 text-white font-bold" : "text-slate-300 hover:bg-slate-800"
                          )}
                        >
                          <span>{THEME_CONFIGS[themeKey].name}</span>
                          {theme === themeKey && <Check className="w-3.5 h-3.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Minimize / Maximize */}
              <button
                onClick={() => {
                  const next = !isMinimized;
                  setIsMinimized(next);
                  if (!next) {
                    setHasNewMessagePulse(false);
                    setUnreadCount(0);
                  }
                }}
                title={isMinimized ? "Maximizar chat" : "Minimizar"}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
              </button>

              {/* Close Button: requires corner tap to reopen */}
              <button
                onClick={handleCloseChat}
                title="Cerrar (se requiere pulsar las 4 esquinas para volver a abrir)"
                className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* CHAT BODY (Hidden if minimized) */}
          {!isMinimized && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* VIEW 1: CONTACTS & GROUPS LIST */}
              {!activeChat ? (
                <div className={cn("flex-1 flex flex-col min-h-0", currentTheme.sidebarBg)}>
                  {/* Search and Tab Bar */}
                  <div className="p-3 border-b border-white/10 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Buscar docente o nivel..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className={cn(
                            "w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border outline-none transition-all",
                            currentTheme.inputBg
                          )}
                        />
                      </div>

                      {/* New Group Button */}
                      <button
                        onClick={() => {
                          setSelectedGroupMemberUids([]);
                          setNewGroupName('');
                          setShowCreateGroupModal(true);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shadow-sm shrink-0 cursor-pointer"
                        title="Crear chat grupal con varios docentes"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Grupo</span>
                      </button>
                    </div>

                    {/* Tabs: Chats Activos vs Docentes vs Grupos */}
                    <div className="flex items-center gap-1 bg-black/20 p-1 rounded-xl">
                      <button
                        onClick={() => setActiveTab('active')}
                        className={cn(
                          "flex-1 py-1 px-1.5 text-xs font-bold rounded-lg transition-all text-center cursor-pointer flex items-center justify-center gap-1",
                          activeTab === 'active' ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                        )}
                      >
                        <span>Activos</span>
                        {activeConversations.length > 0 && (
                          <span className={cn(
                            "px-1.5 py-0.2 rounded-full text-[9px] font-black",
                            activeTab === 'active' ? "bg-white/20 text-white" : "bg-indigo-500/20 text-indigo-300"
                          )}>
                            {activeConversations.length}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setActiveTab('contacts')}
                        className={cn(
                          "flex-1 py-1 px-1.5 text-xs font-bold rounded-lg transition-all text-center cursor-pointer flex items-center justify-center gap-1",
                          activeTab === 'contacts' ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                        )}
                      >
                        <span>Docentes</span>
                        <span className="text-[10px] opacity-70">({teacherContacts.length})</span>
                      </button>
                      <button
                        onClick={() => setActiveTab('groups')}
                        className={cn(
                          "flex-1 py-1 px-1.5 text-xs font-bold rounded-lg transition-all text-center cursor-pointer flex items-center justify-center gap-1",
                          activeTab === 'groups' ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                        )}
                      >
                        <span>Grupos</span>
                        <span className="text-[10px] opacity-70">({groups.length})</span>
                      </button>
                    </div>
                  </div>

                  {/* Native notifications permission banner if default */}
                  {notificationPermission !== 'granted' && (
                    <div className="mx-3 mt-2 p-2 rounded-xl bg-amber-950/40 border border-amber-500/30 flex items-center justify-between gap-2 text-[11px] text-amber-200">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <BellRing className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">Activar alertas en barra de celular/PC</span>
                      </div>
                      <button
                        onClick={handleRequestNotifications}
                        className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[10px] font-bold shrink-0 cursor-pointer shadow-sm"
                      >
                        Activar
                      </button>
                    </div>
                  )}

                  {/* Notice banner */}
                  <div className="mx-3 mt-2 p-2 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-start gap-2 text-[11px] text-indigo-200">
                    <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Chat Efímero:</strong> Mensajes y archivos se autodestruyen tras {effectiveTtlHours} horas.
                    </span>
                  </div>

                  {/* List Body */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 divide-y divide-white/5">
                    {activeTab === 'active' ? (
                      filteredActiveConversations.length === 0 ? (
                        <div className="text-center py-10 px-4 text-slate-400">
                          <MessageSquare className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
                          <p className="text-xs font-bold text-slate-300">No tienes chats activos actualmente</p>
                          <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                            Inicia una conversación con cualquier docente o crea un grupo para comenzar.
                          </p>
                          <div className="flex items-center justify-center gap-2 mt-4">
                            <button
                              onClick={() => setActiveTab('contacts')}
                              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                            >
                              <UserIcon className="w-3.5 h-3.5" />
                              Ver Docentes
                            </button>
                            <button
                              onClick={() => {
                                setSelectedGroupMemberUids([]);
                                setNewGroupName('');
                                setShowCreateGroupModal(true);
                              }}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer shadow-sm"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Crear Grupo
                            </button>
                          </div>
                        </div>
                      ) : (
                        filteredActiveConversations.map((conv) => {
                          const isMine = conv.lastMessage.senderUid === currentUser.uid;
                          const timeFormatted = formatMessageTime(conv.lastMessage.createdAt);
                          const remaining = getRemainingTime(conv.lastMessage.createdAt, conv.lastMessage.expiresAt);

                          return (
                            <div
                              key={conv.conversationId}
                              onClick={() => {
                                if (conv.isGroup && conv.group) {
                                  openGroupChat(conv.group);
                                } else if (conv.partner) {
                                  openDirectChat(conv.partner);
                                }
                              }}
                              className="pt-1.5 first:pt-0"
                            >
                              <button
                                className="w-full p-2.5 rounded-xl flex items-center justify-between hover:bg-white/10 transition-all text-left group cursor-pointer border border-transparent hover:border-white/10"
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                                  <div className="relative shrink-0">
                                    {conv.isGroup ? (
                                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-600 text-white flex items-center justify-center font-bold text-xs shadow-md">
                                        <Users className="w-4 h-4" />
                                      </div>
                                    ) : (
                                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-md">
                                        {conv.name.charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-slate-900" />
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1 mb-0.5">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <h4 className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition-colors">
                                          {conv.name}
                                        </h4>
                                        {conv.level && (
                                          <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-white/10 text-slate-300 border border-white/10 shrink-0">
                                            {conv.level}
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                                        {timeFormatted}
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[11px] text-slate-300 truncate">
                                        {isMine ? (
                                          <span className="text-indigo-300 font-medium">Tú: </span>
                                        ) : conv.isGroup ? (
                                          <span className="text-emerald-300 font-medium">{conv.lastMessage.senderName}: </span>
                                        ) : null}
                                        {conv.lastMessage.fileType === 'image' ? (
                                          <span className="inline-flex items-center gap-1 text-slate-300 font-medium">
                                            <ImageIcon className="w-3 h-3 text-indigo-400 inline" /> Foto
                                          </span>
                                        ) : conv.lastMessage.fileType === 'file' ? (
                                          <span className="inline-flex items-center gap-1 text-slate-300 font-medium">
                                            <Paperclip className="w-3 h-3 text-indigo-400 inline" /> Archivo
                                          </span>
                                        ) : (
                                          conv.lastMessage.text || 'Mensaje'
                                        )}
                                      </p>

                                      <span className="text-[9px] text-amber-400/90 shrink-0 flex items-center gap-0.5">
                                        <Clock className="w-2.5 h-2.5" />
                                        {remaining}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            </div>
                          );
                        })
                      )
                    ) : activeTab === 'contacts' ? (
                      filteredContacts.length === 0 ? (
                        <div className="text-center py-10 px-4 text-slate-400">
                          <UserIcon className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
                          <p className="text-xs font-medium">No se encontraron docentes activos.</p>
                        </div>
                      ) : (
                        filteredContacts.map(teacher => {
                          const level = getUserEducationLevel(teacher);
                          return (
                            <div
                              key={teacher.uid || teacher.email}
                              onClick={() => openDirectChat(teacher)}
                              className="pt-1.5 first:pt-0"
                            >
                              <button
                                className="w-full p-2.5 rounded-xl flex items-center justify-between hover:bg-white/10 transition-all text-left group cursor-pointer"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-md shrink-0">
                                    {teacher.name ? teacher.name.charAt(0).toUpperCase() : 'D'}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h4 className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition-colors">
                                        {teacher.name}
                                      </h4>
                                      {level && (
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-white/10 text-slate-300 border border-white/10 shrink-0">
                                          {level}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-400 truncate">
                                      {teacher.email}
                                    </p>
                                  </div>
                                </div>
                                <span className="text-[10px] font-semibold text-indigo-400 group-hover:translate-x-0.5 transition-transform">
                                  Chatear →
                                </span>
                              </button>
                            </div>
                          );
                        })
                      )
                    ) : (
                      groups.length === 0 ? (
                        <div className="text-center py-10 px-4 text-slate-400">
                          <Users className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
                          <p className="text-xs font-medium">No tienes grupos activos aún.</p>
                          <button
                            onClick={() => {
                              setSelectedGroupMemberUids([]);
                              setNewGroupName('');
                              setShowCreateGroupModal(true);
                            }}
                            className="mt-3 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Crear primer grupo
                          </button>
                        </div>
                      ) : (
                        groups.map(grp => (
                          <div
                            key={grp.id}
                            onClick={() => openGroupChat(grp)}
                            className="pt-1.5 first:pt-0"
                          >
                            <button
                              className="w-full p-2.5 rounded-xl flex items-center justify-between hover:bg-white/10 transition-all text-left group cursor-pointer"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-600 text-white flex items-center justify-center font-bold text-xs shadow-md shrink-0">
                                  <Users className="w-4 h-4" />
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-xs font-bold text-white truncate group-hover:text-emerald-300 transition-colors">
                                    {grp.name}
                                  </h4>
                                  <p className="text-[11px] text-slate-400 truncate">
                                    {grp.lastMessageText || `${grp.participantUids.length} participantes`}
                                  </p>
                                </div>
                              </div>
                              <span className="text-[10px] font-semibold text-emerald-400 group-hover:translate-x-0.5 transition-transform">
                                Abrir →
                              </span>
                            </button>
                          </div>
                        ))
                      )
                    )}
                  </div>
                </div>
              ) : (
                /* VIEW 2: ACTIVE CONVERSATION (1-on-1 or Group) */
                <div className={cn("flex-1 flex flex-col min-h-0 relative", currentTheme.chatAreaBg)}>
                  {/* Status header with participants and TTL */}
                  <div className="px-3 py-1.5 bg-black/30 border-b border-white/5 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-amber-400" />
                      Auto-destrucción a las {effectiveTtlHours}h
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                        Tiempo real
                      </span>
                      {activeChat.isGroup && (
                        <button
                          onClick={() => {
                            setSelectedGroupMemberUids([]);
                            setShowAddParticipantsModal(true);
                          }}
                          className="hover:text-white underline cursor-pointer text-[10px]"
                        >
                          {activeChat.participantUids.length} miembros
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Messages Area */}
                  <div
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                    className="flex-1 overflow-y-auto p-3.5 space-y-3"
                  >
                    {messages.length === 0 ? (
                      <div className="text-center py-12 px-6 text-slate-400">
                        <Lock className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-60" />
                        <p className="text-xs font-bold text-slate-300">Conversación Cifrada y Efímera</p>
                        <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                          Inicia el chat en tiempo real. Los mensajes, archivos e imágenes se eliminarán automáticamente a las {effectiveTtlHours} horas.
                        </p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isMine = msg.senderUid === currentUser.uid;
                        const remaining = getRemainingTime(msg.createdAt, msg.expiresAt);

                        if (msg.isSystem) {
                          return (
                            <div key={msg.id} className="flex justify-center my-1">
                              <span className="px-3 py-1 rounded-full bg-black/40 text-slate-300 text-[10px] border border-white/10 font-medium">
                                {msg.text}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={msg.id}
                            className={cn("flex flex-col", isMine ? "items-end" : "items-start")}
                          >
                            {/* In group chat, show sender name above incoming bubbles */}
                            {activeChat.isGroup && !isMine && (
                              <span className="text-[10px] font-bold text-emerald-400 mb-0.5 ml-1">
                                {msg.senderName}
                              </span>
                            )}

                            <div
                              className={cn(
                                "max-w-[85%] rounded-2xl p-3 text-xs shadow-md transition-all",
                                isMine ? currentTheme.outgoingBubble : currentTheme.incomingBubble
                              )}
                            >
                              {/* Attached Image */}
                              {msg.fileType === 'image' && msg.fileData && (
                                <div className="mb-2 rounded-lg overflow-hidden border border-white/10 bg-black/20">
                                  <img
                                    src={msg.fileData}
                                    alt={msg.fileName || 'Imagen adjunta'}
                                    className="max-h-52 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                    onClick={() => setZoomedImage(msg.fileData || null)}
                                    onLoad={() => {
                                      if (isNearBottomRef.current || msg.senderUid === currentUser.uid) {
                                        scrollToBottom('auto');
                                      }
                                    }}
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}

                              {/* Attached File */}
                              {msg.fileType === 'file' && msg.fileData && (
                                <a
                                  href={msg.fileData}
                                  download={msg.fileName || 'archivo'}
                                  className="mb-2 p-2 rounded-xl bg-black/30 border border-white/10 flex items-center justify-between gap-3 text-white hover:bg-black/40 transition-colors group"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="w-5 h-5 text-indigo-400 shrink-0" />
                                    <div className="truncate">
                                      <p className="font-semibold text-xs truncate text-white">{msg.fileName || 'Archivo adjunto'}</p>
                                      {msg.fileSize && (
                                        <p className="text-[10px] text-slate-300">
                                          {(msg.fileSize / 1024).toFixed(1)} KB
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                  <Download className="w-4 h-4 text-slate-300 group-hover:text-white shrink-0" />
                                </a>
                              )}

                              {/* Message Text */}
                              {msg.text && (
                                <p className="whitespace-pre-wrap leading-relaxed break-words">
                                  {msg.text}
                                </p>
                              )}

                              {/* Timestamp & TTL countdown */}
                              <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[9px] opacity-75">
                                <span>{format(new Date(msg.createdAt), 'hh:mm a')}</span>
                                <span>•</span>
                                <span className="flex items-center gap-0.5 text-amber-300 font-medium">
                                  <Clock className="w-2.5 h-2.5" />
                                  {remaining}
                                </span>
                                {isMine && <CheckCheck className="w-3 h-3 text-sky-200 ml-0.5" />}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Floating button to jump to the latest message if scrolled up */}
                  {showScrollBottomBtn && (
                    <button
                      type="button"
                      onClick={() => {
                        isNearBottomRef.current = true;
                        scrollToBottom('smooth');
                      }}
                      className="absolute bottom-16 right-4 z-20 px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xl flex items-center gap-1.5 border border-indigo-400/40 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 animate-bounce"
                      title="Ir al último mensaje"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                      <span>Último mensaje</span>
                    </button>
                  )}

                  {/* Real-time typing indicator */}
                  {typingUsers.length > 0 && (
                    <div className="px-4 py-1.5 text-[11px] text-emerald-400 flex items-center gap-2 animate-pulse bg-black/30 border-t border-white/5">
                      <span className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
                      </span>
                      <span className="truncate font-medium">
                        {typingUsers.join(', ')} {typingUsers.length > 1 ? 'están escribiendo...' : 'está escribiendo...'}
                      </span>
                    </div>
                  )}

                  {/* Attached file preview before sending */}
                  {attachedFile && (
                    <div className="px-3 py-2 bg-slate-900/90 border-t border-white/10 flex items-center justify-between text-xs text-white">
                      <div className="flex items-center gap-2 truncate">
                        {attachedFile.type === 'image' ? (
                          <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : (
                          <File className="w-4 h-4 text-indigo-400 shrink-0" />
                        )}
                        <span className="truncate">{attachedFile.name}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          ({(attachedFile.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <button
                        onClick={() => setAttachedFile(null)}
                        className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                        title="Quitar adjunto"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* INPUT FORM */}
                  <form
                    onSubmit={handleSendMessage}
                    className="p-3 border-t border-white/10 bg-black/40 flex items-center gap-2"
                  >
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFileChange(e, 'image')}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      title="Compartir imagen"
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                      onChange={(e) => handleFileChange(e, 'file')}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Compartir archivo"
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <input
                      type="text"
                      placeholder="Escribe un mensaje cifrado..."
                      value={inputText}
                      onChange={handleInputChange}
                      className={cn(
                        "flex-1 px-3 py-2 text-xs rounded-xl border outline-none transition-all",
                        currentTheme.inputBg
                      )}
                    />

                    <button
                      type="submit"
                      disabled={isSending || (!inputText.trim() && !attachedFile)}
                      className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-md cursor-pointer"
                      title="Enviar mensaje"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CREATE GROUP MODAL */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 z-[100001] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                Crear Nuevo Grupo de Docentes
              </h3>
              <button
                onClick={() => setShowCreateGroupModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Nombre del grupo (opcional)
              </label>
              <input
                type="text"
                placeholder="Ej. Docentes Secundaria, Academia de Ciencias..."
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Selecciona los docentes participantes ({selectedGroupMemberUids.length} seleccionados)
              </label>
              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filtrar por nombre..."
                  value={groupSearchQuery}
                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 outline-none"
                />
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1 border border-slate-800 rounded-xl p-2 bg-slate-950/40">
                {teacherContacts
                  .filter(t => !groupSearchQuery.trim() || t.name?.toLowerCase().includes(groupSearchQuery.toLowerCase()))
                  .map(t => {
                    const isSelected = selectedGroupMemberUids.includes(t.uid);
                    return (
                      <label
                        key={t.uid}
                        className={cn(
                          "flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors text-xs",
                          isSelected ? "bg-indigo-600/30 text-white" : "hover:bg-slate-800 text-slate-300"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            if (isSelected) {
                              setSelectedGroupMemberUids(prev => prev.filter(id => id !== t.uid));
                            } else {
                              setSelectedGroupMemberUids(prev => [...prev, t.uid]);
                            }
                          }}
                          className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium truncate">{t.name}</span>
                        <span className="text-[10px] text-slate-500 truncate ml-auto">{t.email}</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowCreateGroupModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={selectedGroupMemberUids.length === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-sm cursor-pointer"
              >
                Crear Grupo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD PARTICIPANTS TO ACTIVE CHAT MODAL */}
      {showAddParticipantsModal && activeChat && (
        <div className="fixed inset-0 z-[100001] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                Agregar Docentes al Chat
              </h3>
              <button
                onClick={() => setShowAddParticipantsModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Current participants list */}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Participantes actuales ({activeChat.participantUids.length}):
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {activeChat.participantUids.map(uid => (
                  <span
                    key={uid}
                    className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-200 text-[10px] border border-slate-700 flex items-center gap-1"
                  >
                    <UserIcon className="w-3 h-3 text-slate-400" />
                    {activeChat.participantNames[uid] || 'Docente'}
                  </span>
                ))}
              </div>
            </div>

            {!activeChat.isGroup && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nombre para el grupo ampliado (opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ej. Coordinación Académica..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Selecciona docentes adicionales para unir al chat:
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1 border border-slate-800 rounded-xl p-2 bg-slate-950/40">
                {teacherContacts
                  .filter(t => !activeChat.participantUids.includes(t.uid))
                  .map(t => {
                    const isSelected = selectedGroupMemberUids.includes(t.uid);
                    return (
                      <label
                        key={t.uid}
                        className={cn(
                          "flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors text-xs",
                          isSelected ? "bg-emerald-600/30 text-white" : "hover:bg-slate-800 text-slate-300"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            if (isSelected) {
                              setSelectedGroupMemberUids(prev => prev.filter(id => id !== t.uid));
                            } else {
                              setSelectedGroupMemberUids(prev => [...prev, t.uid]);
                            }
                          }}
                          className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className="font-medium truncate">{t.name}</span>
                        <span className="text-[10px] text-slate-500 truncate ml-auto">{t.email}</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddParticipantsModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddParticipantsToChat}
                disabled={selectedGroupMemberUids.length === 0}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-40 shadow-sm cursor-pointer"
              >
                Agregar al Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE LIGHTBOX */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100002] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={zoomedImage}
              alt="Zoom"
              className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
              referrerPolicy="no-referrer"
            />
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute -top-10 right-0 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
