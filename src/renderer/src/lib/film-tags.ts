import type { FilmTag } from "@shared/plugin-api"

/**
 * 影视源 / 数据库里读出的原始值 → 标签二元组（逐项校验，脏数据直接丢弃）。
 *
 * 约定：数组第 1 项是标签、第 2 项是取值，例如 `["年份：", "2026"]`。
 * 标签允许为空字符串（此时只渲染取值），取值为空则整条丢弃。
 */
export function parseFilmTags(value: unknown): FilmTag[] {
  if (!Array.isArray(value)) {
    return []
  }
  const tags: FilmTag[] = []
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) {
      continue
    }
    const [label, text] = item
    if (typeof label !== "string" || typeof text !== "string") {
      continue
    }
    const nextText = text.trim()
    if (nextText.length === 0) {
      continue
    }
    tags.push([label.trim(), nextText])
  }
  return tags
}
