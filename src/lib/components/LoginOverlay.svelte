<!--
  The login / connection form.
 *
 * Shown as a blocking overlay until credentials are known, and re-openable from
 * the settings page. The password is only persisted when "remember" is ticked;
 * it is never sent anywhere except the Subsonic token flow.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import Overlay from '$lib/components/Overlay.svelte';
  import { DEFAULT_SERVER_URL } from '$lib/config';

  interface Props {
    /** Blocking mode: cannot be dismissed until a connection succeeds. */
    blocking?: boolean;
  }

  let { blocking = false }: Props = $props();

  let server = $state(app.credentials.state.server || DEFAULT_SERVER_URL);
  let username = $state(app.credentials.state.username);
  let password = $state(app.credentials.state.password);
  let remember = $state(app.credentials.state.remembered);
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);
  let field = $state<'server' | 'username' | 'password' | 'remember'>('server');

  let fields = ['server', 'username', 'password', 'remember'] as const;

  async function submit(): Promise<void> {
    if (busy) return;
    if (!server.trim() || !username.trim() || !password) {
      error = 'server, username and password are all required';
      return;
    }
    busy = true;
    error = undefined;
    const ok = await app.connect({ server, username, password }, { remember });
    busy = false;
    if (ok) {
      if (blocking) app.ui.closeOverlay();
      app.toasts.ok(`welcome, ${username}`);
    } else {
      error = app.connection.error ?? 'connection failed';
    }
  }

  function move(delta: number): void {
    const index = fields.indexOf(field);
    const next = Math.min(Math.max(index + delta, 0), fields.length - 1);
    field = fields[next] ?? 'server';
    if (field === 'remember') remember = !remember;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (field === 'remember') {
        remember = !remember;
        void submit();
        return;
      }
      void submit();
    }
    if (event.key === 'Tab' || (event.key === 'j' && event.altKey)) {
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (field === 'remember') remember = !remember;
    }
    if (event.key === 'Escape' && !blocking) {
      event.preventDefault();
      app.ui.closeOverlay();
    }
  }
</script>

<Overlay
  title="connect"
  note={busy ? 'connecting…' : 'subsonic / navidrome'}
  width="min(92vw, 62ch)"
  closeOnBackdrop={!blocking}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="form" onkeydown={onKeydown}>
    <label class="row" class:active={field === 'server'}>
      <span class="label">server</span>
      <input
        class="input"
        type="url"
        placeholder="http://localhost:4533"
        bind:value={server}
        onfocus={() => (field = 'server')}
      />
    </label>

    <label class="row" class:active={field === 'username'}>
      <span class="label">username</span>
      <input
        class="input"
        type="text"
        autocomplete="username"
        bind:value={username}
        onfocus={() => (field = 'username')}
      />
    </label>

    <label class="row" class:active={field === 'password'}>
      <span class="label">password</span>
      <input
        class="input"
        type="password"
        autocomplete="current-password"
        bind:value={password}
        onfocus={() => (field = 'password')}
      />
    </label>

    <label class="row" class:active={field === 'remember'}>
      <span class="label">remember</span>
      <input
        class="checkbox"
        type="checkbox"
        bind:checked={remember}
        onfocus={() => (field = 'remember')}
      />
      <span class="hint">store the password on this device only</span>
    </label>

    {#if error}
      <p class="error">└─ {error}</p>
    {/if}

    <p class="hint">
      tab / j k move · enter connect · {blocking
        ? 'connection required to continue'
        : 'esc cancels'}
    </p>

    <div class="actions">
      <button class="button" onclick={() => void submit()} disabled={busy}>
        {busy ? 'connecting…' : 'connect'}
      </button>
    </div>
  </div>
</Overlay>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6em;
    padding: 0.15rem 0.3rem;
    border-left: 2px solid transparent;
  }
  .row.active {
    background: var(--bg-elev-2);
    border-left-color: var(--accent);
  }
  .label {
    flex: none;
    width: 10ch;
    color: var(--accent);
  }
  .input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 0.15rem 0.4rem;
    font: inherit;
    color: inherit;
  }
  .input:focus {
    border-color: var(--accent);
  }
  .checkbox {
    accent-color: var(--accent);
  }
  .hint {
    color: var(--fg-faint);
  }
  .error {
    color: var(--danger);
    margin: 0.2rem 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.4rem;
  }
  .button {
    border: 1px solid var(--accent);
    color: var(--accent);
    padding: 0.2rem 0.8rem;
  }
  .button:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }
  .button:disabled {
    opacity: 0.6;
  }
</style>
