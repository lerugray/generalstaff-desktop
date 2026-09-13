/**
 * Strip executable content from staged handoff HTML so WHAT-TO-JUDGE cards
 * can render as a printed plate inside a sandboxed iframe (no scripts).
 */

const SCRIPT_TAG = /<script\b[^>]*>[\s\S]*?<\/script\s*>/giu;
const SCRIPT_OPEN = /<script\b[^>]*\/?>/giu;
const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu;
const JS_URI = /\s(href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/giu;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/giu;
const BASE_TAG = /<base\b[^>]*>/giu;
const OBJECTISH = /<\/?(?:object|embed|iframe|frame|frameset|link|applet)\b[^>]*>/giu;

export function sanitiseHandoffHtml(raw: string): string {
  let html = String(raw ?? '');
  html = html.replace(SCRIPT_TAG, '');
  html = html.replace(SCRIPT_OPEN, '');
  html = html.replace(EVENT_ATTR, '');
  html = html.replace(JS_URI, '');
  html = html.replace(META_REFRESH, '');
  html = html.replace(BASE_TAG, '');
  html = html.replace(OBJECTISH, '');
  return html;
}
