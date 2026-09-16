/**
 * 极简语义化版本范围匹配，覆盖插件清单常见写法：
 * `*` / `1.2.3` / `^1.2.3` / `~1.2.3` / `>=1.0.0` / `1.x` / `1` / `>=1.0.0 <2.0.0`，
 * 并支持用 `||` 组合多个备选范围。
 */

function parseVersion(input: string): [number, number, number] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(input.trim())
  if (!match) {
    return null
  }
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

function compareVersion(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  return 0
}

/** 判断 `version` 是否满足 `range` */
export function satisfiesRange(version: string, range: string): boolean {
  const target = parseVersion(version)
  if (!target) {
    return false
  }
  if (typeof range !== "string") {
    return false
  }
  return range.split("||").some((part) =>
    part
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => satisfiesToken(target, token)),
  )
}

function satisfiesToken(version: [number, number, number], token: string): boolean {
  if (token === "*" || token === "latest" || token === "x") {
    return true
  }

  // 主版本通配：1 / 1.x / 1.*
  const majorWildcard = /^v?(\d+)(?:\.[xX*])?$/.exec(token)
  if (majorWildcard) {
    return version[0] === Number(majorWildcard[1])
  }

  const base = parseVersion(token.replace(/^[~^>=<]+\s*/, ""))
  if (!base) {
    return false
  }

  if (token.startsWith("^")) {
    // ^0.0.3 -> [0.0.3, 0.0.4)   ^0.2.3 -> [0.2.3, 0.3.0)   ^1.2.3 -> [1.2.3, 2.0.0)
    const upper: [number, number, number] =
      base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1]
    return compareVersion(version, base) >= 0 && compareVersion(version, upper) < 0
  }

  if (token.startsWith("~")) {
    const upper: [number, number, number] = [base[0], base[1] + 1, 0]
    return compareVersion(version, base) >= 0 && compareVersion(version, upper) < 0
  }

  if (token.startsWith(">=")) return compareVersion(version, base) >= 0
  if (token.startsWith(">")) return compareVersion(version, base) > 0
  if (token.startsWith("<=")) return compareVersion(version, base) <= 0
  if (token.startsWith("<")) return compareVersion(version, base) < 0
  if (token.startsWith("=")) return compareVersion(version, base) === 0

  // 精确版本
  return compareVersion(version, base) === 0
}

/** 校验字符串是否为合法的语义化版本号 */
export function isValidVersion(input: string): boolean {
  return parseVersion(input) !== null
}
