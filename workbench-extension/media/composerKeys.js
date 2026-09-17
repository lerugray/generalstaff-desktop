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

  /**
   * Slash-skill popup trigger (Cursor / Claude Code style):
   * Open only when `/` sits at a token boundary — start of input, whitespace, or newline.
   * Mid-token slashes such as `x/y` or `path/to` must not open the list.
   * The filter query is the in-progress skill-id prefix after that `/`
   * (`[a-z0-9][a-z0-9-]{0,63}`, empty prefix allowed while still typing).
   */
  const slashPrefixPattern = /^[a-z0-9-]{0,64}$/i;

  function slashSkillQuery(text, cursor) {
    if (typeof text !== 'string' || !Number.isInteger(cursor) || cursor < 1 || cursor > text.length) {
      return null;
    }
    const before = text.slice(0, cursor);
    const slash = before.lastIndexOf('/');
    if (slash < 0) return null;
    if (slash > 0 && !/[\s\n\r]/.test(before.charAt(slash - 1))) return null;
    const query = before.slice(slash + 1);
    if (!slashPrefixPattern.test(query)) return null;
    return { start: slash, end: cursor, query };
  }

  function filterSkills(skills, query) {
    const list = Array.isArray(skills) ? skills : [];
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return list.slice();
    return list.filter((skill) => {
      const id = String(skill?.id || '').toLowerCase();
      const name = String(skill?.name || '').toLowerCase();
      const description = String(skill?.description || '').toLowerCase();
      return id.includes(needle) || name.includes(needle) || description.includes(needle);
    });
  }

  function insertSkillToken(text, range, skillId) {
    const value = typeof text === 'string' ? text : '';
    const start = Number.isInteger(range?.start) ? range.start : 0;
    const end = Number.isInteger(range?.end) ? range.end : start;
    const id = String(skillId || '').trim();
    const token = `/${id}`;
    const after = value.slice(end);
    const inserted = after.length === 0 || !/^\s/.test(after) ? `${token} ` : token;
    const next = `${value.slice(0, start)}${inserted}${after}`;
    return { text: next, cursor: start + inserted.length };
  }

  function moveSkillHighlight(index, count, delta) {
    if (!Number.isFinite(count) || count <= 0) return 0;
    const current = Number.isFinite(index) ? index : 0;
    return Math.max(0, Math.min(count - 1, current + delta));
  }

  return {
    shouldSendOnEnter,
    slashSkillQuery,
    filterSkills,
    insertSkillToken,
    moveSkillHighlight,
  };
});
