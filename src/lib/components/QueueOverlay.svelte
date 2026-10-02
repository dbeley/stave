<!--
  The queue window (`Q`): the surrounding frame and the count. The list itself —
  rows, cursor and bindings — lives in QueueList, shared with the now-playing page.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import Overlay from '$lib/components/Overlay.svelte';
  import QueueList from '$lib/components/QueueList.svelte';

  let items = $derived(app.queue.items);
  let playingIndex = $derived(app.queue.state.index);
</script>

<Overlay
  title="queue"
  note="{items.length} items · {playingIndex + 1}/{items.length}"
  width="min(94vw, 92ch)"
>
  <QueueList scope="overlay" hint={true} />
</Overlay>
