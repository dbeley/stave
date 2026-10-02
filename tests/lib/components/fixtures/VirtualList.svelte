<!--
  Host for the virtualised ListView: a tall list inside a fixed-height scrollport,
  which is the shape that made the artist index slow.
-->
<script lang="ts">
  import ListView from '$lib/components/ListView.svelte';
  import { ListCursor } from '$lib/keyboard/list.svelte';

  let { count, virtualise }: { count: number; virtualise: boolean } = $props();

  // Fixed for the lifetime of the fixture — the tests render a given size once.
  // svelte-ignore state_referenced_locally
  const items = Array.from({ length: count }, (_, index) => `row ${index}`);
  const cursor = new ListCursor();

  $effect(() => cursor.setCount(items.length));
</script>

<div style="height: 220px; overflow-y: auto;">
  <ListView {items} {cursor} {virtualise} ariaLabel="virtual" keyOf={(item) => item}>
    {#snippet row(item)}
      <span>{item}</span>
    {/snippet}
  </ListView>
</div>
