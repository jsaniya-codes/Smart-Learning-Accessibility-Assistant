import { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Eye,
  EyeOff,
  FileText,
  History,
  Loader2,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { loginUser, registerUser } from '../services/api';

const ACCOUNT_BENEFITS = [
  {
    title: 'Persistent Chat History',
    detail: 'Resume any AI tutoring conversation across sessions and devices.',
    icon: History,
  },
  {
    title: 'Cloud Document Library',
    detail: 'Reopen or download uploaded PDF and TXT study guides anytime.',
    icon: FileText,
  },
  {
    title: 'Saved Simplifications & Summaries',
    detail: 'Every simplified passage, summary, and keyword list stays organized.',
    icon: Sparkles,
  },
  {
    title: 'Accessible Reading & Audio',
    detail: 'Adjustable typography, high contrast mode, and downloadable MP3 speech.',
    icon: Volume2,
  },
];

export function AuthPage({ onAuthenticated, sessionNotice = null }) {
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isRegister = mode === 'register';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    if (isRegister && fullName.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }

    if (isRegister && password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (!isRegister && !password) {
      setError('Please enter your password.');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = isRegister
        ? await registerUser({ fullName: fullName.trim(), email: trimmedEmail, password })
        : await loginUser({ email: trimmedEmail, password });
      onAuthenticated(data.user);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Authentication failed. Please check your credentials and try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl grid grid-cols-1 gap-8 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-8">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white">
                <BookOpen className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-base font-bold tracking-tight text-slate-900">
                  Smart Learning
                </p>
                <p className="text-xs text-slate-500">Accessibility Assistant</p>
              </div>
            </div>

            <h1 className="mt-8 text-3xl font-bold tracking-tight text-slate-900 text-balance">
              Accessible AI study workspace built to remember every lesson
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Sign in to access your persistent AI chat threads, saved PDF and TXT documents, simplified explanations, structured summaries, and audio study guides.
            </p>
          </div>

          <dl className="mt-8 space-y-4 border-t border-slate-100 pt-6">
            {ACCOUNT_BENEFITS.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <dt className="text-sm font-semibold text-slate-900">{item.title}</dt>
                    <dd className="text-xs text-slate-600 leading-relaxed">{item.detail}</dd>
                  </div>
                </div>
              );
            })}
          </dl>
        </div>

        <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-8 flex flex-col justify-center">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 mb-6" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                !isRegister
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                isRegister
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
          </div>

          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            {isRegister ? 'Create your student account' : 'Welcome back'}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {isRegister
              ? 'Your documents, chats, and saved summaries stay linked privately to your account.'
              : 'Sign in with your email and password to restore your workspace.'}
          </p>

          {sessionNotice && !error && (
            <div
              role="status"
              className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{sessionNotice}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {isRegister && (
              <div>
                <label
                  htmlFor="auth-full-name"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Full Name
                </label>
                <input
                  id="auth-full-name"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Rivera"
                  disabled={isSubmitting}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@university.edu"
                disabled={isSubmitting}
                className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isRegister ? 'At least 8 characters' : 'Enter your password'}
                  disabled={isSubmitting}
                  className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50/50 pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 px-5 text-sm font-semibold text-white hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{isRegister ? 'Creating Account...' : 'Signing In...'}</span>
                </>
              ) : (
                <span>{isRegister ? 'Create Account' : 'Sign In'}</span>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
