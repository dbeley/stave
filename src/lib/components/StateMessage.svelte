<!--
  Loading / empty / error messaging that speaks the app's visual language.
-->
<script lang="ts">
  interface Props {
    /** 'loading' shows the animated cursor; others show ASCII glyphs. */
    kind?: 'loading' | 'empty' | 'error' | 'info';
    message: string;
    /** Optional second line: what to do about it. */
    hint?: string;
    /** Detail for errors (usually an exception message). */
    detail?: string;
  }

  let { kind = 'empty', message, hint, detail }: Props = $props();

  const GLYPH: Record<string, string> = {
    loading: '',
    empty: '░▒▓',
    error: '!!',
    info: 'i',
  };
</script>

<div class="state" class:error={kind === 'error'}>
  <span class="glyph" aria-hidden="true">{GLYPH[kind]}</span>
  <div class="text">
    <p class="message" class:cursor={kind === 'loading'}>
      {message}{#if kind === 'loading'}
        <span class="bar">▊▊▊</span>{/if}
    </p>
    {#if hint}<p class="hint">└─ {hint}</p>{/if}
    {#if detail}<p class="hint">└─ {detail}</p>{/if}
  </div>
</div>

<style>
  .state {
    display: flex;
    gap: 0.6em;
    padding: 0.9rem 0.5rem;
    color: var(--fg-dim);
    align-items: flex-start;
  }
  .state.error {
    color: var(--danger);
  }
  .glyph {
    flex: none;
    min-width: 1.6em;
    color: var(--fg-faint);
  }
  .state.error .glyph {
    color: var(--danger);
  }
  .message {
    margin: 0;
  }
  .hint {
    margin: 0;
    color: var(--fg-faint);
    font-size: 0.92em;
  }
  .state.error .hint {
    color: var(--fg-dim);
  }
  .bar {
    color: var(--accent);
    animation: tui-blink 1.1s step-end infinite;
  }
</style>
