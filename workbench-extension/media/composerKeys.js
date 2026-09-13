(function (root, factory) {
  const api = factory();
  root.GSComposerKeys = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /**
   * Chat-composer Enter semantics:
   * - Enter / Ctrl+Enter / Cmd+Enter → send
   * - Shift+Enter → newline (caller must not preventDefault)
   * - Alt+Enter → leave alone
   */
  function shouldSendOnEnter(event) {
    if (!event || !event.target || event.target.id !== 'prompt' || event.key !== 'Enter') {
      return false;
    }
    if (event.shiftKey || event.altKey) return false;
    return true;
  }

  return { shouldSendOnEnter };
});
