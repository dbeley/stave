<!--
  Test fixture: registers keyboard bindings from inside an `$effect`, which is what
  the home page does (it must re-register when Tab switches the focused pane).

  `onRun` is called once per effect execution, so a test can assert the effect is
  not re-triggered by its own registration.
-->
<script lang="ts">
  import type { KeyboardRouter } from '$lib/keyboard/registry.svelte';

  interface Props {
    keyboard: KeyboardRouter;
    onRun: () => void;
  }

  let { keyboard, onRun }: Props = $props();

  $effect(() => {
    onRun();
    return keyboard.registerAll([
      {
        keys: ['j'],
        scope: 'page',
        group: 'probe',
        description: 'probe binding',
        run: () => {},
      },
    ]);
  });
</script>

<div data-testid="register-in-effect"></div>
