/**
 * The gateway's renderer pattern (PLACEHOLDER_PATTERN in src/common/utils/template-render.ts), kept verbatim: a send
 * fills `{{customer.name}}`, `{{order-id}}` and the legacy `{name}` form, so the chat composer may not keep a narrower
 * pattern of its own.
 */
export const PLACEHOLDER_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}|\{(\w+)\}/g;
