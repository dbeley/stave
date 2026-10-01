<!--
  Minimal host for `keepCursorRowVisible`: rows tagged the way ListView tags them,
  so the helper's selector is exercised as written.
-->
<script lang="ts">
  import { keepCursorRowVisible } from '$lib/keyboard/list.svelte';

  let { index }: { index: number } = $props();

  let container: HTMLDivElement | undefined = $state();

  keepCursorRowVisible(
    () => container,
    () => index,
  );
</script>

<div bind:this={container}>
  {#each [0, 1, 2] as row (row)}
    <div class="row" class:selected={row === index} data-row={row}>{row}</div>
  {/each}
</div>
