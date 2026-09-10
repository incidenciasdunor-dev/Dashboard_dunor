import React, { useState, useEffect, useRef } from 'react';
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
  Trash2,
  Check,
  CheckCheck,
  GraduationCap,
  Sparkles,
  School,
  File
} from 'lucide-react';
import { collection, addDoc, query, where, onSnapshot, deleteDoc, doc, orderBy, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserProfile, TeacherMessage, normalizeUserRole } from '../types';
import { cn, getUserEducationLevel } from '../lib/utils';
import { format } from 'date-fns';

export type ChatTheme = 'stealth-slate' | 'dark-blackout' | 'emerald-glass' | 'academic-warm';

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

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export const TeacherSecretChat: React.FC<TeacherSecretChatProps> = ({
  currentUser,
  allUsers,
  sendNotification,
  externalOpenPartner,
  onCloseExternal
}) => {
  // Only accessible for users with role 'TEACHER'
  const isTeacher = normalizeUserRole(currentUser.role) === 'TEACHER';

  // Secret Corner activation sequence state
  // Order: 1. Top-Right -> (Top-Left / Bottom-Right) -> 4. Bottom-Left
  const [cornerTaps, setCornerTaps] = useState<string[]>([]);
  const [tapFeedback, setTapFeedback] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Selected teacher to chat with
  const [selectedTeacher, setSelectedTeacher] = useState<UserProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Open automatically if requested externally (e.g. clicking notification or toast)
  useEffect(() => {
    if (externalOpenPartner) {
      setSelectedTeacher(externalOpenPartner);
      setIsOpen(true);
      setIsMinimized(false);
    }
  }, [externalOpenPartner]);

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

  // Image preview modal
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sequenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Persist theme choice
  const handleSelectTheme = (newTheme: ChatTheme) => {
    setTheme(newTheme);
    localStorage.setItem('dunor_teacher_chat_theme', newTheme);
    setShowThemeMenu(false);
  };

  // Filter only active registered teachers, excluding current user
  const teacherContacts = allUsers.filter(u => {
    const role = normalizeUserRole(u.role);
    const isT = role === 'TEACHER';
    const isActive = u.status !== 'BLOQUEADO' && !u.isBlocked;
    const isNotMe = u.uid !== currentUser.uid && u.email?.toLowerCase() !== currentUser.email?.toLowerCase();
    return isT && isActive && isNotMe;
  });

  const filteredContacts = teacherContacts.filter(u => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = u.name?.toLowerCase().includes(query);
    const emailMatch = u.email?.toLowerCase().includes(query);
    const levelMatch = getUserEducationLevel(u)?.toLowerCase().includes(query);
    return nameMatch || emailMatch || levelMatch;
  });

  // Calculate unique conversationId between two users
  const getConversationId = (uidA: string, uidB: string) => {
    return [uidA, uidB].sort().join('_');
  };

  // Corner tap handler
  // Allowed activation: 4 corner clicks starting with 'top-right' and ending with 'bottom-left'
  const handleCornerClick = (cornerId: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left') => {
    if (!isTeacher) return;

    // Visual micro-feedback (subtle flash in that corner)
    setTapFeedback(cornerId);
    setTimeout(() => setTapFeedback(null), 300);

    // Reset timer
    if (sequenceTimerRef.current) {
      clearTimeout(sequenceTimerRef.current);
    }
    sequenceTimerRef.current = setTimeout(() => {
      setCornerTaps([]);
    }, 8000); // 8 seconds window

    const updated = [...cornerTaps, cornerId];

    // First tap MUST be top-right
    if (updated[0] !== 'top-right') {
      setCornerTaps([]);
      return;
    }

    // If user tapped 4 corners
    if (updated.length === 4) {
      const startsWithTR = updated[0] === 'top-right';
      const endsWithBL = updated[3] === 'bottom-left';
      // Verify all 4 corners were touched
      const uniqueCorners = new Set(updated);

      if (startsWithTR && endsWithBL && uniqueCorners.size === 4) {
        // SUCCESS! Open the secret chat
        setIsOpen(true);
        setIsMinimized(false);
        setCornerTaps([]);
        if (sequenceTimerRef.current) clearTimeout(sequenceTimerRef.current);
        return;
      } else {
        // Failed sequence, reset
        setCornerTaps([]);
        return;
      }
    }

    setCornerTaps(updated);
  };

  // Close floating chat and require corners again
  const handleCloseChat = () => {
    setIsOpen(false);
    setSelectedTeacher(null);
    setCornerTaps([]);
    setShowThemeMenu(false);
    if (onCloseExternal) {
      onCloseExternal();
    }
  };

  // Listen to messages when a teacher is selected
  useEffect(() => {
    if (!isOpen || !selectedTeacher || !currentUser) return;

    const convId = getConversationId(currentUser.uid, selectedTeacher.uid);
    const q = query(
      collection(db, 'teacher_messages'),
      where('conversationId', '==', convId),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const validMsgs: TeacherMessage[] = [];
      const expiredDocs: string[] = [];

      snapshot.docs.forEach((d) => {
        const data = { id: d.id, ...d.data() } as TeacherMessage;
        // Check 6 hours expiration
        const expiresAt = data.expiresAt || (data.createdAt + SIX_HOURS_MS);
        if (now >= expiresAt) {
          expiredDocs.push(d.id);
        } else {
          validMsgs.push(data);
        }
      });

      setMessages(validMsgs);

      // Asynchronously purge expired messages from Firestore
      if (expiredDocs.length > 0) {
        expiredDocs.forEach(docId => {
          deleteDoc(doc(db, 'teacher_messages', docId)).catch(() => {});
        });
      }
    }, (error) => {
      console.warn("Teacher chat subscription notice:", error);
    });

    return () => unsubscribe();
  }, [isOpen, selectedTeacher, currentUser]);

  // Auto scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Periodic cleanup timer for active view (every 30s)
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages(prev => prev.filter(m => {
        const expiresAt = m.expiresAt || (m.createdAt + SIX_HOURS_MS);
        return now < expiresAt;
      }));
    }, 30000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Image compressor helper
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1200;
          const MAX_HEIGHT = 1200;
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
          // Compress to WebP or JPEG 0.75
          const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
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

    // Check size limit (< 1.5MB raw, compressed for images, < 700KB for files)
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

    // Reset input
    e.target.value = '';
  };

  // Send message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedTeacher || !currentUser) return;
    if (!inputText.trim() && !attachedFile) return;

    setIsSending(true);
    const now = Date.now();
    const convId = getConversationId(currentUser.uid, selectedTeacher.uid);

    const newMsg: Omit<TeacherMessage, 'id'> = {
      conversationId: convId,
      senderUid: currentUser.uid,
      senderName: currentUser.name || 'Docente',
      senderEmail: currentUser.email || '',
      receiverUid: selectedTeacher.uid,
      receiverName: selectedTeacher.name || 'Docente',
      receiverEmail: selectedTeacher.email || '',
      text: inputText.trim(),
      createdAt: now,
      expiresAt: now + SIX_HOURS_MS, // 6 hours expiration
      read: false
    };

    if (attachedFile) {
      newMsg.fileData = attachedFile.data;
      newMsg.fileName = attachedFile.name;
      newMsg.fileType = attachedFile.type;
      newMsg.fileSize = attachedFile.size;
    }

    try {
      await addDoc(collection(db, 'teacher_messages'), newMsg);

      // Despachar notificación exclusiva para el destinatario en la app y barra de notificaciones (SIN CORREO)
      const preview = newMsg.text
        ? (newMsg.text.length > 100 ? newMsg.text.substring(0, 100) + '...' : newMsg.text)
        : (newMsg.fileType === 'image' ? '📷 Foto adjunta' : '📎 Archivo adjunto');

      const notifTitle = `💬 Mensaje de ${currentUser.name || 'Docente'}`;

      if (sendNotification && selectedTeacher) {
        const targets = [selectedTeacher.uid];
        if (selectedTeacher.email && selectedTeacher.email.toLowerCase() !== selectedTeacher.uid.toLowerCase()) {
          targets.push(selectedTeacher.email);
        }

        await sendNotification(
          targets,
          notifTitle,
          preview,
          '',
          true, // skipAdmins: true (no se envía a administradores/directores)
          {
            skipEmail: true, // REGLA OBLIGATORIA: Jamás enviar correo por mensajes de chat
            type: 'teacher_chat',
            chatPartnerUid: currentUser.uid,
            chatPartnerName: currentUser.name || 'Docente',
            chatPartnerEmail: currentUser.email || '',
            conversationId: convId,
            creatorUid: currentUser.uid,
            creatorEmail: currentUser.email || '',
            isCreationNotification: false
          }
        );
      } else if (selectedTeacher) {
        // Fallback de guardado directo en la colección de notificaciones si sendNotification no está montado
        const targets = [selectedTeacher.uid];
        if (selectedTeacher.email && selectedTeacher.email.toLowerCase() !== selectedTeacher.uid.toLowerCase()) {
          targets.push(selectedTeacher.email);
        }
        for (const tid of targets) {
          await addDoc(collection(db, 'notifications'), {
            title: notifTitle,
            message: preview,
            incidentId: '',
            createdAt: now,
            read: false,
            userId: tid,
            skipEmail: true, // Sin correo
            type: 'teacher_chat',
            chatPartnerUid: currentUser.uid,
            chatPartnerName: currentUser.name || 'Docente',
            chatPartnerEmail: currentUser.email || '',
            creatorUid: currentUser.uid,
            creatorEmail: currentUser.email || '',
            conversationId: convId,
            isCreationNotification: false
          });
        }
      }

      setInputText('');
      setAttachedFile(null);
    } catch (err) {
      console.error('Error sending message:', err);
      alert('No se pudo enviar el mensaje. Inténtalo nuevamente.');
    } finally {
      setIsSending(false);
    }
  };

  // Helper to format remaining time
  const getRemainingTime = (createdAt: number, expiresAt?: number) => {
    const expireTime = expiresAt || (createdAt + SIX_HOURS_MS);
    const diffMs = expireTime - Date.now();
    if (diffMs <= 0) return 'Expirando...';
    const hours = Math.floor(diffMs / (3600 * 1000));
    const mins = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  // If user is not teacher, do not mount trigger or chat
  if (!isTeacher) return null;

  const currentTheme = THEME_CONFIGS[theme];

  return (
    <>
      {/* 4 SECRET CORNER TRIGGER ZONES (Only for teachers) */}
      {!isOpen && (
        <>
          {/* Top-Right Corner (Step 1) */}
          <div
            id="secret-corner-top-right"
            onClick={() => handleCornerClick('top-right')}
            title=""
            className="fixed top-0 right-0 w-16 h-16 sm:w-20 sm:h-20 z-[99999] cursor-pointer pointer-events-auto select-none"
          >
            {tapFeedback === 'top-right' && (
              <span className="block w-full h-full bg-indigo-500/20 rounded-bl-full animate-ping" />
            )}
          </div>

          {/* Top-Left Corner */}
          <div
            id="secret-corner-top-left"
            onClick={() => handleCornerClick('top-left')}
            title=""
            className="fixed top-0 left-0 w-16 h-16 sm:w-20 sm:h-20 z-[99999] cursor-pointer pointer-events-auto select-none"
          >
            {tapFeedback === 'top-left' && (
              <span className="block w-full h-full bg-indigo-500/20 rounded-br-full animate-ping" />
            )}
          </div>

          {/* Bottom-Right Corner */}
          <div
            id="secret-corner-bottom-right"
            onClick={() => handleCornerClick('bottom-right')}
            title=""
            className="fixed bottom-0 right-0 w-16 h-16 sm:w-20 sm:h-20 z-[99999] cursor-pointer pointer-events-auto select-none"
          >
            {tapFeedback === 'bottom-right' && (
              <span className="block w-full h-full bg-indigo-500/20 rounded-tl-full animate-ping" />
            )}
          </div>

          {/* Bottom-Left Corner (Final Step) */}
          <div
            id="secret-corner-bottom-left"
            onClick={() => handleCornerClick('bottom-left')}
            title=""
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
              ? "bottom-4 right-4 w-72 h-14" 
              : "bottom-4 right-4 w-[95vw] sm:w-[460px] md:w-[500px] h-[600px] max-h-[88vh]"
          )}
        >
          {/* HEADER */}
          <div className={cn("px-4 py-3 flex items-center justify-between select-none", currentTheme.headerBg)}>
            <div className="flex items-center gap-2 min-w-0">
              {selectedTeacher && !isMinimized && (
                <button
                  onClick={() => setSelectedTeacher(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                  title="Volver a contactos"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              
              <div className="p-1.5 rounded-lg bg-white/10 text-white shadow-inner">
                <Lock className="w-4 h-4 text-emerald-400" />
              </div>

              <div className="truncate">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm tracking-wide truncate text-white">
                    {selectedTeacher ? selectedTeacher.name : 'Canal Docente Cifrado'}
                  </span>
                  <span className={cn("text-[10px] font-black uppercase px-2 py-0.5 rounded-full border", currentTheme.badge)}>
                    6 Horas TTL
                  </span>
                </div>
                {!isMinimized && (
                  <p className="text-[11px] text-slate-400 truncate">
                    {selectedTeacher 
                      ? `${selectedTeacher.email} • ${getUserEducationLevel(selectedTeacher) || 'Docente'}`
                      : 'Chat privado exclusivo para docentes'}
                  </p>
                )}
              </div>
            </div>

            {/* Actions: Theme picker, minimize, close */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Theme Menu Toggle */}
              <div className="relative">
                <button
                  onClick={() => setShowThemeMenu(!showThemeMenu)}
                  title="Cambiar estilo de diseño"
                  className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
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
                          "w-full text-left px-3 py-2 rounded-lg flex items-center justify-between transition-colors my-0.5",
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

              {/* Minimize / Maximize */}
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? "Maximizar" : "Minimizar"}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
              >
                {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
              </button>

              {/* Close Button: requires corner tap to reopen */}
              <button
                onClick={handleCloseChat}
                title="Cerrar (se requiere pulsar las 4 esquinas para volver a abrir)"
                className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* CHAT BODY (Hidden if minimized) */}
          {!isMinimized && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* VIEW 1: CONTACT LIST */}
              {!selectedTeacher ? (
                <div className={cn("flex-1 flex flex-col min-h-0", currentTheme.sidebarBg)}>
                  {/* Search bar */}
                  <div className="p-3 border-b border-white/10">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Buscar docente o nivel educativo..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={cn(
                          "w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border outline-none transition-all",
                          currentTheme.inputBg
                        )}
                      />
                    </div>
                  </div>

                  {/* Notice banner */}
                  <div className="mx-3 mt-2.5 p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-start gap-2 text-[11px] text-indigo-200">
                    <Clock className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Chat Efímero:</strong> Los mensajes, fotos y archivos compartidos se purgan automáticamente tras 6 horas.
                    </span>
                  </div>

                  {/* Contacts List */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-1.5 divide-y divide-white/5">
                    {filteredContacts.length === 0 ? (
                      <div className="text-center py-10 px-4 text-slate-400">
                        <UserIcon className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
                        <p className="text-xs font-medium">No se encontraron docentes activos.</p>
                        <p className="text-[10px] text-slate-500 mt-1">Solo se muestran usuarios con el rol de Docente dados de alta.</p>
                      </div>
                    ) : (
                      filteredContacts.map(teacher => {
                        const level = getUserEducationLevel(teacher);
                        return (
                          <div
                            key={teacher.uid || teacher.email}
                            onClick={() => setSelectedTeacher(teacher)}
                            className="pt-1.5 first:pt-0"
                          >
                            <button
                              className="w-full p-2.5 rounded-xl flex items-center justify-between hover:bg-white/10 transition-all text-left group"
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
                    )}
                  </div>
                </div>
              ) : (
                /* VIEW 2: ACTIVE CONVERSATION POPUP */
                <div className={cn("flex-1 flex flex-col min-h-0", currentTheme.chatAreaBg)}>
                  {/* Ephemeral Notice Header */}
                  <div className="px-3 py-1.5 bg-black/30 border-b border-white/5 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-amber-400" />
                      Mensajes auto-destructibles a las 6 horas
                    </span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                      Encriptado docente
                    </span>
                  </div>

                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                    {messages.length === 0 ? (
                      <div className="text-center py-12 px-6 text-slate-400">
                        <Lock className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-60" />
                        <p className="text-xs font-bold text-slate-300">Conversación Cifrada y Efímera</p>
                        <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                          Inicia el chat con {selectedTeacher.name}. Los mensajes, archivos e imágenes se eliminarán automáticamente a las 6 horas.
                        </p>
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isMine = msg.senderUid === currentUser.uid;
                        const remaining = getRemainingTime(msg.createdAt, msg.expiresAt);

                        return (
                          <div
                            key={msg.id}
                            className={cn("flex flex-col", isMine ? "items-end" : "items-start")}
                          >
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
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}

                              {/* Attached File/Document */}
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
                        className="p-1 text-slate-400 hover:text-red-400"
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
                    {/* Image Attachment input */}
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
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>

                    {/* File Attachment input */}
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
                      title="Compartir archivo o documento"
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    {/* Text input */}
                    <input
                      type="text"
                      placeholder="Escribe un mensaje cifrado..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      className={cn(
                        "flex-1 px-3 py-2 text-xs rounded-xl border outline-none transition-all",
                        currentTheme.inputBg
                      )}
                    />

                    {/* Send Button */}
                    <button
                      type="submit"
                      disabled={isSending || (!inputText.trim() && !attachedFile)}
                      className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-md"
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

      {/* FULLSCREEN IMAGE LIGHTBOX */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 z-[100000] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
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
              className="absolute -top-10 right-0 text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
