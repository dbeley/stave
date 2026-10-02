<!--
  The login / connection form.

  Shown as a blocking overlay until credentials are known, and re-openable from
  the settings page. The password is only persisted when "remember" is ticked;
  it is never sent anywhere except the Subsonic token flow.

  Focus and the highlight are the *same thing*: the browser owns Tab, and the
  `onfocus` handlers move the highlight to match. An earlier version kept its own
  cursor and intercepted Tab, which let the two drift apart — the next row looked
  selected while the caret (and therefore your typing) stayed on the previous one.
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

  type Field = 'server' | 'username' | 'password' | 'remember';

  let server = $state(app.credentials.state.server || DEFAULT_SERVER_URL);
  let username = $state(app.credentials.state.username);
  let password = $state(app.credentials.state.password);
  let remember = $state(app.credentials.state.remembered);
  let busy = $state(false);
  let error = $state<string | undefined>(undefined);
  let field = $state<Field>('server');

  const fields: Field[] = ['server', 'username', 'password', 'remember'];

  /** The real nodes, so the cursor can move focus rather than only a highlight. */
  const inputs: Record<Field, HTMLInputElement | undefined> = {
    server: undefined,
    username: undefined,
    password: undefined,
    remember: undefined,
  };

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

  /** Move highlight and focus together — never one without the other. */
  function focusField(next: Field): void {
    field = next;
    inputs[next]?.focus();
  }

  function move(delta: number): void {
    const index = fields.indexOf(field);
    const next = Math.min(Math.max(index + delta, 0), fields.length - 1);
    focusField(fields[next] ?? 'server');
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
      return;
    }
    /*
     * Tab is deliberately left alone: the browser's own order moves the focus and
     * the `onfocus` handlers keep the highlight in step. Intercepting it here is
     * what used to leave the caret behind on the previous field, so the next row
     * looked selected and your typing went elsewhere.
     *
     * Space is left alone too: it types a space in a field and toggles the checkbox
     * natively, both of which are what a user expects.
     */
    if (event.altKey && (event.key === 'j' || event.key === 'k')) {
      event.preventDefault();
      move(event.key === 'j' ? 1 : -1);
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
        bind:this={inputs.server}
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
        bind:this={inputs.username}
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
        bind:this={inputs.password}
        bind:value={password}
        onfocus={() => (field = 'password')}
      />
    </label>

    <label class="row" class:active={field === 'remember'}>
      <span class="label">remember</span>
      <input
        class="checkbox"
        type="checkbox"
        bind:this={inputs.remember}
        bind:checked={remember}
        onfocus={() => (field = 'remember')}
      />
      <span class="hint">store the password on this device only</span>
    </label>

    {#if error}
      <p class="error">└─ {error}</p>
    {/if}

    <p class="hint">
      tab / shift+tab move · enter connect · {blocking
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
