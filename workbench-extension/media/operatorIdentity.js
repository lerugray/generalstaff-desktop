(function (global) {
  function operatorQueueHeading(displayName) {
    const trimmed = String(displayName ?? '').trim();
    if (!trimmed) return 'Needs You';
    return `Needs ${trimmed.split(/\s+/)[0]}`;
  }

  function operatorAvatarLabel(displayName) {
    const trimmed = String(displayName ?? '').trim();
    if (!trimmed) return '◉';
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  global.operatorQueueHeading = operatorQueueHeading;
  global.operatorAvatarLabel = operatorAvatarLabel;
})(typeof globalThis !== 'undefined' ? globalThis : window);
