<!--
  Cover art with a graceful degradation ladder:
 *   1. ASCII art sampled from the image (settings → ASCII covers),
 *   2. the raw image,
 *   3. a generated pattern derived from the id.
-->
<script lang="ts">
  import AsciiArt from '$lib/components/AsciiArt.svelte';
  import { coverArtUrl } from '$lib/ui/coverArt';

  interface Props {
    coverArtId?: string | undefined;
    /** Fallback pattern seed — always provided so there is never an empty box. */
    seed: string;
    /** Requested pixel size for the raw image. */
    size?: number;
    /** ASCII grid width. */
    columns?: number;
    /** 'auto' follows the ASCII-covers setting. */
    mode?: 'auto' | 'ascii' | 'image';
    ascii?: boolean;
    alt?: string;
  }

  let {
    coverArtId,
    seed,
    size = 240,
    columns = 40,
    mode = 'auto',
    ascii = true,
    alt = 'cover art',
  }: Props = $props();

  let url = $derived(coverArtUrl(coverArtId, size));
  let useAscii = $derived(mode === 'auto' ? ascii : mode === 'ascii');
</script>

{#if useAscii}
  <AsciiArt src={url} {seed} {columns} />
{:else if url}
  <img class="cover" src={url} {alt} loading="lazy" decoding="async" />
{:else}
  <AsciiArt {seed} {columns} />
{/if}

<style>
  .cover {
    display: block;
    max-width: 100%;
    height: auto;
    border: 1px solid var(--border);
    image-rendering: pixelated;
  }
</style>
