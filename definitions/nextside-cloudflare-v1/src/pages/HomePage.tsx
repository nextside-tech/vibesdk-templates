import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { KeyRound, MailCheck, NotebookPen, Sparkles } from 'lucide-react'

import { ThemeToggle } from '@/components/ThemeToggle'
import { HAS_TEMPLATE_DEMO, TemplateDemo } from '@/components/TemplateDemo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toaster, toast } from '@/components/ui/sonner'
import { authClient } from '@/lib/auth-client'

type Note = {
  id: string
  title: string
  createdAt: string
}

type ApiEnvelope<T> = {
  success: boolean
  data?: T
  error?: string
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function readEnvelope<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const payload = (await response.json()) as ApiEnvelope<T>
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error ?? 'request failed')
  }
  return payload.data
}

export default function HomePage() {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const [coins, setCoins] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [email, setEmail] = useState('builder@example.com')
  const [password, setPassword] = useState('builderpass123')
  const [name, setName] = useState('Preview Builder')
  const [noteTitle, setNoteTitle] = useState('')
  const [notes, setNotes] = useState<Note[]>([])
  const [notesLoading, setNotesLoading] = useState(false)

  const sessionUserId = session?.user?.id
  const loadNotes = useCallback(async () => {
    if (!sessionUserId) {
      setNotes([])
      return
    }
    setNotesLoading(true)
    try {
      const data = await readEnvelope<Note[]>('/api/notes')
      setNotes(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load notes')
    } finally {
      setNotesLoading(false)
    }
  }, [sessionUserId])

  useEffect(() => {
    if (!isRunning || startedAt === null) return

    const t = setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 250)

    return () => clearInterval(t)
  }, [isRunning, startedAt])

  const formatted = useMemo(() => formatDuration(elapsedMs), [elapsedMs])

  useEffect(() => {
    startTransition(() => {
      void loadNotes()
    })
  }, [loadNotes])

  const onPleaseWait = () => {
    setCoins((c) => c + 1)

    if (!isRunning) {
      // Resume from the current elapsed time
      setStartedAt(Date.now() - elapsedMs)
      setIsRunning(true)
      toast.success('Building your app…', {
        description: "Hang tight — we're setting everything up.",
      })
      return
    }

    setIsRunning(false)
    toast.info('Still working…', {
      description: 'You can come back in a moment.',
    })
  }

  const onReset = () => {
    setCoins(0)
    setIsRunning(false)
    setStartedAt(null)
    setElapsedMs(0)
    toast('Reset complete')
  }

  const onAddCoin = () => {
    setCoins((c) => c + 1)
    toast('Coin added')
  }

  const onSignUp = async () => {
    const result = await authClient.signUp.email({
      email,
      password,
      name,
    })
    if (result.error) throw new Error(result.error.message ?? 'Sign up failed')
  }

  const onSignIn = async () => {
    const result = await authClient.signIn.email({
      email,
      password,
    })
    if (result.error) throw new Error(result.error.message ?? 'Sign in failed')
  }

  const onSignOut = async () => {
    const result = await authClient.signOut()
    if (result.error) throw new Error(result.error.message ?? 'Sign out failed')
  }

  const onRequestMagicLink = async () => {
    const result = await authClient.signIn.magicLink({
      email,
      name,
      callbackURL: '/',
    })
    if (result.error) throw new Error(result.error.message ?? 'Magic link failed')
  }

  const runAuthAction = async (label: string, action: () => Promise<void>) => {
    try {
      await action()
      toast.success(label)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : label)
    }
  }

  const onOpenLatestMagicLink = async () => {
    try {
      const latest = await readEnvelope<{ url: string; createdAt: string; mode: string }>(
        `/api/auth/mock/links/latest?email=${encodeURIComponent(email)}`,
        { headers: {} },
      )
      toast.success(`Magic link mock (${latest.mode})`, {
        description: `Issued at ${new Date(latest.createdAt).toLocaleString()}`,
      })
      window.location.assign(latest.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Magic link not available')
    }
  }

  const onCreateNote = async () => {
    if (!noteTitle.trim()) {
      toast.error('Note title must not be empty')
      return
    }
    try {
      const note = await readEnvelope<Note>('/api/notes', {
        method: 'POST',
        body: JSON.stringify({ title: noteTitle }),
      })
      setNoteTitle('')
      setNotes((current) => [note, ...current])
      toast.success('Authenticated note saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create note')
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground p-4 overflow-hidden relative">
      <ThemeToggle />
      <div className="absolute inset-0 bg-gradient-rainbow opacity-10 dark:opacity-20 pointer-events-none" />

      <div className="text-center space-y-8 relative z-10 animate-fade-in w-full max-w-6xl">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-primary flex items-center justify-center shadow-primary floating">
            <Sparkles className="w-8 h-8 text-white rotating" />
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-5xl md:text-7xl font-display font-bold text-balance leading-tight">
            Creating your <span className="text-gradient">app</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto text-pretty">
            Your application would be ready soon.
          </p>
        </div>

        {HAS_TEMPLATE_DEMO ? (
          <div className="max-w-5xl mx-auto text-left">
            <TemplateDemo />
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] text-left">
              <section className="rounded-3xl border border-border/60 bg-background/85 p-6 shadow-xl backdrop-blur">
                <div className="flex items-center gap-3">
                  <KeyRound className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-2xl font-display font-semibold">Auth Runtime</h2>
                    <p className="text-sm text-muted-foreground">
                      Better Auth + D1 with same-origin session cookies and mock magic-link delivery.
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Display name</Label>
                    <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  <Button onClick={() => void runAuthAction('Account created', onSignUp)}>Create account</Button>
                  <Button variant="outline" onClick={() => void runAuthAction('Signed in', onSignIn)}>
                    Sign in
                  </Button>
                  <Button variant="outline" onClick={() => void runAuthAction('Signed out', onSignOut)}>
                    Sign out
                  </Button>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={() => void runAuthAction('Magic link queued', onRequestMagicLink)}>
                    Send magic link
                  </Button>
                  <Button variant="outline" onClick={() => void onOpenLatestMagicLink()}>
                    Open latest mock link
                  </Button>
                </div>

                <div className="mt-6 rounded-2xl border border-border/60 bg-muted/30 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MailCheck className="h-4 w-4 text-primary" />
                    Session state
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {sessionPending
                      ? 'Reading auth session…'
                      : session?.user
                        ? `${session.user.email} authenticated`
                        : 'No active session'}
                  </p>
                  {session?.user ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      userId={session.user.id} · verified={String(session.user.emailVerified)}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="rounded-3xl border border-border/60 bg-background/85 p-6 shadow-xl backdrop-blur">
                <div className="flex items-center gap-3">
                  <NotebookPen className="h-5 w-5 text-primary" />
                  <div>
                    <h2 className="text-2xl font-display font-semibold">Authenticated Notes</h2>
                    <p className="text-sm text-muted-foreground">
                      `GET /api/notes` and `POST /api/notes` now require a real session and scope data to the signed-in user.
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex gap-3">
                  <Input
                    placeholder="Title for a private note"
                    value={noteTitle}
                    onChange={(event) => setNoteTitle(event.target.value)}
                    disabled={!session?.user}
                  />
                  <Button onClick={() => void onCreateNote()} disabled={!session?.user}>
                    Save note
                  </Button>
                </div>

                <div className="mt-6 rounded-2xl border border-border/60 bg-muted/30 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Notes for this session</span>
                    <Button variant="ghost" size="sm" onClick={() => void loadNotes()} disabled={!session?.user}>
                      Refresh
                    </Button>
                  </div>
                  <div className="mt-3 space-y-3">
                    {!session?.user ? (
                      <p className="text-sm text-muted-foreground">
                        Sign in first. Unauthenticated requests return `401 authentication required`.
                      </p>
                    ) : notesLoading ? (
                      <p className="text-sm text-muted-foreground">Loading scoped notes…</p>
                    ) : notes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No notes yet for this user.</p>
                    ) : (
                      notes.map((note) => (
                        <div key={note.id} className="rounded-xl border border-border/50 bg-background/80 px-4 py-3">
                          <p className="font-medium">{note.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </section>
            </div>

            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
              <div>
                Time elapsed:{' '}
                <span className="font-medium tabular-nums text-foreground">{formatted}</span>
              </div>
              <div>
                Coins:{' '}
                <span className="font-medium tabular-nums text-foreground">{coins}</span>
              </div>
            </div>

            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={onPleaseWait}>
                Please Wait
              </Button>
              <Button variant="outline" size="sm" onClick={onReset}>
                Reset
              </Button>
              <Button variant="outline" size="sm" onClick={onAddCoin}>
                Add Coin
              </Button>
            </div>
          </>
        )}
      </div>

      <footer className="absolute bottom-8 text-center text-muted-foreground/80">
        <p>Powered by Cloudflare</p>
      </footer>

      <Toaster richColors closeButton />
    </div>
  )
}
