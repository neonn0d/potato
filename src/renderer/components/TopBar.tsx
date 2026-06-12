import { goBack, goForward, killAll, loadUrl, navState, reload, url } from '../store'

export function TopBar() {
  const nav = navState.left.value
  const loading = nav.loading
  return (
    <div class="topbar">
      <button class="nav-btn" title="Back" disabled={!nav.canGoBack} onClick={goBack}>
        ◀
      </button>
      <button class="nav-btn" title="Forward" disabled={!nav.canGoForward} onClick={goForward}>
        ▶
      </button>
      <input
        class="url-input"
        type="text"
        placeholder="https://example.com"
        spellcheck={false}
        autocomplete="off"
        value={url.value}
        onInput={(e) => {
          url.value = e.currentTarget.value
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') loadUrl(e.currentTarget.value)
        }}
      />
      <button
        class={'reload-btn' + (loading ? ' loading' : '')}
        title="Reload with current settings"
        onClick={reload}
      >
        ⟳
      </button>
      <button class="kill-btn" title="Hard kill: abort everything in flight" onClick={killAll}>
        🛑 Kill
      </button>
    </div>
  )
}
