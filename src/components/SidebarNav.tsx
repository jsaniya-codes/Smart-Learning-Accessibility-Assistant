import { useState } from 'react';
import {
  Archive,
  BookOpen,
  Check,
  FileText,
  ListChecks,
  LogOut,
  MessageCircleQuestion,
  MessageSquare,
  Pencil,
  PlayCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import type {
  ActiveSection,
  AuthUser,
  ChatConversationSummary,
  DocumentSourceMeta,
} from '../types/learning';

interface SidebarNavProps {
  activeSection: ActiveSection;
  onSelectSection: (section: ActiveSection) => void;
  sourceMeta: DocumentSourceMeta | null;
  wordCount: number;
  hasSimplified: boolean;
  hasSummary: boolean;
  hasQa: boolean;
  hasVideos: boolean;
  hasAudio: boolean;
  highContrast: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  currentUser: AuthUser | null;
  onLogout: () => void;
  conversations: ChatConversationSummary[];
  activeChatId: string | null;
  chatSearchQuery: string;
  onChatSearchChange: (q: string) => void;
  onNewChat: () => void;
  onSelectChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => Promise<void>;
  onDeleteChat: (chatId: string) => void;
}

const NAV_ITEMS: {
  id: ActiveSection;
  label: string;
  icon: typeof FileText;
}[] = [
  {
    id: 'input',
    label: 'Input & Upload',
    icon: FileText,
  },
  {
    id: 'simplify',
    label: 'Text Simplification',
    icon: Sparkles,
  },
  {
    id: 'summarize',
    label: 'Text Summarization',
    icon: ListChecks,
  },
  {
    id: 'assistant',
    label: 'AI Learning Assistant',
    icon: MessageCircleQuestion,
  },
  {
    id: 'videos',
    label: 'Recommended Videos',
    icon: PlayCircle,
  },
  {
    id: 'speech',
    label: 'Voice Tutor & Audio',
    icon: Volume2,
  },
  {
    id: 'history',
    label: 'Saved Library',
    icon: Archive,
  },
];

export function SidebarNav({
  activeSection,
  onSelectSection,
  sourceMeta,
  wordCount,
  hasSimplified,
  hasSummary,
  hasQa,
  hasVideos,
  hasAudio,
  highContrast,
  mobileOpen,
  onCloseMobile,
  currentUser,
  onLogout,
  conversations,
  activeChatId,
  chatSearchQuery,
  onChatSearchChange,
  onNewChat,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
}: SidebarNavProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const readyMap: Record<ActiveSection, boolean> = {
    input: wordCount > 0,
    simplify: hasSimplified,
    summarize: hasSummary,
    assistant: hasQa,
    videos: hasVideos,
    speech: hasAudio,
    history: false,
  };

  const startRename = (chat: ChatConversationSummary) => {
    setEditingChatId(chat.id);
    setEditingTitle(chat.title);
  };

  const commitRename = async (chatId: string) => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingChatId(null);
      return;
    }
    await onRenameChat(chatId, trimmed);
    setEditingChatId(null);
  };

  const navContent = (
    <div
      className={`flex h-full flex-col px-3.5 py-5 overflow-hidden ${
        highContrast ? 'bg-black text-white' : 'bg-white text-slate-900'
      }`}
    >
      {/* Brand + Mobile close */}
      <div
        className={`flex items-center justify-between px-1.5 pb-4 border-b shrink-0 ${
          highContrast ? 'border-white' : 'border-slate-200'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              highContrast
                ? 'border-2 border-yellow-300 bg-yellow-300 text-black'
                : 'bg-gradient-to-br from-indigo-600 to-blue-600 text-white'
            }`}
          >
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p
              className={`text-sm font-bold tracking-tight whitespace-nowrap truncate ${
                highContrast ? 'text-white' : 'text-slate-900'
              }`}
            >
              Smart Learning
            </p>
            <p
              className={`text-[11px] whitespace-nowrap truncate ${
                highContrast ? 'text-yellow-300' : 'text-slate-500'
              }`}
            >
              Accessibility Assistant
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className={`rounded-lg p-2 lg:hidden ${
            highContrast
              ? 'text-white hover:bg-zinc-800'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Primary New Chat CTA */}
      <div className="mt-3.5 shrink-0">
        <button
          type="button"
          onClick={() => {
            onNewChat();
            onCloseMobile();
          }}
          className={`flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-95 whitespace-nowrap ${
            highContrast
              ? 'border-2 border-yellow-300 bg-yellow-300 text-black font-bold'
              : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'
          }`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Scrollable Workspace & Chat History */}
      <div className="mt-4 flex-1 overflow-y-auto space-y-5 pr-0.5">
        <nav aria-label="Workspace features" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const isReady = readyMap[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ${
                  highContrast
                    ? isActive
                      ? 'border-2 border-yellow-300 bg-zinc-900 text-yellow-300'
                      : 'border border-transparent text-white hover:border-white hover:bg-zinc-900'
                    : isActive
                    ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                    : 'bg-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    highContrast
                      ? isActive
                        ? 'text-yellow-300'
                        : 'text-white'
                      : isActive
                      ? 'text-indigo-600'
                      : 'text-slate-400'
                  }`}
                  aria-hidden="true"
                />
                <span className="flex-1 text-xs font-semibold whitespace-nowrap truncate">
                  {item.label}
                </span>
                {isReady && (
                  <span
                    className={`text-[10px] font-semibold whitespace-nowrap ${
                      highContrast ? 'text-yellow-300' : 'text-blue-600'
                    }`}
                  >
                    Ready
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Previous Conversations Section */}
        <section
          aria-labelledby="sidebar-chats-heading"
          className={`border-t pt-4 ${
            highContrast ? 'border-white' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between px-1 mb-2">
            <h2
              id="sidebar-chats-heading"
              className={`text-xs font-semibold ${
                highContrast ? 'text-yellow-300' : 'text-slate-700'
              }`}
            >
              Previous Conversations
            </h2>
            <span
              className={`text-[11px] font-mono-tabular ${
                highContrast ? 'text-zinc-300' : 'text-slate-400'
              }`}
            >
              {conversations.length}
            </span>
          </div>

          <div className="relative mb-2.5">
            <label htmlFor="sidebar-chat-search" className="sr-only">
              Search conversations
            </label>
            <Search
              className={`pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${
                highContrast ? 'text-zinc-300' : 'text-slate-400'
              }`}
              aria-hidden="true"
            />
            <input
              id="sidebar-chat-search"
              type="text"
              value={chatSearchQuery}
              onChange={(e) => onChatSearchChange(e.target.value)}
              placeholder="Search chats..."
              className={
                highContrast
                  ? 'h-8 w-full rounded-md border border-white bg-zinc-950 pl-8 pr-7 text-xs text-white placeholder:text-zinc-400 focus:border-yellow-300 focus:outline-none'
                  : 'h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none'
              }
            />
            {chatSearchQuery && (
              <button
                type="button"
                onClick={() => onChatSearchChange('')}
                aria-label="Clear conversation search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {conversations.length === 0 ? (
            <p
              className={`px-1 text-xs ${
                highContrast ? 'text-zinc-300' : 'text-slate-500'
              }`}
            >
              {chatSearchQuery.trim()
                ? 'No matching conversations.'
                : 'Start a new chat to save your Q&A history.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((chat) => {
                const isSelected =
                  activeSection === 'assistant' && activeChatId === chat.id;
                const isEditing = editingChatId === chat.id;

                if (isEditing) {
                  return (
                    <li
                      key={chat.id}
                      className={`flex items-center gap-1 rounded-lg p-1.5 ${
                        highContrast
                          ? 'border border-yellow-300 bg-zinc-900'
                          : 'border border-indigo-200 bg-indigo-50/60'
                      }`}
                    >
                      <label htmlFor={`rename-chat-${chat.id}`} className="sr-only">
                        New title for {chat.title}
                      </label>
                      <input
                        id={`rename-chat-${chat.id}`}
                        type="text"
                        value={editingTitle}
                        autoFocus
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitRename(chat.id);
                          } else if (e.key === 'Escape') {
                            setEditingChatId(null);
                          }
                        }}
                        className={
                          highContrast
                            ? 'h-7 min-w-0 flex-1 rounded border border-white bg-black px-2 text-xs text-white focus:outline-none'
                            : 'h-7 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none'
                        }
                      />
                      <button
                        type="button"
                        onClick={() => void commitRename(chat.id)}
                        aria-label={`Save title for ${chat.title}`}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingChatId(null)}
                        aria-label="Cancel rename"
                        className="rounded p-1 text-slate-500 hover:bg-slate-100"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  );
                }

                return (
                  <li
                    key={chat.id}
                    className={`group flex items-center gap-1 rounded-lg ${
                      highContrast
                        ? isSelected
                          ? 'border border-yellow-300 bg-zinc-900 text-yellow-300'
                          : 'text-white hover:bg-zinc-900'
                        : isSelected
                        ? 'bg-indigo-50 text-indigo-800'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectChat(chat.id);
                        onCloseMobile();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                    >
                      <MessageSquare
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isSelected
                            ? highContrast
                              ? 'text-yellow-300'
                              : 'text-indigo-600'
                            : highContrast
                            ? 'text-zinc-300'
                            : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate text-xs font-medium">{chat.title}</span>
                    </button>

                    <div className="flex items-center pr-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startRename(chat)}
                        aria-label={`Rename conversation ${chat.title}`}
                        className={`rounded p-1.5 ${
                          highContrast
                            ? 'text-zinc-300 hover:text-yellow-300'
                            : 'text-slate-400 hover:bg-slate-200/70 hover:text-slate-800'
                        }`}
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteChat(chat.id)}
                        aria-label={`Delete conversation ${chat.title}`}
                        className={`rounded p-1.5 ${
                          highContrast
                            ? 'text-zinc-300 hover:text-red-300'
                            : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                        }`}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Bottom Active Material + User Account Footer */}
      <div
        className={`mt-3 shrink-0 space-y-3 border-t pt-3 px-1 ${
          highContrast ? 'border-white' : 'border-slate-200'
        }`}
      >
        <div>
          <p
            className={`text-[11px] font-semibold ${
              highContrast ? 'text-yellow-300' : 'text-slate-600'
            }`}
          >
            Active Material
          </p>
          {wordCount > 0 ? (
            <p
              className={`mt-0.5 text-xs truncate ${
                highContrast ? 'text-zinc-200' : 'text-slate-700'
              }`}
            >
              {sourceMeta?.name ?? 'Typed Educational Text'}{' '}
              <span className="font-mono-tabular text-[11px] opacity-75">
                · {wordCount}w
              </span>
            </p>
          ) : (
            <p
              className={`mt-0.5 text-[11px] ${
                highContrast ? 'text-zinc-300' : 'text-slate-500'
              }`}
            >
              No study text loaded
            </p>
          )}
        </div>

        {currentUser && (
          <div
            className={`flex items-center justify-between gap-2 border-t pt-3 ${
              highContrast ? 'border-zinc-700' : 'border-slate-100'
            }`}
          >
            <div className="min-w-0">
              <p
                className={`text-xs font-semibold truncate ${
                  highContrast ? 'text-white' : 'text-slate-900'
                }`}
              >
                {currentUser.fullName}
              </p>
              <p
                className={`text-[11px] truncate ${
                  highContrast ? 'text-zinc-300' : 'text-slate-500'
                }`}
              >
                {currentUser.email}
              </p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              className={
                highContrast
                  ? 'inline-flex h-8 items-center gap-1 rounded-md border border-white px-2.5 text-xs font-semibold text-white hover:bg-zinc-900 shrink-0'
                  : 'inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shrink-0'
              }
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`hidden lg:block lg:w-72 lg:shrink-0 lg:border-r ${
          highContrast ? 'lg:border-white lg:bg-black' : 'lg:border-slate-200 lg:bg-white'
        }`}
      >
        <div className="sticky top-0 h-screen">{navContent}</div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside
            className={`relative z-10 w-76 max-w-[85vw] border-r shadow-xl ${
              highContrast ? 'border-white bg-black' : 'border-slate-200 bg-white'
            }`}
          >
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
